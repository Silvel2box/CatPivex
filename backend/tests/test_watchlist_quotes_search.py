from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.adapters.registry import Registry
from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.main import create_app
from app.models import DEFAULT_WATCHLIST, ErrorResponse
from tests.conftest import NOW, FakeAdapter, yahoo_registry

TUE = 1_699_920_000  # 2023-11-14 00:00 UTC, the newest SET daily candle at NOW


def make_client(db_path, registry) -> TestClient:
    settings = Settings(db_path=db_path, cors_origins=DEFAULT_CORS_ORIGINS.split(","))
    return TestClient(create_app(settings=settings, registry=registry, clock=lambda: NOW))


@pytest.fixture
def client(tmp_path, fake_yahoo) -> TestClient:
    return make_client(tmp_path / "w.db", yahoo_registry(fake_yahoo, BINANCE=FakeAdapter()))


# --- T2.5 watchlist -------------------------------------------------------------------------


def test_T2_5_watchlist_persists_and_seeds_once(tmp_path, fake_yahoo):
    db = tmp_path / "w.db"
    registry = yahoo_registry(fake_yahoo, BINANCE=FakeAdapter())
    c = make_client(db, registry)
    assert c.get("/api/watchlist").json() == {"symbols": list(DEFAULT_WATCHLIST)}

    assert c.post("/api/watchlist", json={"symbol": "set:kbank"}).json()["symbols"][-1] == (
        "SET:KBANK"
    )
    c.post("/api/watchlist", json={"symbol": "SET:KBANK"})  # already there: no-op
    order = ["SET:KBANK", "FX:XAUUSD", "BINANCE:BTCUSDT", "SET:PTT", "US:AAPL"]
    assert c.put("/api/watchlist", json={"symbols": order}).json() == {"symbols": order}
    assert c.delete("/api/watchlist/SET:PTT").json()["symbols"] == [
        "SET:KBANK",
        "FX:XAUUSD",
        "BINANCE:BTCUSDT",
        "US:AAPL",
    ]
    assert "US:AAPL" not in c.delete("/api/watchlist/US%3AAAPL").json()["symbols"]
    assert c.delete("/api/watchlist/SET:NOTTHERE").status_code == 200  # absent: no-op

    reopened = make_client(db, registry)  # new app, new connections, same file
    assert reopened.get("/api/watchlist").json() == {
        "symbols": ["SET:KBANK", "FX:XAUUSD", "BINANCE:BTCUSDT"]
    }

    for s in ["SET:KBANK", "FX:XAUUSD", "BINANCE:BTCUSDT"]:
        reopened.delete(f"/api/watchlist/{s}")
    assert make_client(db, registry).get("/api/watchlist").json() == {"symbols": []}  # no re-seed


@pytest.mark.parametrize("symbol", ["NYSE:IBM", "PTT", "SET:"])
def test_T2_5_watchlist_rejects_bad_symbols(client, symbol):
    resp = client.post("/api/watchlist", json={"symbol": symbol})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_symbol"
    resp = client.put("/api/watchlist", json={"symbols": ["SET:PTT", symbol]})
    assert resp.status_code == 400
    assert client.get("/api/watchlist").json()["symbols"] == list(DEFAULT_WATCHLIST)


# --- T2.6 quotes ----------------------------------------------------------------------------


def test_T2_6_quotes_values_order_and_per_symbol_errors(client, fake_yahoo):
    fake_yahoo.daily_closes = {date(2023, 11, 13): 36.0, date(2023, 11, 14): 37.5}
    fake_yahoo.fail["FAIL"] = RuntimeError("yahoo down")
    symbols = "SET:PTT,FOO:BAR,binance:btcusdt,SET:,US:FAIL"
    resp = client.get("/api/quotes", params={"symbols": symbols})
    assert resp.status_code == 200
    ptt, foo, btc, empty, fail = resp.json()

    assert ptt["symbol"] == "SET:PTT" and ptt["error"] is None and ptt["delayed"] is True
    assert ptt["price"] == 37.5 and ptt["time"] == TUE
    assert ptt["change"] == pytest.approx(1.5)
    assert ptt["change_percent"] == pytest.approx(1.5 / 36.0 * 100)

    assert btc["symbol"] == "BINANCE:BTCUSDT" and btc["delayed"] is False
    assert (btc["price"], btc["change"], btc["change_percent"]) == (1.5, 0, 0)

    for bad, code in [(foo, "invalid_symbol"), (empty, "invalid_symbol"), (fail, "upstream_error")]:
        assert bad["price"] is None and bad["change"] is None and bad["error"]["code"] == code
        ErrorResponse.model_validate({"error": bad["error"]})
    assert (foo["symbol"], fail["symbol"]) == ("FOO:BAR", "US:FAIL")


def test_T2_6_quotes_empty_and_too_many(client):
    assert client.get("/api/quotes").json() == []
    resp = client.get("/api/quotes", params={"symbols": ",".join(["SET:PTT"] * 51)})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "validation_error"


# --- T2.7 search ----------------------------------------------------------------------------


class BrokenSearch(FakeAdapter):
    def search(self, query):
        raise RuntimeError("binance search down")


PTT_QUOTES = [
    {"symbol": "PTTRX", "quoteType": "MUTUALFUND", "exchange": "NAS", "longname": "PIMCO"},
    {"symbol": "PTT.BK", "quoteType": "EQUITY", "exchange": "SET", "longname": "PTT PCL"},
    {"symbol": "PTTEP.BK", "quoteType": "EQUITY", "exchange": "SET", "longname": "PTT E&P"},
]


def test_T2_7_search_survives_a_failing_adapter(tmp_path, fake_yahoo):
    fake_yahoo.quotes = PTT_QUOTES
    c = make_client(tmp_path / "s.db", yahoo_registry(fake_yahoo, BINANCE=BrokenSearch()))
    resp = c.get("/api/symbols/search", params={"q": "ptt"})
    assert resp.status_code == 200
    symbols = [i["symbol"] for i in resp.json()]
    assert symbols[0] == "SET:PTT"  # exact ticker match first
    assert {"SET:PTTEP", "SET:PTTGC"} <= set(symbols)  # PTTGC only in the offline SET list
    assert not any("PTTRX" in s for s in symbols)  # unmappable mutual fund dropped
    assert fake_yahoo.search_calls == ["PTT"]  # one Yahoo search shared by SET/US/FX


def test_T2_7_offline_lists_when_yahoo_search_fails(client, fake_yahoo):
    fake_yahoo.search_error = RuntimeError("search broke")
    kbank = client.get("/api/symbols/search", params={"q": "kbank"}).json()
    assert [i["symbol"] for i in kbank] == ["SET:KBANK"]
    assert kbank[0]["realtime"] is False and kbank[0]["type"] == "stock"
    gold = client.get("/api/symbols/search", params={"q": "xau"}).json()
    assert gold[0]["symbol"] == "FX:XAUUSD" and gold[0]["type"] == "commodity"
    assert len(client.get("/api/symbols/search", params={"q": "a"}).json()) == 30  # capped


def test_T2_7_registry_dedupes_and_ranks():
    class Static(FakeAdapter):
        def __init__(self, items):
            super().__init__()
            self.items = items

        def search(self, query):
            return self.items

    from app.models import SymbolInfo

    def info(sym):
        return SymbolInfo(symbol=sym, name=sym, exchange="X", type="crypto", realtime=True)

    reg = Registry(
        {
            "A": Static([info("A:BTCUP"), info("A:WBTC")]),
            "B": Static([info("A:BTC"), info("A:WBTC")]),
        }
    )
    assert [i.symbol for i in reg.search("btc")] == ["A:BTC", "A:BTCUP", "A:WBTC"]

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.main import create_app
from app.models import MAX_DRAWINGS, ErrorResponse
from tests.conftest import NOW, FakeAdapter, yahoo_registry

BTC = "BINANCE:BTCUSDT"
DRAWINGS = [
    {
        "id": "d1",
        "type": "trendline",
        "a": {"time": 1_700_000_000, "price": 0.1 + 0.2},  # 0.30000000000000004
        "b": {"time": 1_700_003_600, "price": 37123.456789},
        "style": {"color": "#f0b90b", "width": 2, "dash": [4, 2]},
        "label": "แนวรับ 支撑 ✓",
        "locked": False,
        "note": None,
    },
    {"id": "d2", "type": "hline", "price": -1e-9, "extra": {"nested": {"deep": [1, {"x": []}]}}},
]


def make_client(db_path, registry) -> TestClient:
    settings = Settings(db_path=db_path, cors_origins=DEFAULT_CORS_ORIGINS.split(","))
    return TestClient(create_app(settings=settings, registry=registry, clock=lambda: NOW))


@pytest.fixture
def registry(fake_yahoo):
    return yahoo_registry(fake_yahoo, BINANCE=FakeAdapter())


@pytest.fixture
def client(tmp_path, registry) -> TestClient:
    return make_client(tmp_path / "d.db", registry)


def assert_error(resp, status: int, code: str) -> None:
    assert resp.status_code == status, resp.text
    assert ErrorResponse.model_validate(resp.json()).error.code == code


# --- T4.5 drawings --------------------------------------------------------------------------


def test_t4_5_drawings_round_trip_exactly(client):
    resp = client.put(f"/api/drawings/{BTC}", json={"drawings": DRAWINGS})
    assert resp.status_code == 200
    assert resp.json() == {"symbol": BTC, "drawings": DRAWINGS}

    got = client.get(f"/api/drawings/{BTC}").json()
    assert got == {"symbol": BTC, "drawings": DRAWINGS}
    assert got["drawings"][0]["a"]["price"] == 0.30000000000000004
    assert got["drawings"][0]["label"] == "แนวรับ 支撑 ✓"


@pytest.mark.parametrize(
    "path, canonical",
    [
        ("BINANCE:BTCUSDT", BTC),
        ("BINANCE%3ABTCUSDT", BTC),
        ("binance%3abtcusdt", BTC),
        ("set:ptt", "SET:PTT"),
        ("FX%3AXAUUSD", "FX:XAUUSD"),
        ("US:AAPL", "US:AAPL"),
    ],
)
def test_t4_5_drawings_symbol_in_path_is_canonicalised(client, path, canonical):
    put = client.put(f"/api/drawings/{path}", json={"drawings": [{"id": path}]})
    assert put.json() == {"symbol": canonical, "drawings": [{"id": path}]}
    for p in (path, canonical, canonical.replace(":", "%3A")):
        assert client.get(f"/api/drawings/{p}").json() == {
            "symbol": canonical,
            "drawings": [{"id": path}],
        }


def test_t4_5_drawings_are_per_symbol_and_put_replaces(client):
    eth = "BINANCE:ETHUSDT"
    assert client.get(f"/api/drawings/{eth}").json() == {"symbol": eth, "drawings": []}
    client.put(f"/api/drawings/{BTC}", json={"drawings": DRAWINGS})
    assert client.get(f"/api/drawings/{eth}").json()["drawings"] == []

    client.put(f"/api/drawings/{eth}", json={"drawings": [{"id": "e"}]})
    client.put(f"/api/drawings/{BTC}", json={"drawings": [{"id": "only"}]})  # whole list
    assert client.get(f"/api/drawings/{BTC}").json()["drawings"] == [{"id": "only"}]
    assert client.get(f"/api/drawings/{eth}").json()["drawings"] == [{"id": "e"}]

    client.put(f"/api/drawings/{BTC}", json={"drawings": []})
    assert client.get(f"/api/drawings/{BTC}").json()["drawings"] == []


def test_t4_5_drawings_delete(client, tmp_path, fake_yahoo):
    client.put(f"/api/drawings/{BTC}", json={"drawings": DRAWINGS})
    client.put("/api/drawings/SET:PTT", json={"drawings": [{"id": "p"}]})
    resp = client.delete("/api/drawings/binance%3Abtcusdt")
    assert resp.status_code == 200 and resp.json() == {"symbol": BTC, "drawings": []}
    assert client.get(f"/api/drawings/{BTC}").json()["drawings"] == []
    assert client.get("/api/drawings/SET:PTT").json()["drawings"] == [{"id": "p"}]

    resp = client.delete("/api/drawings/US:NEVERSAVED")
    assert resp.status_code == 200 and resp.json() == {"symbol": "US:NEVERSAVED", "drawings": []}

    # An exchange that is no longer configured can still be cleared (format check only).
    db = tmp_path / "d.db"
    with_old = make_client(db, yahoo_registry(fake_yahoo, BINANCE=FakeAdapter(), OLD=FakeAdapter()))
    with_old.put("/api/drawings/OLD:XYZ", json={"drawings": [{"id": "o"}]})
    resp = client.delete("/api/drawings/OLD:XYZ")  # `client` has no OLD adapter
    assert resp.status_code == 200 and resp.json() == {"symbol": "OLD:XYZ", "drawings": []}
    assert with_old.get("/api/drawings/OLD:XYZ").json()["drawings"] == []
    assert_error(client.delete("/api/drawings/NOCOLON"), 400, "invalid_symbol")


@pytest.mark.parametrize("symbol", ["NYSE:IBM", "PTT", "SET:", "%3APTT", "SET:P%20T"])
def test_t4_5_drawings_reject_invalid_symbols(client, symbol):
    assert_error(client.get(f"/api/drawings/{symbol}"), 400, "invalid_symbol")
    resp = client.put(f"/api/drawings/{symbol}", json={"drawings": [{"id": "x"}]})
    assert_error(resp, 400, "invalid_symbol")


@pytest.mark.parametrize(
    "body",
    [
        {"drawings": {"id": "not a list"}},
        {"drawings": "nope"},
        {"drawings": None},
        {"drawings": [{"id": "ok"}, 42]},
        {"drawings": [[1, 2]]},
        {"drawings": ["str"]},
        {"drawings": [None]},
        {"drawings": [{"id": i} for i in range(MAX_DRAWINGS + 1)]},
        {},
        [],
    ],
)
def test_t4_5_drawings_reject_bad_bodies(client, body):
    client.put(f"/api/drawings/{BTC}", json={"drawings": DRAWINGS})
    assert_error(client.put(f"/api/drawings/{BTC}", json=body), 422, "validation_error")
    assert client.get(f"/api/drawings/{BTC}").json()["drawings"] == DRAWINGS  # untouched


def test_t4_5_drawings_cap_boundary_and_non_json_numbers(client):
    full = [{"id": i} for i in range(MAX_DRAWINGS)]
    assert client.put(f"/api/drawings/{BTC}", json={"drawings": full}).json()["drawings"] == full

    # Python's JSON parser accepts NaN; storing it would make every later GET fail.
    nan = b'{"drawings": [{"price": NaN}]}'
    resp = client.put(
        f"/api/drawings/{BTC}", content=nan, headers={"content-type": "application/json"}
    )
    assert_error(resp, 422, "validation_error")
    assert client.get(f"/api/drawings/{BTC}").json()["drawings"] == full


# --- T4.5 layout ----------------------------------------------------------------------------


def test_t4_5_layout_round_trip(client):
    assert client.get("/api/layout").json() == {"layout": None}

    layout = {
        "symbol": BTC,
        "interval": "1h",
        "panes": [{"id": "main", "height": 0.7}, {"id": "rsi", "height": 0.1 + 0.2}],
        "indicators": {"ma": {"period": 20, "color": "#fff"}},
        "title": "หน้าหลัก ✓",
    }
    put = client.put("/api/layout", json={"layout": layout})
    assert put.status_code == 200 and put.json() == {"layout": layout}
    assert client.get("/api/layout").json() == {"layout": layout}

    assert client.put("/api/layout", json={"layout": {}}).json() == {"layout": {}}  # e2e reset
    assert client.get("/api/layout").json() == {"layout": {}}


@pytest.mark.parametrize(
    "body", [{"layout": None}, {"layout": []}, {"layout": "x"}, {"layout": 1}, {}, []]
)
def test_t4_5_layout_rejects_non_objects(client, body):
    client.put("/api/layout", json={"layout": {"keep": True}})
    assert_error(client.put("/api/layout", json=body), 422, "validation_error")
    assert client.get("/api/layout").json() == {"layout": {"keep": True}}


# --- T4.5 persistence -----------------------------------------------------------------------


def test_t4_5_drawings_and_layout_survive_a_new_database(tmp_path, registry):
    db = tmp_path / "d.db"
    c = make_client(db, registry)
    c.put(f"/api/drawings/{BTC}", json={"drawings": DRAWINGS})
    c.put("/api/layout", json={"layout": {"interval": "4h", "x": 0.1 + 0.2}})

    reopened = make_client(db, registry)  # new app, new Database, same file
    assert reopened.get(f"/api/drawings/{BTC}").json() == {"symbol": BTC, "drawings": DRAWINGS}
    assert reopened.get("/api/layout").json() == {"layout": {"interval": "4h", "x": 0.1 + 0.2}}

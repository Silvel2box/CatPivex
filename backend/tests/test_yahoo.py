from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.adapters.base import AdapterError
from app.adapters.resample import resample
from app.adapters.yahoo import YahooAdapter, YahooSource, frame_to_candles, from_yahoo, to_yahoo
from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.db import Database
from app.main import create_app
from app.models import Candle
from app.services.candles import CandleService
from tests.conftest import BKK, NOW, SET_HOURS_UTC, FakeAdapter, yahoo_registry

H = 3600
D = 86400
MON = 1_699_833_600  # Monday 2023-11-13 00:00 UTC
SUNDAY_NOON = MON - 12 * H  # 2023-11-12 12:00 UTC
FRIDAY = MON - 3 * D


def service_with(tmp_path, fake_yahoo, clock=lambda: NOW) -> CandleService:
    return CandleService(Database(tmp_path / "y.db"), yahoo_registry(fake_yahoo, clock), clock)


def candle(t: int, o: float, h: float, lo: float, c: float, v: float = 1) -> Candle:
    return Candle(time=t, open=o, high=h, low=lo, close=c, volume=v)


# --- T2.1 symbol mapping --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("exchange", "ticker", "yahoo"),
    [
        ("SET", "PTT", "PTT.BK"),
        ("SET", "PTTEP", "PTTEP.BK"),
        ("US", "AAPL", "AAPL"),
        ("US", "BRK-B", "BRK-B"),
        ("FX", "XAUUSD", "GC=F"),
        ("FX", "XAGUSD", "SI=F"),
        ("FX", "USDTHB", "THB=X"),
        ("FX", "EURUSD", "EURUSD=X"),  # generic FX pair
        ("FX", "USDJPY", "USDJPY=X"),
    ],
)
def test_T2_1_symbol_mapping(exchange, ticker, yahoo):
    assert to_yahoo(exchange, ticker) == yahoo


@pytest.mark.parametrize(("exchange", "ticker"), [("FX", "GOLD"), ("FX", "EURUSDX"), ("SET", "")])
def test_T2_1_bad_ticker_is_invalid_symbol(exchange, ticker):
    with pytest.raises(AdapterError) as err:
        to_yahoo(exchange, ticker)
    assert err.value.code == "invalid_symbol"


@pytest.mark.parametrize(
    ("quote", "symbol", "kind"),
    [
        ({"symbol": "PTT.BK", "quoteType": "EQUITY", "exchange": "SET"}, "SET:PTT", "stock"),
        ({"symbol": "AAPL", "quoteType": "EQUITY", "exchange": "NMS"}, "US:AAPL", "stock"),
        ({"symbol": "SPY", "quoteType": "ETF", "exchange": "PCX"}, "US:SPY", "stock"),
        ({"symbol": "THB=X", "quoteType": "CURRENCY", "exchange": "CCY"}, "FX:USDTHB", "fx"),
        ({"symbol": "EURUSD=X", "quoteType": "CURRENCY", "exchange": "CCY"}, "FX:EURUSD", "fx"),
        ({"symbol": "GC=F", "quoteType": "FUTURE", "exchange": "CMX"}, "FX:XAUUSD", "commodity"),
        ({"symbol": "PTTRX", "quoteType": "MUTUALFUND", "exchange": "NAS"}, None, None),
        ({"symbol": "VOD.L", "quoteType": "EQUITY", "exchange": "LSE"}, None, None),
        ({"symbol": "CL=F", "quoteType": "FUTURE", "exchange": "NYM"}, None, None),
    ],
)
def test_T2_1_search_result_mapping(quote, symbol, kind):
    info = from_yahoo(quote)
    if symbol is None:
        assert info is None
    else:
        assert (info.symbol, info.type, info.realtime) == (symbol, kind, False)


def test_frame_times_daily_is_utc_midnight_of_local_date_intraday_is_real_utc():
    daily = pd.DataFrame(
        {"Open": [1.0], "High": [2.0], "Low": [0.5], "Close": [1.5], "Volume": [10]},
        index=pd.DatetimeIndex([pd.Timestamp("2023-11-13").tz_localize(BKK)]),
    )
    assert frame_to_candles(daily, "1D")[0].time == MON  # not 2023-11-12 17:00 UTC
    us = daily.set_axis(pd.DatetimeIndex([pd.Timestamp("2023-11-15").tz_localize("US/Eastern")]))
    assert frame_to_candles(us, "1W")[0].time == MON  # Wednesday -> its Monday
    hourly = daily.set_axis(pd.DatetimeIndex([pd.Timestamp("2023-11-13 10:00").tz_localize(BKK)]))
    fx = daily.assign(Volume=[float("nan")])
    assert frame_to_candles(hourly, "1h")[0].time == MON + 3 * H
    assert frame_to_candles(fx, "1D")[0].volume == 0


# --- T2.2 resample --------------------------------------------------------------------------


def test_T2_2_resample_set_day_buckets_start_at_first_bar_of_local_day():
    # SET Monday: 10, 11, 12, 14, 15, 16 Bangkok = 03, 04, 05, 07, 08, 09 UTC (lunch break)
    bars = [candle(MON + h * H, 10 + h, 11 + h, 9 + h, 10.5 + h, h) for h in SET_HOURS_UTC]
    out = resample(bars, BKK)
    assert [k.time for k in out] == [MON + 3 * H, MON + 7 * H]  # not the UTC 4h grid 00/04/08
    first, second = out
    assert (first.open, first.high, first.low, first.close, first.volume) == (13, 16, 12, 15.5, 12)
    assert (second.open, second.high, second.low, second.close) == (17, 20, 16, 19.5)
    assert second.volume == 7 + 8 + 9


def test_T2_2_resample_missing_hours_and_next_day():
    bars = [
        candle(MON + 4 * H, 1, 2, 0.5, 1.5),  # first bar of the day is 11:00 local (10:00 missing)
        candle(MON + 8 * H, 2, 3, 1.5, 2.5),  # 15:00 local, 11:00 + 4h -> new bucket
        candle(MON + D + 3 * H, 3, 4, 2.5, 3.5),  # next day restarts at its first bar
    ]
    out = resample(list(reversed(bars)), BKK)
    assert [k.time for k in out] == [MON + 4 * H, MON + 8 * H, MON + D + 3 * H]
    assert [k.close for k in out] == [1.5, 2.5, 3.5]


def test_T2_2_resample_us_half_hour_session():
    day = MON + 14 * H + 1800  # 09:30 New York (EST) = 14:30 UTC
    bars = [candle(day + i * H, i, i + 1, i - 1, i + 0.5) for i in range(7)]  # 09:30 .. 15:30
    out = resample(bars, "America/New_York")
    assert [k.time for k in out] == [day, day + 4 * H]
    assert (out[0].open, out[0].close, out[1].open, out[1].close) == (0, 3.5, 4, 6.5)


def test_T2_2_adapter_4h_from_1h(fake_yahoo):
    adapter = YahooAdapter("SET", YahooSource(fake_yahoo.history, fake_yahoo.search), lambda: NOW)
    out = adapter.get_candles("PTT", "4h", MON, MON + D, 10)
    assert [k.time for k in out] == [MON + 3 * H, MON + 7 * H]
    assert {c[1] for c in fake_yahoo.calls} == {"60m"}
    assert fake_yahoo.calls[0][2] == MON - D  # fetched from a day earlier: whole local day


# --- T2.3 history limits --------------------------------------------------------------------


def test_T2_3_range_older_than_yahoo_keeps_sets_warning(tmp_path, fake_yahoo):
    service = service_with(tmp_path, fake_yahoo)
    old = service.get_candles("SET:PTT", "1h", NOW - 800 * D, 100)
    assert old.candles == [] and "only available since" in old.warning
    assert fake_yahoo.calls == []  # nothing Yahoo could serve was asked for

    earliest = NOW - 29 * D
    partial = service.get_candles("SET:PTT", "1m", earliest + 2 * D, 1000)
    assert 0 < len(partial.candles) < 1000
    assert all(k.time >= earliest for k in partial.candles)
    assert partial.warning and partial.delayed

    recent = service.get_candles("SET:PTT", "1h", None, 100)
    assert len(recent.candles) == 100 and recent.warning is None


def test_T2_3_1m_requests_are_split_into_week_chunks(fake_yahoo):
    adapter = YahooAdapter("SET", YahooSource(fake_yahoo.history, fake_yahoo.search), lambda: NOW)
    adapter.get_candles("PTT", "1m", NOW - 20 * D, NOW, 100_000)
    spans = [end - start for _, _, start, end in fake_yahoo.calls]
    assert len(spans) == 3 and max(spans) <= 7 * D


# --- T2.4 upstream failure ------------------------------------------------------------------


def yahoo_client(tmp_path, fake_yahoo, clock) -> TestClient:
    settings = Settings(db_path=tmp_path / "t.db", cors_origins=DEFAULT_CORS_ORIGINS.split(","))
    registry = yahoo_registry(fake_yahoo, clock, BINANCE=FakeAdapter())
    return TestClient(create_app(settings=settings, registry=registry, clock=clock))


def test_T2_4_yfinance_raises_serves_cache_with_warning(tmp_path, fake_yahoo):
    now = [NOW]
    client = yahoo_client(tmp_path, fake_yahoo, lambda: now[0])
    params = {"symbol": "SET:PTT", "interval": "1D", "limit": 5}
    first = client.get("/api/candles", params=params).json()
    assert len(first["candles"]) == 5 and first["warning"] is None and first["delayed"] is True

    now[0] += 120  # past the in-memory TTL of the newest candle
    fake_yahoo.fail["PTT.BK"] = RuntimeError("yfinance exploded")
    fake_yahoo.calls.clear()
    resp = client.get("/api/candles", params=params)
    assert resp.status_code == 200
    body = resp.json()
    assert "showing cached data" in body["warning"]
    # newest (Tuesday, still settling) was never stored; one older cached day fills its place
    assert len(body["candles"]) == 5
    assert body["candles"][1:] == first["candles"][:-1]
    assert len(fake_yahoo.calls) == 3  # retried


def test_T2_4_yfinance_raises_without_cache_is_502(tmp_path, fake_yahoo):
    fake_yahoo.fail["PTT.BK"] = RuntimeError("yfinance exploded")
    client = yahoo_client(tmp_path, fake_yahoo, lambda: NOW)
    resp = client.get("/api/candles", params={"symbol": "SET:PTT", "interval": "1D"})
    assert resp.status_code == 502 and resp.json()["error"]["code"] == "upstream_error"


def test_T2_4_unknown_yahoo_ticker_is_400(tmp_path, fake_yahoo):
    client = yahoo_client(tmp_path, fake_yahoo, lambda: NOW)
    resp = client.get("/api/candles", params={"symbol": "SET:NOPE", "interval": "1D"})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_symbol"


# --- T2.10 cache with gaps ------------------------------------------------------------------


def test_T2_10_limit_500_on_1h_stock_returns_500_bars(tmp_path, fake_yahoo):
    service = service_with(tmp_path, fake_yahoo)
    resp = service.get_candles("SET:PTT", "1h", None, 500)
    times = [k.time for k in resp.candles]
    assert len(times) == 500 and times == sorted(set(times))
    assert all(datetime.fromtimestamp(t, UTC).hour in SET_HOURS_UTC for t in times)
    assert resp.warning is None and len(fake_yahoo.calls) <= 3

    fake_yahoo.calls.clear()
    assert service.get_candles("SET:PTT", "1h", None, 500) == resp
    assert fake_yahoo.calls == []  # closed part from coverage, newest from the 60 s memory


def test_T2_10_weekend_and_night_ranges_make_zero_upstream_calls(tmp_path, fake_yahoo):
    now = [NOW]
    service = service_with(tmp_path, fake_yahoo, lambda: now[0])
    weekend = service.get_candles("SET:PTT", "1h", SUNDAY_NOON, 50)
    assert len(weekend.candles) == 50
    assert weekend.candles[-1].time == FRIDAY + 9 * H  # Friday 16:00 Bangkok
    night = service.get_candles("SET:PTT", "15m", MON + 23 * H, 100)
    assert len(night.candles) == 100

    now[0] += 3600  # TTL long gone: only coverage can avoid the calls
    fake_yahoo.calls.clear()
    assert service.get_candles("SET:PTT", "1h", SUNDAY_NOON, 50) == weekend
    assert service.get_candles("SET:PTT", "15m", MON + 23 * H, 100) == night
    assert service.get_candles("SET:PTT", "1h", SUNDAY_NOON - 6 * H, 20).candles  # inside
    assert fake_yahoo.calls == []


def test_T2_10_newest_unclosed_candle_is_refetched_after_ttl(tmp_path, fake_yahoo):
    now = [MON + 5 * H + 600]  # Monday 12:10 Bangkok: the 12:00 bar is still open
    fake_yahoo.now = now[0]
    service = service_with(tmp_path, fake_yahoo, lambda: now[0])
    first = service.get_candles("SET:PTT", "1h", None, 20)
    assert first.candles[-1].time == MON + 5 * H
    fake_yahoo.calls.clear()
    service.get_candles("SET:PTT", "1h", None, 20)
    assert fake_yahoo.calls == []  # within 60 s
    now[0] += 61
    service.get_candles("SET:PTT", "1h", None, 20)
    assert len(fake_yahoo.calls) == 1
    _, _, start, _ = fake_yahoo.calls[0]
    assert start >= MON + 4 * H  # only the unsettled tail, not the whole window


def test_T2_10_crypto_gap_is_not_refetched(tmp_path):
    class GappyAdapter(FakeAdapter):
        def get_candles(self, ticker, interval, start, end, limit):
            return [
                k
                for k in super().get_candles(ticker, interval, start, end, limit)
                if k.time % (7 * H)
            ]

    fake = GappyAdapter()
    from app.adapters.registry import Registry

    service = CandleService(Database(tmp_path / "c.db"), Registry({"BINANCE": fake}), lambda: NOW)
    end = NOW // H * H
    service.get_candles("BINANCE:BTCUSDT", "1h", end, 100)
    fake.calls.clear()
    assert len(service.get_candles("BINANCE:BTCUSDT", "1h", end, 100).candles) == 100
    assert fake.calls == []


def test_t2_13_yahoo_session_fails_fast_on_stalled_dns():
    # c-ares DNS lookups sometimes stall for the whole request timeout (10 s); the session's
    # connect timeout must stay short so YahooSource.history retries quickly (see yahoo._yf).
    from curl_cffi import CurlOpt

    from app.adapters import yahoo

    _, session = yahoo._yf()
    assert session is not None
    assert session.curl_options[CurlOpt.CONNECTTIMEOUT_MS] <= 3000

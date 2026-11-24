import httpx
import pytest

from app.adapters.base import AdapterError
from app.adapters.binance import WEIGHT_SLOWDOWN_AT
from tests.conftest import Recorder, binance_with


def ok(json_body, headers=None) -> httpx.Response:
    return httpx.Response(200, json=json_body, headers=headers or {})


def test_T1_1_kline_parse_matches_raw_fixture(klines_fixture):
    rec = Recorder(ok(klines_fixture))
    candles = binance_with(rec, []).get_candles("BTCUSDT", "1h", None, None, 50)

    assert len(candles) == len(klines_fixture) == 50
    for i in (0, 1, 25, -1):
        raw, c = klines_fixture[i], candles[i]
        assert c.time == raw[0] // 1000
        assert c.open == float(raw[1])
        assert c.high == float(raw[2])
        assert c.low == float(raw[3])
        assert c.close == float(raw[4])
        assert c.volume == float(raw[5])
    times = [c.time for c in candles]
    assert times == sorted(set(times))
    assert all(t % 3600 == 0 for t in times)
    params = rec.requests[0].url.params
    assert rec.requests[0].url.path == "/api/v3/klines"
    assert (params["symbol"], params["interval"], params["limit"]) == ("BTCUSDT", "1h", "50")
    assert "endTime" not in params and "startTime" not in params


@pytest.mark.parametrize(
    "ui, binance",
    [
        ("1m", "1m"),
        ("5m", "5m"),
        ("15m", "15m"),
        ("1h", "1h"),
        ("4h", "4h"),
        ("1D", "1d"),
        ("1W", "1w"),
    ],
)
def test_T1_2_interval_mapping(ui, binance):
    rec = Recorder(ok([]))
    binance_with(rec, []).get_candles("ETHUSDT", ui, 1_000, 2_000, 1500)
    params = rec.requests[0].url.params
    assert params["interval"] == binance
    assert params["startTime"] == "1000000"
    assert params["endTime"] == "1999999"  # our end is exclusive, Binance's is inclusive
    assert params["limit"] == "1000"  # clamped to Binance max


def test_T1_2_unknown_binance_symbol_is_invalid_symbol():
    rec = Recorder(httpx.Response(400, json={"code": -1121, "msg": "Invalid symbol."}))
    with pytest.raises(AdapterError) as err:
        binance_with(rec, []).get_candles("NOPEUSDT", "1h", None, None, 5)
    assert err.value.code == "invalid_symbol"
    assert len(rec.requests) == 1  # 4xx is not retried


def test_T1_5_429_with_retry_after_is_retried_then_succeeds(klines_fixture):
    rec = Recorder(httpx.Response(429, headers={"Retry-After": "2"}), ok(klines_fixture[:3]))
    sleeps: list[float] = []
    candles = binance_with(rec, sleeps).get_candles("BTCUSDT", "1h", None, None, 3)
    assert len(candles) == 3
    assert len(rec.requests) == 2
    assert sleeps == [2.0]


@pytest.mark.parametrize(
    "failure, code",
    [
        (httpx.Response(503), "upstream_error"),
        (httpx.Response(500), "upstream_error"),
        (httpx.ReadTimeout("timed out"), "upstream_error"),
        (httpx.ConnectError("refused"), "upstream_error"),
        (httpx.Response(429), "rate_limited"),
        (httpx.Response(418), "rate_limited"),
    ],
)
def test_T1_5_persistent_failure_errors_after_max_attempts(failure, code):
    rec = Recorder(failure)
    sleeps: list[float] = []
    with pytest.raises(AdapterError) as err:
        binance_with(rec, sleeps).get_candles("BTCUSDT", "1h", None, None, 5)
    assert err.value.code == code
    assert len(rec.requests) == 3
    assert sleeps == [0.5, 1.0]  # exponential backoff, injected (no real sleeping)


def test_T1_5_huge_retry_after_fails_fast():
    rec = Recorder(httpx.Response(418, headers={"Retry-After": "7200"}))
    sleeps: list[float] = []
    with pytest.raises(AdapterError) as err:
        binance_with(rec, sleeps).get_candles("BTCUSDT", "1h", None, None, 5)
    assert err.value.code == "rate_limited"
    assert len(rec.requests) == 1 and sleeps == []


def test_T1_5_high_used_weight_slows_down_next_request():
    heavy = {"X-MBX-USED-WEIGHT-1m": str(WEIGHT_SLOWDOWN_AT + 200)}
    rec = Recorder(ok([], heavy), ok([]))
    sleeps: list[float] = []
    adapter = binance_with(rec, sleeps, clock=lambda: 120.0 + 45)  # 45s into a minute
    adapter.get_candles("BTCUSDT", "1m", None, None, 5)
    assert sleeps == []
    adapter.get_candles("BTCUSDT", "1m", None, None, 5)
    assert sleeps == [15.0]  # waits until the 1-minute weight window resets


def test_T1_5_low_used_weight_does_not_slow_down():
    rec = Recorder(ok([], {"X-MBX-USED-WEIGHT-1m": "40"}))
    sleeps: list[float] = []
    adapter = binance_with(rec, sleeps)
    adapter.get_candles("BTCUSDT", "1m", None, None, 5)
    adapter.get_candles("BTCUSDT", "1m", None, None, 5)
    assert sleeps == []


def test_search_filters_usdt_trading_and_caches_exchange_info():
    info = {
        "symbols": [
            {"symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT", "status": "TRADING"},
            {
                "symbol": "BTCDOMUSDT",
                "baseAsset": "BTCDOM",
                "quoteAsset": "USDT",
                "status": "BREAK",
            },
            {"symbol": "BTCEUR", "baseAsset": "BTC", "quoteAsset": "EUR", "status": "TRADING"},
            {"symbol": "WBTCUSDT", "baseAsset": "WBTC", "quoteAsset": "USDT", "status": "TRADING"},
            {"symbol": "ETHUSDT", "baseAsset": "ETH", "quoteAsset": "USDT", "status": "TRADING"},
        ]
    }
    rec = Recorder(ok(info))
    adapter = binance_with(rec, [])
    results = adapter.search("btc")
    assert [r.symbol for r in results] == ["BINANCE:BTCUSDT", "BINANCE:WBTCUSDT"]
    assert results[0].model_dump() == {
        "symbol": "BINANCE:BTCUSDT",
        "name": "BTC / USDT",
        "exchange": "BINANCE",
        "type": "crypto",
        "realtime": True,
    }
    assert [r.symbol for r in adapter.search("BINANCE:eth")] == ["BINANCE:ETHUSDT"]
    assert adapter.search("  ") == []
    assert len(rec.requests) == 1

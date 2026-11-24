import sqlite3

import pytest

from app.adapters.registry import Registry
from app.db import Database
from app.models import Candle
from app.services.candles import CandleService, align
from tests.conftest import NOW, FakeAdapter

H = 3600
OPEN_SLOT = align(NOW, "1h")  # current (unclosed) 1h candle


@pytest.fixture
def db(tmp_path) -> Database:
    return Database(tmp_path / "cache.db")


@pytest.fixture
def service(db, fake) -> CandleService:
    return CandleService(db, Registry({"BINANCE": fake}), clock=lambda: NOW)


def test_T1_3_same_range_twice_second_call_makes_no_upstream_calls(service, fake):
    first = service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT, 100)
    assert fake.calls == [("BTCUSDT", "1h", OPEN_SLOT - 100 * H, OPEN_SLOT, 100)]
    assert len(first.candles) == 100
    assert first.candles[-1].time == OPEN_SLOT - H  # end is exclusive

    fake.calls.clear()
    second = service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT, 100)
    assert fake.calls == []
    assert second == first


def test_T1_3_partial_overlap_asks_upstream_for_narrower_range(service, fake):
    service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT - 10 * H, 100)
    fake.calls.clear()

    resp = service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT, 100)
    # only the 10 newest slots were missing
    assert fake.calls == [("BTCUSDT", "1h", OPEN_SLOT - 10 * H, OPEN_SLOT, 10)]
    times = [c.time for c in resp.candles]
    assert times == list(range(OPEN_SLOT - 100 * H, OPEN_SLOT, H))


def test_T1_3_older_history_only_fetches_what_is_missing(service, fake):
    service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT, 100)
    fake.calls.clear()
    service.get_candles("BINANCE:BTCUSDT", "1h", OPEN_SLOT, 150)
    assert fake.calls == [("BTCUSDT", "1h", OPEN_SLOT - 150 * H, OPEN_SLOT - 100 * H, 50)]


def test_T1_3_latest_request_refetches_only_the_open_candle(service, fake):
    first = service.get_candles("BINANCE:BTCUSDT", "1h", None, 50)
    assert [c.time for c in first.candles] == list(range(OPEN_SLOT - 49 * H, OPEN_SLOT + H, H))
    fake.calls.clear()

    service.get_candles("BINANCE:BTCUSDT", "1h", None, 50)
    assert fake.calls == [("BTCUSDT", "1h", OPEN_SLOT, OPEN_SLOT + H, 1)]


def test_T1_4_unclosed_latest_candle_is_returned_but_not_stored(service, db):
    resp = service.get_candles("BINANCE:BTCUSDT", "1h", None, 5)
    assert resp.candles[-1].time == OPEN_SLOT  # returned...

    with sqlite3.connect(db.path) as conn:
        rows = conn.execute(
            "SELECT time FROM candles WHERE symbol = 'BINANCE:BTCUSDT' AND interval = '1h'"
            " ORDER BY time"
        ).fetchall()
    stored = [t for (t,) in rows]
    assert stored == list(range(OPEN_SLOT - 4 * H, OPEN_SLOT, H))  # ...but never cached
    assert all(t + H <= NOW for t in stored)


def test_weekly_slots_open_on_monday(db):
    fake = FakeAdapter()
    service = CandleService(db, Registry({"BINANCE": fake}), clock=lambda: NOW)
    resp = service.get_candles("BINANCE:BTCUSDT", "1W", None, 3)
    # 2023-11-13 00:00 UTC was a Monday
    assert resp.candles[-1].time == 1_699_833_600
    assert [c.time for c in resp.candles] == [
        1_699_833_600 - 2 * 604800,
        1_699_833_600 - 604800,
        1_699_833_600,
    ]


class ClosedMarketAdapter(FakeAdapter):
    """Delayed source whose newest 1m bar is `last` (market closed / data delayed since)."""

    def __init__(self, last: int):
        super().__init__()
        self.last = last

    def is_realtime(self) -> bool:
        return False

    def get_candles(self, ticker, interval, start, end, limit):
        self.calls.append((ticker, interval, start, end, limit))
        s = 60
        hi = min(end, self.last + s)
        return [
            Candle(time=t, open=1, high=2, low=0.5, close=1.5, volume=1)
            for t in range(align(start + s - 1, "1m"), hi, s)
        ]


@pytest.mark.parametrize(
    "gap_hours", [0.25, 6, 64, 24 * 5], ids=["15min-delay", "overnight", "weekend", "5-day-holiday"]
)
@pytest.mark.parametrize("limit", [1, 3])
def test_T2_14_latest_small_limit_reaches_back_over_empty_gaps(db, gap_hours, limit):
    # Newest bar is gap_hours old: limit=1 (the "as of" badge) and limit=3 (polling) must still
    # find it, not give up after a few doublings of a 1-minute window.
    last = align(NOW - int(gap_hours * 3600), "1m")
    adapter = ClosedMarketAdapter(last)
    service = CandleService(db, Registry({"SET": adapter}), clock=lambda: NOW)
    res = service.get_candles("SET:PTT", "1m", None, limit)
    assert [k.time for k in res.candles] == [last - (limit - 1 - i) * 60 for i in range(limit)]

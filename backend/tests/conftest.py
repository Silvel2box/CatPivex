import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.binance import BinanceAdapter
from app.adapters.registry import Registry
from app.adapters.yahoo import YahooAdapter, YahooSource
from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.main import create_app
from app.models import INTERVAL_SECONDS, INTERVALS, Candle, SymbolInfo
from app.services.candles import align

FIXTURES = Path(__file__).parent / "fixtures"
NOW = 1_700_000_000  # 2023-11-14 22:13:20 UTC, 800s into the 22:00 hour


class FakeAdapter:
    """Synthesises one candle per grid slot up to the current open candle; records calls."""

    def __init__(self, now: int = NOW):
        self.now = now
        self.calls: list[tuple[str, str, int | None, int | None, int]] = []

    def supported_intervals(self) -> list[str]:
        return list(INTERVALS)

    def is_realtime(self) -> bool:
        return True

    def earliest_time(self, interval: str, now: int) -> int | None:
        return None

    def search(self, query: str) -> list[SymbolInfo]:
        return []

    def get_candles(self, ticker, interval, start, end, limit):
        self.calls.append((ticker, interval, start, end, limit))
        s = INTERVAL_SECONDS[interval]
        last = align(self.now, interval)
        if end is not None:
            last = min(last, align(end - 1, interval))
        first = start if start is not None else last - (limit - 1) * s
        times = list(range(first, last + 1, s))[:limit]
        return [Candle(time=t, open=1, high=2, low=0.5, close=1.5, volume=t % 97) for t in times]


def make_app(tmp_path: Path, registry: Registry, now: int = NOW) -> FastAPI:
    settings = Settings(db_path=tmp_path / "test.db", cors_origins=DEFAULT_CORS_ORIGINS.split(","))
    return create_app(settings=settings, registry=registry, clock=lambda: now)


@pytest.fixture
def fake() -> FakeAdapter:
    return FakeAdapter()


@pytest.fixture
def client(tmp_path, fake) -> TestClient:
    return TestClient(make_app(tmp_path, Registry({"BINANCE": fake})))


@pytest.fixture
def klines_fixture() -> list[list]:
    return json.loads((FIXTURES / "binance_klines_1h.json").read_text(encoding="utf-8"))


class Recorder:
    """httpx MockTransport handler that replays `responses` in order and records requests."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        item = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(item, Exception):
            raise item
        return item


def binance_with(recorder: Recorder, sleeps: list[float], clock=lambda: 30.0) -> BinanceAdapter:
    return BinanceAdapter(
        client=httpx.Client(transport=httpx.MockTransport(recorder)),
        sleep=sleeps.append,
        clock=clock,
    )


BKK = "Asia/Bangkok"
SET_HOURS_UTC = (3, 4, 5, 7, 8, 9)  # 1h bars 10-12 and 14-16 Bangkok time
YF_STEP = {"1m": 60, "5m": 300, "15m": 900, "60m": 3600}


class YFTzMissingError(Exception):
    """Same class name as yfinance's 'no such ticker' error (the adapter maps by name)."""


class FakeYahoo:
    """Stands in for yfinance: SET-like sessions (Mon-Fri, 10:00-13:00 and 14:00-17:00
    Bangkok), bars up to `now`. Records history calls; `fail` = {yahoo ticker: exception}."""

    def __init__(self, now: int = NOW):
        self.now = now
        self.calls: list[tuple] = []
        self.search_calls: list[str] = []
        self.quotes: list[dict] = []
        self.search_error: Exception | None = None
        self.fail: dict[str, Exception] = {"NOPE.BK": YFTzMissingError("$NOPE.BK: no timezone")}
        self.daily_closes: dict[date, float] = {}

    def history(self, ticker: str, interval: str, start, end) -> pd.DataFrame:
        self.calls.append((ticker, interval, start, end))
        if ticker in self.fail:
            raise self.fail[ticker]
        if interval == "1d":
            d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
            days = [d0 + timedelta(days=n) for n in range((d1 - d0).days)]
            days = [d for d in days if d.weekday() < 5 and _bkk_ts(d, 10) <= self.now]
            closes = [self.daily_closes.get(d, 35.0) for d in days]
            index = pd.DatetimeIndex([pd.Timestamp(d).tz_localize(BKK) for d in days])
            return _frame(index, closes)
        step = YF_STEP[interval]
        times = [
            t
            for t in range(start // step * step, end, step)
            if start <= t <= self.now
            and datetime.fromtimestamp(t, UTC).hour in SET_HOURS_UTC
            and datetime.fromtimestamp(t + 7 * 3600, UTC).weekday() < 5
        ]
        index = pd.to_datetime(times, unit="s", utc=True).tz_convert(BKK)
        return _frame(index, [100 + (t // step) % 50 / 10 for t in times])

    def search(self, query: str) -> list[dict]:
        self.search_calls.append(query)
        if self.search_error:
            raise self.search_error
        return self.quotes


def _bkk_ts(d: date, hour: int) -> int:
    return int(datetime(d.year, d.month, d.day, hour, tzinfo=UTC).timestamp()) - 7 * 3600


def _frame(index: pd.DatetimeIndex, closes: list[float]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Open": [c - 0.5 for c in closes],
            "High": [c + 1 for c in closes],
            "Low": [c - 1 for c in closes],
            "Close": closes,
            "Adj Close": closes,
            "Volume": [1000] * len(closes),
        },
        index=index,
    )


def yahoo_registry(fake_yahoo: FakeYahoo, clock=lambda: NOW, **extra) -> Registry:
    source = YahooSource(fake_yahoo.history, fake_yahoo.search, sleep=lambda _: None, clock=clock)
    adapters = {ex: YahooAdapter(ex, source, clock=clock) for ex in ("SET", "US", "FX")}
    return Registry({**extra, **adapters})


@pytest.fixture
def fake_yahoo() -> FakeYahoo:
    return FakeYahoo()

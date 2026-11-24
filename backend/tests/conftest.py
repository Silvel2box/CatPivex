import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.binance import BinanceAdapter
from app.adapters.registry import Registry
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

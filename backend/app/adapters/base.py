"""DataAdapter interface shared by every market data source."""

from typing import Protocol

from app.errors import ApiError
from app.models import Candle, SymbolInfo


class AdapterError(ApiError):
    """Raised by adapters; `code` is a contract ErrorCode (e.g. invalid_symbol, rate_limited)."""


class DataAdapter(Protocol):
    def search(self, query: str) -> list[SymbolInfo]: ...

    def get_candles(
        self, ticker: str, interval: str, start: int | None, end: int | None, limit: int
    ) -> list[Candle]:
        """Candles with start <= time < end (unix seconds; None = unbounded), ascending.

        `interval` is a UI interval from models.INTERVALS. With `start` set, returns the first
        `limit` candles from start; otherwise the last `limit` candles before `end`.
        """
        ...

    def supported_intervals(self) -> list[str]: ...

    def is_realtime(self) -> bool:
        """False = delayed source: show a "Delayed" badge, let candles settle before caching."""
        ...

    def earliest_time(self, interval: str, now: int) -> int | None:
        """Oldest candle time the source still serves for `interval` (None = no limit)."""
        ...

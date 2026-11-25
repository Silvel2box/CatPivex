"""In-memory TEST exchange for e2e: 1m candles set through PUT /api/test/price."""

import threading

from app.models import Candle, SymbolInfo


class MemoryFeedAdapter:
    def __init__(self):
        self._bars: dict[str, dict[int, Candle]] = {}
        self._lock = threading.Lock()

    def set_price(self, ticker: str, price: float, now: int) -> None:
        t = now // 60 * 60
        with self._lock:
            bars = self._bars.setdefault(ticker, {})
            k = bars.get(t)
            bars[t] = (
                Candle(time=t, open=price, high=price, low=price, close=price, volume=0)
                if k is None
                else k.model_copy(
                    update={"high": max(k.high, price), "low": min(k.low, price), "close": price}
                )
            )

    def search(self, query: str) -> list[SymbolInfo]:
        return []

    def get_candles(
        self, ticker: str, interval: str, start: int | None, end: int | None, limit: int
    ) -> list[Candle]:
        with self._lock:
            bars = sorted(self._bars.get(ticker, {}).values(), key=lambda k: k.time)
        bars = [
            k for k in bars if (start is None or k.time >= start) and (end is None or k.time < end)
        ]
        return bars[:limit] if start is not None else bars[-limit:]

    def supported_intervals(self) -> list[str]:
        return ["1m"]

    def is_realtime(self) -> bool:
        return True

    def earliest_time(self, interval: str, now: int) -> int | None:
        return None

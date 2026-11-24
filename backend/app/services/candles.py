"""Cache-first candle loading.

Algorithm (all times are candle open times on the interval grid):
1. Work out the requested slots: the `limit` grid slots ending before `end` (exclusive; without
   `end`, up to and including the current open candle). Slots before the current open candle
   are closed (time + interval <= now); the open one is never stored.
2. Read cached closed candles for those slots from SQLite. If closed slots are missing, ask the
   adapter for the single span [first missing, last missing] - extended to `stop` when the open
   candle is also requested. If nothing closed is missing, only the open candle (if requested)
   is fetched. A fully cached closed range makes zero upstream calls.
3. Upsert fetched closed candles, merge with the cache, return the last `limit` ascending.

Known limitations: slots that upstream genuinely has no data for (before a symbol was listed,
exchange outages) are never cached, so requests covering them refetch that span every time.
Missing slots in the middle of cached data are refetched as one span including the cached part
between them. "Closed" uses the local clock, so a clock running ahead of Binance could store a
candle that Binance has not finalised yet.
"""

import time
from collections.abc import Callable

from app.adapters.registry import Registry
from app.db import Database
from app.errors import ApiError
from app.models import INTERVAL_SECONDS, INTERVALS, Candle, CandlesResponse

# The unix epoch was a Thursday; weekly candles open on Monday 00:00 UTC (Binance convention).
WEEK_OFFSET_SECONDS = 4 * 86400


def slot_offset(interval: str) -> int:
    return WEEK_OFFSET_SECONDS if interval == "1W" else 0


def align(t: int, interval: str) -> int:
    """Open time of the slot containing t."""
    s, off = INTERVAL_SECONDS[interval], slot_offset(interval)
    return (t - off) // s * s + off


class CandleService:
    def __init__(self, db: Database, registry: Registry, clock: Callable[[], float] = time.time):
        self.db = db
        self.registry = registry
        self.clock = clock

    def get_candles(
        self, symbol: str, interval: str, end: int | None, limit: int
    ) -> CandlesResponse:
        if interval not in INTERVALS:
            raise ApiError("invalid_interval", f"Interval must be one of {', '.join(INTERVALS)}")
        adapter, canonical, ticker = self.registry.resolve(symbol)
        if interval not in adapter.supported_intervals():
            raise ApiError("invalid_interval", f"{interval} is not supported for {canonical}")

        s = INTERVAL_SECONDS[interval]
        now = int(self.clock())
        open_slot = align(now, interval)  # the current, not yet closed candle
        stop = open_slot + s if end is None else min(end, open_slot + s)  # exclusive
        start = max(align(stop - 1, interval) - (limit - 1) * s, slot_offset(interval))
        if start >= stop:
            return CandlesResponse(symbol=canonical, interval=interval, candles=[])
        closed_stop = min(stop, open_slot)

        merged: dict[int, Candle] = {
            k.time: k for k in self.db.get_candles(canonical, interval, start, closed_stop)
        }
        missing = [t for t in range(start, closed_stop, s) if t not in merged]
        wants_open = stop > open_slot
        if missing:
            fetch_from = missing[0]
            fetch_to = stop if wants_open else missing[-1] + s
        elif wants_open:
            fetch_from, fetch_to = open_slot, stop
        else:
            fetch_from = fetch_to = None

        if fetch_from is not None and fetch_to is not None:
            fetched = adapter.get_candles(
                ticker, interval, fetch_from, fetch_to, (fetch_to - fetch_from) // s
            )
            self.db.upsert_candles(canonical, interval, [k for k in fetched if k.time + s <= now])
            merged.update((k.time, k) for k in fetched)

        candles = [merged[t] for t in sorted(merged) if start <= t < stop][-limit:]
        return CandlesResponse(
            symbol=canonical,
            interval=interval,
            candles=candles,
            delayed=not adapter.is_realtime(),
        )

"""Cache-first candle loading, for continuous (crypto) and session-based (stocks, FX) markets.

Algorithm:
1. stop = `end` (exclusive) or just past the current open candle. Window = the `limit` interval
   slots before stop: [lo, stop).
2. SQLite keeps candles plus *coverage*: merged [start, end) ranges that were already fetched
   (closed part only). Only uncovered pieces of the window are fetched, clamped to what the
   source still serves (adapter.earliest_time). Nights, weekends and holidays inside a covered
   range cost no upstream call although they hold no candles; a fully covered window costs zero.
3. Fetched candles that are closed (time + interval <= now - settle; settle = 30 min for delayed
   sources, whose newest bars may still be filling in) are upserted and their range added to
   coverage. Unclosed ones are returned, never stored; for delayed sources they are kept in
   memory for 60 s, so polling the latest candles does not hit upstream every time.
4. If the window holds fewer than `limit` candles (sessions, gaps), it is widened from the
   observed density and step 2 repeats (max 5 rounds) until `limit` candles, the source's
   earliest time (-> `warning`) or the epoch. The last `limit` are returned ascending.
5. Upstream failure (AdapterError upstream_error / rate_limited): no more fetches; the window
   keeps widening over the cache only. Cached candles are returned with `warning`; if there are
   none the error propagates (502 / 503).

Known limitations: cached history is never re-validated (e.g. after a stock split). "Closed"
uses the local clock, so a clock running ahead of the source could store an unfinished candle.
"""

import logging
import math
import time
from collections.abc import Callable
from datetime import UTC, datetime

from app.adapters.base import AdapterError, DataAdapter
from app.adapters.registry import Registry
from app.db import Database
from app.errors import ApiError
from app.models import INTERVAL_SECONDS, INTERVALS, Candle, CandlesResponse

log = logging.getLogger(__name__)

# The unix epoch was a Thursday; weekly candles open on Monday 00:00 UTC (Binance convention).
WEEK_OFFSET_SECONDS = 4 * 86400
DELAYED_SETTLE_SECONDS = 30 * 60
OPEN_CANDLE_TTL_SECONDS = 60
MAX_ROUNDS = 5
MAX_GROWTH = 16  # a widened window is at most this many times the previous one


def slot_offset(interval: str) -> int:
    return WEEK_OFFSET_SECONDS if interval == "1W" else 0


def align(t: int, interval: str) -> int:
    """Open time of the slot containing t."""
    s, off = INTERVAL_SECONDS[interval], slot_offset(interval)
    return (t - off) // s * s + off


def uncovered(lo: int, hi: int, covered: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Pieces of [lo, hi) not inside any of the ascending, disjoint `covered` ranges."""
    pieces, cursor = [], lo
    for a, b in covered:
        if a > cursor:
            pieces.append((cursor, min(a, hi)))
        cursor = max(cursor, b)
        if cursor >= hi:
            break
    if cursor < hi:
        pieces.append((cursor, hi))
    return [(a, b) for a, b in pieces if a < b]


class CandleService:
    def __init__(self, db: Database, registry: Registry, clock: Callable[[], float] = time.time):
        self.db = db
        self.registry = registry
        self.clock = clock
        # (symbol, interval) -> (fetched at, piece start, piece end, unclosed candles in it)
        self._open_cache: dict[tuple[str, str], tuple[float, int, int, list[Candle]]] = {}

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
        stop = align(now, interval) + s  # every candle (even an off-grid one) opens before this
        if end is not None:
            stop = min(end, stop)
        origin = slot_offset(interval)
        lo = max(align(stop - 1, interval) - (limit - 1) * s, origin)
        if lo >= stop:
            return CandlesResponse(symbol=canonical, interval=interval, candles=[])
        earliest = adapter.earliest_time(interval, now)
        floor = max(origin, earliest if earliest is not None else origin)

        unclosed: dict[int, Candle] = {}
        failure: AdapterError | None = None
        filled_from = stop  # [filled_from, stop) was handled by an earlier round
        for _ in range(MAX_ROUNDS):
            if failure is None and max(lo, floor) < filled_from:  # after a failure: cache only
                try:
                    start = max(lo, floor)
                    self._fill(adapter, canonical, ticker, interval, start, filled_from, now)
                except AdapterError as exc:
                    if exc.code not in ("upstream_error", "rate_limited"):
                        raise
                    log.warning("Upstream failed for %s %s: %s", canonical, interval, exc.message)
                    failure = exc
                filled_from = max(lo, floor)
            merged = {k.time: k for k in self.db.get_candles(canonical, interval, lo, stop)}
            unclosed.update(self._unclosed(canonical, interval, now, lo, stop))
            merged.update(unclosed)
            if len(merged) >= limit or lo <= floor:
                break
            window = stop - lo
            grow = math.ceil(window * limit / max(len(merged), 1) * 1.25)
            window = min(max(grow, 2 * window), MAX_GROWTH * window)
            lo = max(align(stop - window, interval), origin)

        candles = [merged[t] for t in sorted(merged)][-limit:]
        warning = None
        if failure is not None:
            if not candles:
                raise failure
            warning = f"Upstream failed ({failure.message}); showing cached data"
        elif len(candles) < limit and earliest is not None and lo < earliest:
            since = datetime.fromtimestamp(earliest, UTC).strftime("%Y-%m-%d %H:%M")
            warning = f"{interval} history for {canonical} is only available since {since} UTC"
        return CandlesResponse(
            symbol=canonical,
            interval=interval,
            candles=candles,
            delayed=not adapter.is_realtime(),
            warning=warning,
        )

    def _fill(
        self,
        adapter: DataAdapter,
        canonical: str,
        ticker: str,
        interval: str,
        lo: int,
        hi: int,
        now: int,
    ) -> None:
        """Fetches the uncovered pieces of [lo, hi); stores closed candles + their coverage."""
        s = INTERVAL_SECONDS[interval]
        delayed = not adapter.is_realtime()
        closed_cut = now - (DELAYED_SETTLE_SECONDS if delayed else 0) - s  # closed: time <= it
        key = (canonical, interval)
        for a, b in uncovered(lo, hi, self.db.get_coverage(canonical, interval, lo, hi)):
            hit = self._open_cache.get(key)
            fresh = hit is not None and now - hit[0] < OPEN_CANDLE_TTL_SECONDS
            if delayed and fresh and hit[1] <= a < b <= hit[2]:
                continue  # newest candles were fetched moments ago; _unclosed() serves them
            fetched = adapter.get_candles(ticker, interval, a, b, math.ceil((b - a) / s))
            closed = [k for k in fetched if k.time <= closed_cut]
            still_open = [k for k in fetched if k.time > closed_cut]
            self.db.upsert_candles(canonical, interval, closed)
            # Covered up to the first unclosed candle; past the last closed one nothing can
            # start before last + interval, so an aligned boundary is kept for grid sources.
            cover_to = closed_cut + 1
            if closed:
                cover_to = max(cover_to, closed[-1].time + s)
            if still_open:
                cover_to = min(cover_to, still_open[0].time)
            self.db.add_coverage(canonical, interval, a, min(cover_to, b))
            if b > closed_cut + 1:  # piece reaches the unclosed area
                self._open_cache[key] = (now, a, b, still_open)

    def _unclosed(
        self, canonical: str, interval: str, now: int, lo: int, hi: int
    ) -> dict[int, Candle]:
        hit = self._open_cache.get((canonical, interval))
        if not hit or now - hit[0] >= OPEN_CANDLE_TTL_SECONDS:
            return {}
        return {k.time: k for k in hit[3] if lo <= k.time < hi}

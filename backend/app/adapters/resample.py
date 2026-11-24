"""Pure candle aggregation (1h -> 4h for sources without native 4h, e.g. Yahoo)."""

from datetime import date, datetime
from functools import cache
from zoneinfo import ZoneInfo

from app.models import Candle

FOUR_HOURS = 4 * 3600


@cache
def _zone(tz: str) -> ZoneInfo:
    return ZoneInfo(tz)


def local_date(t: int, tz: str) -> date:
    """Exchange-local calendar date of unix time t."""
    return datetime.fromtimestamp(t, _zone(tz)).date()


def resample(candles: list[Candle], tz: str, seconds: int = FOUR_HOURS) -> list[Candle]:
    """Aggregates candles into `seconds` buckets, ascending.

    Buckets start at the FIRST candle of each exchange-local day (`tz`, e.g. "Asia/Bangkok"),
    then every `seconds` after it, so a session is not split at UTC/grid boundaries (SET 10:00
    local -> buckets 10:00 and 14:00). open = first, high = max, low = min, close = last,
    volume = sum. Missing candles just leave a bucket smaller or absent.
    """
    out: list[Candle] = []
    day: date | None = None
    first = 0
    for k in sorted(candles, key=lambda c: c.time):
        d = local_date(k.time, tz)
        if d != day:
            day, first = d, k.time
        t = first + (k.time - first) // seconds * seconds
        if out and out[-1].time == t:
            b = out[-1]
            b.high, b.low = max(b.high, k.high), min(b.low, k.low)
            b.close, b.volume = k.close, b.volume + k.volume
        else:
            out.append(k.model_copy(update={"time": t}))
    return out

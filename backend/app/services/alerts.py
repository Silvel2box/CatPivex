"""Price alert evaluation (pure functions). Rules: project task list, Phase 5 P5.0."""

import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.models import Candle

FETCH_BARS = 5  # newest 1m candles fetched per check; older moves are not looked at
CRYPTO_INTERVAL_S = 30
OTHER_INTERVAL_S = 60
THAI_TZ = ZoneInfo("Asia/Bangkok")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
CONDITION_TEXT = {
    "crosses": "crossed",
    "crosses_above": "crossed above",
    "crosses_below": "crossed below",
    "gte": "is at or above",
    "lte": "is at or below",
}


def check_interval(symbol: str, override: int | None = None) -> int:
    if override is not None:
        return override
    return CRYPTO_INTERVAL_S if symbol.upper().startswith("BINANCE:") else OTHER_INTERVAL_S


def window_extremes(
    candles: list[Candle],
    base_time: int | None,
    base_high: float | None,
    base_low: float | None,
    base_close: float | None,
    include_base_close: bool = True,
) -> tuple[float, float]:
    newest = candles[-1].close
    if base_time is None or base_close is None:
        return newest, newest
    high, low = newest, newest
    if include_base_close:
        high, low = max(base_close, newest), min(base_close, newest)
    for k in candles:
        if k.time > base_time:
            high, low = max(high, k.high), min(low, k.low)
        elif k.time == base_time:
            if base_high is None or k.high > base_high:
                high = max(high, k.high)
            if base_low is None or k.low < base_low:
                low = min(low, k.low)
    return high, low


def should_fire(
    condition: str,
    level: float,
    high: float,
    low: float,
    base_close: float | None,
    armed: bool,
    base_level: float | None = None,
) -> bool:
    ref = level if base_level is None else base_level
    above = base_close is not None and base_close < ref and level <= high
    below = base_close is not None and base_close > ref and level >= low
    if condition == "crosses_above":
        return above
    if condition == "crosses_below":
        return below
    if condition == "crosses":
        return above or below
    if condition == "gte":
        return armed and high >= level
    if condition == "lte":
        return armed and low <= level
    raise ValueError(f"Unknown condition {condition!r}")


def next_armed(condition: str, level: float, close: float, armed: bool, fired: bool) -> bool:
    if condition not in ("gte", "lte"):
        return True
    if fired:
        return False
    if (condition == "gte" and close < level) or (condition == "lte" and close > level):
        return True
    return armed


def format_price(value: float) -> str:
    a = abs(value)
    if a >= 1000:
        return f"{value:,.2f}"
    if a >= 1:
        text = f"{value:,.4f}".rstrip("0")
        return text if len(text.split(".")[1]) >= 2 else f"{value:,.2f}"
    if a == 0:
        return "0"
    return f"{value:.{3 - math.floor(math.log10(a))}f}".rstrip("0")


def format_message(
    symbol: str,
    condition: str,
    level: float,
    price: float,
    time: int,
    note: str,
    trend: bool = False,
) -> str:
    t = datetime.fromtimestamp(time, THAI_TZ)
    when = f"{t.day} {MONTHS[t.month - 1]} {t:%H:%M}"
    line = "trend line " if trend else ""
    text = (
        f"🔔 {symbol} {CONDITION_TEXT[condition]} {line}{format_price(level)}"
        f" — now {format_price(price)} · {when} (Thai time)"
    )
    return f"{text}\n{note}" if note.strip() else text


LINE_TYPES = ("hline", "hray", "trendline")


def _number(v: Any) -> float | None:
    if not isinstance(v, int | float) or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _anchor(v: Any) -> tuple[float, float] | None:
    if not isinstance(v, dict):
        return None
    t, p = _number(v.get("time")), _number(v.get("price"))
    return None if t is None or p is None else (t, p)


def linkable_lines(drawings: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        d["id"]: d for d in drawings if d.get("type") in LINE_TYPES and isinstance(d.get("id"), str)
    }


def line_level(d: dict[str, Any], at: float) -> float | None:
    kind = d.get("type")
    level: float | None = None
    if kind == "hline":
        level = _number(d.get("price"))
    elif kind == "hray":
        a = d.get("a")
        level = _number(a.get("price")) if isinstance(a, dict) else None
    elif kind == "trendline":
        a, b = _anchor(d.get("a")), _anchor(d.get("b"))
        if a is not None and b is not None and a[0] != b[0]:
            level = a[1] + (b[1] - a[1]) * (at - a[0]) / (b[0] - a[0])
    return level if level is not None and math.isfinite(level) and level > 0 else None


def line_levels(drawings: list[dict[str, Any]], at: float) -> dict[str, float | None]:
    return {i: line_level(d, at) for i, d in linkable_lines(drawings).items()}

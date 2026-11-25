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
) -> tuple[float, float]:
    newest = candles[-1].close
    if base_time is None or base_close is None:
        return newest, newest
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
) -> bool:
    above = base_close is not None and base_close < level <= high
    below = base_close is not None and base_close > level >= low
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
    symbol: str, condition: str, level: float, price: float, time: int, note: str
) -> str:
    t = datetime.fromtimestamp(time, THAI_TZ)
    when = f"{t.day} {MONTHS[t.month - 1]} {t:%H:%M}"
    text = (
        f"🔔 {symbol} {CONDITION_TEXT[condition]} {format_price(level)}"
        f" — now {format_price(price)} · {when} (Thai time)"
    )
    return f"{text}\n{note}" if note.strip() else text


def hline_prices(drawings: list[dict[str, Any]]) -> dict[str, float | None]:
    """id -> price of every 'hline' / 'hray' (None when it is not a positive number)."""
    out: dict[str, float | None] = {}
    for d in drawings:
        kind = d.get("type")
        if kind not in ("hline", "hray") or not isinstance(d.get("id"), str):
            continue
        a = d.get("a")
        p = d.get("price") if kind == "hline" else a.get("price") if isinstance(a, dict) else None
        ok = isinstance(p, int | float) and not isinstance(p, bool) and math.isfinite(p) and p > 0
        out[d["id"]] = float(p) if ok else None
    return out

"""Price alert evaluation. Pure functions here; the scheduler job wires them to the DB.

Each check of a symbol fetches its newest 1m candles (CandleService, limit FETCH_BARS, the last
one still open) and evaluates every enabled alert of that symbol:

1. Window: the price range since this alert's last check, from window_extremes(). A wick that
   touched the level between two checks counts (user decision 2026-11-25).
2. Fire: should_fire(condition, level, high, low, base_close, armed).
3. Then, fired or not: the baseline becomes the newest bar (base_time/high/low/close) and
   `armed` is updated by next_armed().
4. On fire: insert an AlertEvent (deliveries from notifiers.dispatch), set last_triggered_at;
   if not `repeat`, set enabled = 0.

Baseline (alerts.base_*): taken on POST and when PATCH re-enables an alert (enabled false ->
true), best effort: if the price fetch fails it stays NULL and the next check only takes it.
Moving the level (PATCH price, linked line moved) or changing the condition keeps it: the window
describes the price path, not the level. `armed` is set to 1 on POST and on re-enable.

Conditions, with L = level and [low, high] = window:
- crosses_above: base_close < L <= high      (needs a baseline; a close exactly at L is no side)
- crosses_below: base_close > L >= low
- crosses:       either of the two above
- gte:           armed and high >= L         (fires on the first check if already above)
- lte:           armed and low <= L
`armed` only matters for gte/lte: it goes to 0 when they fire and back to 1 (repeat alerts)
once a check ends on the other side (close < L for gte, close > L for lte). A repeating alert
therefore fires once per visit to the condition, not on every check.
"""

from app.models import Candle

FETCH_BARS = 5  # newest 1m candles fetched per check; older moves are not looked at
CRYPTO_INTERVAL_S = 30
OTHER_INTERVAL_S = 60


def check_interval(symbol: str, override: int | None = None) -> int:
    """Seconds between checks: `override` if set, else 30 for BINANCE:*, 60 for the rest."""
    raise NotImplementedError


def window_extremes(
    candles: list[Candle],
    base_time: int | None,
    base_high: float | None,
    base_low: float | None,
    base_close: float | None,
) -> tuple[float, float]:
    """(high, low) of the price since the baseline. `candles` = ascending, non-empty.

    No baseline (base_time None): high = low = the newest close.
    Otherwise the range covers base_close and the newest close, plus
    - every candle with time > base_time: its high/low,
    - the candle with time == base_time (still the same bar as last check): its high only if
      > base_high and its low only if < base_low (a new extreme made after the last check),
    - candles with time < base_time: ignored (already seen).
    """
    raise NotImplementedError


def should_fire(
    condition: str,
    level: float,
    high: float,
    low: float,
    base_close: float | None,
    armed: bool,
) -> bool:
    """Whether the alert fires for this window; see the table in the module docstring."""
    raise NotImplementedError


def next_armed(condition: str, level: float, close: float, armed: bool, fired: bool) -> bool:
    """`armed` after a check: False if it fired; True (gte) once close < level, True (lte) once
    close > level; otherwise unchanged. Always True for crosses* (unused)."""
    raise NotImplementedError


def format_message(
    symbol: str, condition: str, level: float, price: float, time: int, note: str
) -> str:
    """Text for Telegram/LINE, e.g.
    "🔔 BINANCE:BTCUSDT crossed above 98,500 — now 98,512.3 · 25 Nov 14:03 (Thai time)\n<note>".
    The note line is left out when empty."""
    raise NotImplementedError

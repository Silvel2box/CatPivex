"""Shared API contract. Mirror of frontend/src/api/types.ts — change both together.

GET /api/candles?symbol=BINANCE:BTCUSDT&interval=1h&end=<unix s>&limit=500
  - Returns up to `limit` candles (1..1000, default 500) sorted by time ascending, no duplicates.
  - `end` (optional, exclusive): only candles with time < end. Used for loading history when
    scrolling left: pass the time of the oldest candle you already have.
  - Without `end`: the latest candles, including the current (not yet closed) one.
  - `time` = candle open time, unix seconds, UTC.

  - 1D / 1W candles of every source use 00:00 UTC of the trading date (week: of the Monday) as
    `time`, so dates read the same in any timezone. Intraday candles use the real open time.
  - `delayed` = the source is not realtime (show a "Delayed" badge). `warning` = human readable
    note, e.g. the requested range is older than the source keeps, or stale cache was served.

GET /api/symbols/search?q=  -> list[SymbolInfo] (merged from all adapters, max 30)

Watchlist (ordered list of full symbols). Every call returns Watchlist:
  GET    /api/watchlist
  POST   /api/watchlist            body {"symbol": "SET:PTT"}  -> appended (no-op if present)
  PUT    /api/watchlist            body {"symbols": [...]}     -> replace order (drag reorder)
  DELETE /api/watchlist/{symbol}                               -> removed (no-op if absent)
  A fresh database starts with DEFAULT_WATCHLIST.

GET /api/quotes?symbols=BINANCE:BTCUSDT,SET:PTT -> list[Quote], same order as requested.
  price = latest close; change/change_percent vs the previous 1D candle's close.
  A symbol that fails has price null and `error` set; the others still return.

Drawings per symbol (opaque JSON objects; the frontend validates them on load):
  GET    /api/drawings/{symbol}    -> DrawingsResponse, drawings [] if none saved
  PUT    /api/drawings/{symbol}    body {"drawings": [{...}, ...]} (max MAX_DRAWINGS) -> replaces
  DELETE /api/drawings/{symbol}    -> drawings [] (no-op if none saved; format check only)
  GET/PUT take a symbol in any case (or with %3A for the colon) and answer with the canonical one.

Chart layout (one opaque JSON object):
  GET /api/layout                  -> LayoutResponse, layout null until the first save
  PUT /api/layout                  body {"layout": {...}} ({} is allowed) -> stored layout

Price alerts (Phase 5; evaluation rules in app/services/alerts.py):
  GET    /api/alerts                  -> list[Alert], ascending id
  POST   /api/alerts                  body AlertCreate -> Alert (201)
  PATCH  /api/alerts/{id}             body AlertUpdate (only the fields to change) -> Alert
  DELETE /api/alerts/{id}             -> 204 (404 not_found if absent)
  GET    /api/alerts/events?after=<event id>&limit=50   (limit 1..500)
                                      -> list[AlertEvent], newest first, only id > after.
    The frontend polls this for browser notifications (it remembers the newest id it has seen)
    and shows it as the history. Events stay when their alert is deleted.
  Linked alerts (drawing_id set) follow a horizontal line of the same symbol:
    - POST with drawing_id: 422 validation_error unless that symbol's saved drawings hold an
      'hline' with that id; `price` is then taken from the line (the body's value is ignored).
      The frontend flushes pending drawing saves before posting.
    - PUT /api/drawings/{symbol} syncs them: line moved -> alert price = line price; line gone
      -> alert deleted. DELETE /api/drawings/{symbol} deletes them all.
    - PATCH of `price` on a linked alert: 422 validation_error (move the line instead).
  Checks run in the backend (APScheduler, started with the app when settings.alerts_enabled).

Test feed (only when CATPIVEX_TEST_FEED=1, for e2e; never in normal runs):
  Exchange TEST (realtime, no search results): any ticker, 1m candles only, kept in memory.
  PUT /api/test/price  body {"symbol": "TEST:FOO", "price": 100.0} -> 204
    Updates the 1m bar of the current minute (first price of a minute opens o=h=l=c, later ones
    move h/l/c), so alerts on TEST:* see a price crossing within one check interval.

Every error response (any status >= 400) has the body ErrorResponse.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, FiniteFloat

Interval = Literal["1m", "5m", "15m", "1h", "4h", "1D", "1W"]
INTERVALS: tuple[str, ...] = ("1m", "5m", "15m", "1h", "4h", "1D", "1W")
INTERVAL_SECONDS: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1D": 86400,
    "1W": 604800,
}

AssetType = Literal["crypto", "stock", "fx", "commodity"]

ErrorCode = Literal[
    "invalid_symbol",  # malformed or unknown symbol
    "invalid_interval",  # not in INTERVALS or not supported by the adapter
    "validation_error",  # other bad query params
    "not_found",
    "rate_limited",  # upstream rate limit still hit after retries
    "upstream_error",  # upstream API failed / timed out after retries
    "internal_error",
]


class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class SymbolInfo(BaseModel):
    symbol: str  # full form, e.g. "BINANCE:BTCUSDT"
    name: str  # human readable, e.g. "Bitcoin / TetherUS"
    exchange: str  # e.g. "BINANCE"
    type: AssetType
    realtime: bool  # False = delayed source (show "Delayed" badge)


class CandlesResponse(BaseModel):
    symbol: str
    interval: Interval
    candles: list[Candle]
    delayed: bool = False
    warning: str | None = None  # e.g. requested range exceeds what the source keeps


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


DEFAULT_WATCHLIST: tuple[str, ...] = (
    "BINANCE:BTCUSDT",
    "BINANCE:ETHUSDT",
    "SET:PTT",
    "US:AAPL",
    "FX:XAUUSD",
    "FX:USDTHB",
)


class Watchlist(BaseModel):
    symbols: list[str]


class WatchlistAdd(BaseModel):
    symbol: str


class Quote(BaseModel):
    symbol: str
    price: float | None
    change: float | None
    change_percent: float | None
    time: int | None  # open time of the candle `price` comes from
    delayed: bool
    error: ErrorBody | None = None


MAX_DRAWINGS = 1000

JsonObject = dict[str, Any]  # stored and returned as-is, never interpreted by the backend


class DrawingsBody(BaseModel):
    drawings: list[JsonObject] = Field(max_length=MAX_DRAWINGS)


class DrawingsResponse(BaseModel):
    symbol: str
    drawings: list[JsonObject]


class LayoutBody(BaseModel):
    layout: JsonObject


class LayoutResponse(BaseModel):
    layout: JsonObject | None


AlertCondition = Literal["crosses", "crosses_above", "crosses_below", "gte", "lte"]
MAX_ALERT_NOTE = 200


class Alert(BaseModel):
    id: int
    symbol: str  # canonical, e.g. "BINANCE:BTCUSDT"
    condition: AlertCondition
    price: float  # the level; for a linked alert, kept equal to its line's price
    repeat: bool  # False = disable after the first trigger
    enabled: bool
    drawing_id: str | None  # the 'hline' this alert follows, None = standalone
    note: str
    created_at: int  # unix s
    last_triggered_at: int | None


class AlertCreate(BaseModel):
    symbol: str
    condition: AlertCondition
    price: FiniteFloat = Field(gt=0)
    repeat: bool = False
    drawing_id: str | None = Field(default=None, min_length=1, max_length=100)
    note: str = Field(default="", max_length=MAX_ALERT_NOTE)


class AlertUpdate(BaseModel):
    """PATCH body: only the fields sent are changed. symbol / drawing_id cannot change."""

    condition: AlertCondition | None = None
    price: FiniteFloat | None = Field(default=None, gt=0)
    repeat: bool | None = None
    enabled: bool | None = None
    note: str | None = Field(default=None, max_length=MAX_ALERT_NOTE)


class AlertEvent(BaseModel):
    id: int
    alert_id: int  # the alert may have been deleted since
    symbol: str
    condition: AlertCondition
    level: float  # alert price at the time of the trigger
    price: float  # latest close at the check that triggered
    time: int  # unix s of the check
    message: str  # the text sent to Telegram/LINE
    deliveries: dict[str, str]  # channel -> "ok" | "error: ..." ({} if no channel configured)

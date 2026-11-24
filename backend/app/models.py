"""Shared API contract. Mirror of frontend/src/api/types.ts — change both together.

GET /api/candles?symbol=BINANCE:BTCUSDT&interval=1h&end=<unix s>&limit=500
  - Returns up to `limit` candles (1..1000, default 500) sorted by time ascending, no duplicates.
  - `end` (optional, exclusive): only candles with time < end. Used for loading history when
    scrolling left: pass the time of the oldest candle you already have.
  - Without `end`: the latest candles, including the current (not yet closed) one.
  - `time` = candle open time, unix seconds, UTC.

Every error response (any status >= 400) has the body ErrorResponse.
"""

from typing import Literal

from pydantic import BaseModel

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

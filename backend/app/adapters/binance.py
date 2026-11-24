"""Binance spot REST adapter (history + symbol search). Realtime is browser -> Binance WS."""

import logging
import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.adapters.base import AdapterError
from app.models import INTERVALS, Candle, SymbolInfo

log = logging.getLogger(__name__)

BASE_URL = "https://api.binance.com"
INTERVAL_MAP = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "4h",
    "1D": "1d",
    "1W": "1w",
}
MAX_LIMIT = 1000
SEARCH_LIMIT = 20

TIMEOUT_SECONDS = 10.0
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 0.5  # 0.5s, 1s, ...
MAX_RETRY_AFTER_SECONDS = 10.0  # a longer Retry-After (e.g. 418 IP ban) fails fast instead
WEIGHT_LIMIT_1M = 6000
WEIGHT_SLOWDOWN_AT = int(WEIGHT_LIMIT_1M * 0.8)

TICKER_RE = re.compile(r"^[A-Z0-9]{2,20}$")


class BinanceAdapter:
    def __init__(
        self,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
    ):
        self._client = client or httpx.Client(timeout=TIMEOUT_SECONDS)
        self._sleep = sleep
        self._clock = clock
        self._used_weight = 0
        self._weight_minute = -1  # minute (clock // 60) in which _used_weight was reported
        self._symbols: list[dict[str, Any]] | None = None  # exchangeInfo cache (per process)

    def supported_intervals(self) -> list[str]:
        return list(INTERVALS)

    def is_realtime(self) -> bool:
        return True

    def get_candles(
        self, ticker: str, interval: str, start: int | None, end: int | None, limit: int
    ) -> list[Candle]:
        if not TICKER_RE.match(ticker):
            raise AdapterError("invalid_symbol", f"Invalid Binance ticker: {ticker!r}")
        if interval not in INTERVAL_MAP:
            raise AdapterError("invalid_interval", f"Unsupported interval: {interval!r}")
        params: dict[str, Any] = {
            "symbol": ticker,
            "interval": INTERVAL_MAP[interval],
            "limit": max(1, min(limit, MAX_LIMIT)),
        }
        if start is not None:
            params["startTime"] = start * 1000
        if end is not None:
            params["endTime"] = end * 1000 - 1  # Binance endTime is inclusive, ours is exclusive
        candles = [parse_kline(row) for row in self._get("/api/v3/klines", params)]
        return [
            k
            for k in candles
            if (start is None or k.time >= start) and (end is None or k.time < end)
        ]

    def search(self, query: str) -> list[SymbolInfo]:
        q = query.strip().upper().removeprefix("BINANCE:")
        if not q:
            return []
        if self._symbols is None:
            info = self._get("/api/v3/exchangeInfo", {})
            self._symbols = [
                s
                for s in info.get("symbols", [])
                if s.get("quoteAsset") == "USDT" and s.get("status") == "TRADING"
            ]

        def rank(s: dict[str, Any]) -> int:
            if s["symbol"] == q or s["baseAsset"] == q:
                return 0
            return 1 if s["symbol"].startswith(q) else 2

        matches = sorted(
            (s for s in self._symbols if q in s["symbol"]), key=lambda s: (rank(s), s["symbol"])
        )
        return [
            SymbolInfo(
                symbol=f"BINANCE:{s['symbol']}",
                name=f"{s['baseAsset']} / {s['quoteAsset']}",
                exchange="BINANCE",
                type="crypto",
                realtime=True,
            )
            for s in matches[:SEARCH_LIMIT]
        ]

    # --- HTTP with rate limiting / retries -------------------------------------------------

    def _throttle(self) -> None:
        """Wait for the 1-minute weight window to reset if the last response said we're near it."""
        now = self._clock()
        if self._used_weight >= WEIGHT_SLOWDOWN_AT and int(now // 60) == self._weight_minute:
            wait = 60 - (now % 60)
            log.warning("Binance used weight %s/1m, waiting %.1fs", self._used_weight, wait)
            self._sleep(wait)
            self._used_weight = 0

    def _record_weight(self, resp: httpx.Response) -> None:
        header = resp.headers.get("X-MBX-USED-WEIGHT-1m")
        if header and header.isdigit():
            self._used_weight = int(header)
            self._weight_minute = int(self._clock() // 60)

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        code, message = "upstream_error", "Binance request failed"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._throttle()
            delay = BACKOFF_BASE_SECONDS * 2 ** (attempt - 1)
            try:
                resp = self._client.get(BASE_URL + path, params=params)
            except httpx.TimeoutException:
                code, message = "upstream_error", "Binance request timed out"
            except httpx.TransportError as exc:
                code, message = "upstream_error", f"Binance connection failed: {exc}"
            else:
                self._record_weight(resp)
                status = resp.status_code
                if status in (429, 418):
                    code, message = "rate_limited", f"Binance rate limit hit (HTTP {status})"
                    retry_after = _retry_after(resp)
                    if retry_after is not None:
                        if retry_after > MAX_RETRY_AFTER_SECONDS:
                            raise AdapterError(code, f"{message}, retry after {retry_after:.0f}s")
                        delay = retry_after
                elif status >= 500:
                    code, message = "upstream_error", f"Binance error (HTTP {status})"
                elif status >= 400:
                    raise _client_error(resp)
                else:
                    return resp.json()
            log.warning("Binance %s attempt %d/%d: %s", path, attempt, MAX_ATTEMPTS, message)
            if attempt < MAX_ATTEMPTS:
                self._sleep(delay)
        raise AdapterError(code, f"{message} after {MAX_ATTEMPTS} attempts")


def parse_kline(row: list[Any]) -> Candle:
    """[openTime ms, open, high, low, close, volume, closeTime, ...] -> Candle."""
    return Candle(
        time=int(row[0]) // 1000,
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
    )


def _retry_after(resp: httpx.Response) -> float | None:
    try:
        return float(resp.headers["Retry-After"])
    except (KeyError, ValueError):
        return None


def _client_error(resp: httpx.Response) -> AdapterError:
    try:
        body = resp.json()
        binance_code, msg = body.get("code"), body.get("msg", "")
    except ValueError:
        binance_code, msg = None, resp.text[:200]
    if binance_code == -1121:
        return AdapterError("invalid_symbol", "Unknown symbol on Binance")
    return AdapterError(
        "upstream_error", f"Binance rejected the request (HTTP {resp.status_code}): {msg}"
    )

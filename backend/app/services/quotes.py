"""Latest price + change vs the previous 1D candle, built on the candle service."""

import logging
from concurrent.futures import ThreadPoolExecutor

from app.adapters.registry import parse_symbol
from app.errors import ApiError
from app.models import ErrorBody, Quote
from app.services.candles import CandleService

log = logging.getLogger(__name__)

MAX_WORKERS = 8


def get_quotes(service: CandleService, symbols: list[str]) -> list[Quote]:
    """One Quote per symbol, same order; a failing symbol gets `error`, the others still return."""
    if not symbols:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(symbols))) as pool:
        return list(pool.map(lambda s: get_quote(service, s), symbols))


def get_quote(service: CandleService, symbol: str) -> Quote:
    try:
        resp = service.get_candles(symbol, "1D", None, 2)
        if not resp.candles:
            raise ApiError("not_found", f"No daily candles for {resp.symbol}")
    except Exception as exc:
        if not isinstance(exc, ApiError):
            log.exception("Quote for %s failed", symbol)
            exc = ApiError("internal_error", "Internal error")
        return Quote(
            symbol=_canonical(symbol),
            price=None,
            change=None,
            change_percent=None,
            time=None,
            delayed=False,
            error=ErrorBody(code=exc.code, message=exc.message),
        )
    last = resp.candles[-1]
    change = pct = None
    if len(resp.candles) > 1:
        prev = resp.candles[-2].close
        change = last.close - prev
        pct = change / prev * 100 if prev else None
    return Quote(
        symbol=resp.symbol,
        price=last.close,
        change=change,
        change_percent=pct,
        time=last.time,
        delayed=resp.delayed,
    )


def _canonical(symbol: str) -> str:
    try:
        return ":".join(parse_symbol(symbol))
    except ApiError:
        return symbol.strip()

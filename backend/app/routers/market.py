from fastapi import APIRouter, Query, Request

from app.errors import ApiError
from app.models import CandlesResponse, Quote, SymbolInfo
from app.services.quotes import get_quotes

router = APIRouter(prefix="/api")

MAX_QUOTE_SYMBOLS = 50


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/candles")
def candles(
    request: Request,
    symbol: str,
    interval: str,  # validated by the service -> 400 invalid_interval (not 422)
    end: int | None = Query(None, ge=0),
    limit: int = Query(500, ge=1, le=1000),
) -> CandlesResponse:
    return request.app.state.candle_service.get_candles(symbol, interval, end, limit)


@router.get("/symbols/search")
def search_symbols(request: Request, q: str = "") -> list[SymbolInfo]:
    return request.app.state.registry.search(q)


@router.get("/quotes")
def quotes(request: Request, symbols: str = "") -> list[Quote]:
    wanted = [s.strip() for s in symbols.split(",") if s.strip()]
    if len(wanted) > MAX_QUOTE_SYMBOLS:
        raise ApiError("validation_error", f"At most {MAX_QUOTE_SYMBOLS} symbols per request")
    return get_quotes(request.app.state.candle_service, wanted)

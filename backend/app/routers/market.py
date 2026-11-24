from fastapi import APIRouter, Query, Request

from app.models import CandlesResponse, SymbolInfo

router = APIRouter(prefix="/api")


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

"""Per-symbol drawings and the last chart layout. Both are opaque JSON, see models.py."""

from collections.abc import Callable

from fastapi import APIRouter, Request

from app.adapters.registry import parse_symbol
from app.errors import ApiError
from app.models import DrawingsBody, DrawingsResponse, LayoutBody, LayoutResponse

router = APIRouter(prefix="/api")


def _canonical(request: Request, symbol: str) -> str:
    """Canonical 'EXCHANGE:TICKER'; 400 invalid_symbol if malformed or unknown exchange."""
    return request.app.state.registry.resolve(symbol)[1]


def _store(save: Callable[[], None]) -> None:
    try:
        save()
    except ValueError as exc:  # NaN/Infinity: Python's parser accepts them, JSON does not
        raise ApiError("validation_error", f"Body is not storable as JSON: {exc}") from exc


@router.get("/drawings/{symbol}")
def get_drawings(request: Request, symbol: str) -> DrawingsResponse:
    symbol = _canonical(request, symbol)
    return DrawingsResponse(symbol=symbol, drawings=request.app.state.db.get_drawings(symbol))


@router.put("/drawings/{symbol}")
def put_drawings(request: Request, symbol: str, body: DrawingsBody) -> DrawingsResponse:
    symbol = _canonical(request, symbol)
    db = request.app.state.db
    _store(lambda: db.set_drawings(symbol, body.drawings))
    return DrawingsResponse(symbol=symbol, drawings=db.get_drawings(symbol))


@router.delete("/drawings/{symbol}")
def delete_drawings(request: Request, symbol: str) -> DrawingsResponse:
    # Format check only, so drawings of an exchange that is no longer configured can be cleared.
    symbol = ":".join(parse_symbol(symbol))
    request.app.state.db.delete_drawings(symbol)
    return DrawingsResponse(symbol=symbol, drawings=[])


@router.get("/layout")
def get_layout(request: Request) -> LayoutResponse:
    return LayoutResponse(layout=request.app.state.db.get_layout())


@router.put("/layout")
def put_layout(request: Request, body: LayoutBody) -> LayoutResponse:
    db = request.app.state.db
    _store(lambda: db.set_layout(body.layout))
    return LayoutResponse(layout=db.get_layout())

from fastapi import APIRouter, Request

from app.adapters.registry import parse_symbol
from app.models import Watchlist, WatchlistAdd

router = APIRouter(prefix="/api/watchlist")


def _list(request: Request) -> Watchlist:
    return Watchlist(symbols=request.app.state.db.get_watchlist())


def _validate(request: Request, symbol: str) -> str:
    """Canonical 'EXCHANGE:TICKER'; 400 invalid_symbol if malformed or unknown exchange."""
    return request.app.state.registry.resolve(symbol)[1]


@router.get("")
def get_watchlist(request: Request) -> Watchlist:
    return _list(request)


@router.post("")
def add_symbol(request: Request, body: WatchlistAdd) -> Watchlist:
    request.app.state.db.add_to_watchlist(_validate(request, body.symbol))
    return _list(request)


@router.put("")
def reorder(request: Request, body: Watchlist) -> Watchlist:
    symbols = [_validate(request, s) for s in body.symbols]
    request.app.state.db.set_watchlist(list(dict.fromkeys(symbols)))
    return _list(request)


@router.delete("/{symbol}")
def remove_symbol(request: Request, symbol: str) -> Watchlist:
    # Format check only, so a symbol whose exchange is no longer configured can be removed.
    request.app.state.db.remove_from_watchlist(":".join(parse_symbol(symbol)))
    return _list(request)

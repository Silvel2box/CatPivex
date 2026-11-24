"""FastAPI app. Run with: uvicorn app.main:app --host 127.0.0.1 --port 8000"""

import logging
import time
from collections.abc import Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.adapters.binance import BinanceAdapter
from app.adapters.registry import Registry
from app.config import Settings, load_settings
from app.db import Database
from app.errors import ApiError
from app.models import ErrorCode
from app.routers import market
from app.services.candles import CandleService

log = logging.getLogger(__name__)


def error_response(status: int, code: ErrorCode, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _http_error_code(status: int) -> ErrorCode:
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    return "validation_error" if status < 500 else "internal_error"


def create_app(
    settings: Settings | None = None,
    registry: Registry | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    settings = settings or load_settings()
    registry = registry or Registry({"BINANCE": BinanceAdapter()})

    app = FastAPI(title="CatPivex API")
    app.state.registry = registry
    app.state.candle_service = CandleService(Database(settings.db_path), registry, clock)
    app.include_router(market.router)

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = [
            f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg', '')}"
            for e in exc.errors()
        ]
        return error_response(422, "validation_error", "; ".join(parts) or "Invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error_response(exc.status_code, _http_error_code(exc.status_code), str(exc.detail))

    # Added before CORS so it sits inside it: unhandled-error 500s still carry CORS headers.
    @app.middleware("http")
    async def unhandled_error_middleware(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            log.exception("Unhandled error on %s %s", request.method, request.url.path)
            return error_response(500, "internal_error", "Internal server error")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


app = create_app()

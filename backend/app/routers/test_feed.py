from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, FiniteFloat

from app.errors import ApiError

router = APIRouter(prefix="/api/test")


class PriceBody(BaseModel):
    symbol: str
    price: FiniteFloat = Field(gt=0)


@router.put("/price", status_code=204)
def put_price(request: Request, body: PriceBody) -> Response:
    _, canonical, ticker = request.app.state.registry.resolve(body.symbol)
    if not canonical.startswith("TEST:"):
        raise ApiError("invalid_symbol", f"Only TEST:* symbols take test prices, got {canonical}")
    request.app.state.test_feed.set_price(ticker, body.price, int(request.app.state.clock()))
    return Response(status_code=204)

import logging

from fastapi import APIRouter, Query, Request, Response

from app.db import Database
from app.errors import ApiError
from app.models import Alert, AlertCreate, AlertEvent, AlertUpdate, Candle, JsonObject
from app.services.alert_checks import fetch_bars
from app.services.alerts import hline_prices

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts")


def _baseline(request: Request, symbol: str) -> Candle | None:
    try:
        return fetch_bars(request.app.state.candle_service, symbol)[-1]
    except Exception as exc:  # best effort: the first check takes it instead
        log.warning("No alert baseline for %s: %s", symbol, getattr(exc, "message", exc))
        return None


def _get(db: Database, alert_id: int) -> Alert:
    alert = db.get_alert(alert_id)
    if alert is None:
        raise ApiError("not_found", f"Alert {alert_id} not found")
    return alert


def sync_linked_alerts(db: Database, symbol: str, drawings: list[JsonObject]) -> None:
    """Linked alerts follow their horizontal line or ray: moved -> new price, gone -> deleted."""
    lines = hline_prices(drawings)
    for alert in db.list_alerts(symbol, linked_only=True):
        if alert.drawing_id not in lines:
            db.delete_alert(alert.id)
            continue
        price = lines[alert.drawing_id]
        if price is not None and price != alert.price:
            db.update_alert(alert.id, {"price": price})


@router.get("")
def list_alerts(request: Request) -> list[Alert]:
    return request.app.state.db.list_alerts()


@router.post("", status_code=201)
def create_alert(request: Request, body: AlertCreate) -> Alert:
    db: Database = request.app.state.db
    symbol = request.app.state.registry.resolve(body.symbol)[1]
    body = body.model_copy(update={"symbol": symbol})
    if body.drawing_id is not None:
        price = hline_prices(db.get_drawings(symbol)).get(body.drawing_id)
        if price is None:
            raise ApiError(
                "validation_error",
                f"No horizontal line or ray {body.drawing_id!r} with a valid price"
                f" in {symbol} drawings",
            )
        body = body.model_copy(update={"price": price})
    now = int(request.app.state.clock())
    return db.create_alert(body, now, _baseline(request, symbol))


@router.get("/events")
def list_events(
    request: Request,
    after: int = Query(0),
    limit: int = Query(50, ge=1, le=500),
) -> list[AlertEvent]:
    return request.app.state.db.list_alert_events(after, limit)


@router.patch("/{alert_id}")
def update_alert(request: Request, alert_id: int, body: AlertUpdate) -> Alert:
    db: Database = request.app.state.db
    alert = _get(db, alert_id)
    fields = body.model_dump(exclude_none=True)
    if "price" in fields and alert.drawing_id is not None:
        raise ApiError(
            "validation_error", "This alert follows a horizontal line or ray: move it instead"
        )
    rebase = fields.get("enabled") is True and not alert.enabled
    base = _baseline(request, alert.symbol) if rebase else None
    updated = db.update_alert(alert_id, fields, rebase=rebase, base=base)
    if updated is None:
        raise ApiError("not_found", f"Alert {alert_id} not found")
    return updated


@router.delete("/{alert_id}", status_code=204)
def delete_alert(request: Request, alert_id: int) -> Response:
    if not request.app.state.db.delete_alert(alert_id):
        raise ApiError("not_found", f"Alert {alert_id} not found")
    return Response(status_code=204)

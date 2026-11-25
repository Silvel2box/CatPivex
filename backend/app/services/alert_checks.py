"""Runs alert checks: fetch newest 1m bars per symbol, evaluate, record, notify."""

import logging
import time
from collections.abc import Callable

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import Database
from app.errors import ApiError
from app.models import AlertEvent, Candle
from app.notifiers import Notifier, dispatch
from app.services.alerts import (
    FETCH_BARS,
    check_interval,
    format_message,
    next_armed,
    should_fire,
    window_extremes,
)
from app.services.candles import CandleService

log = logging.getLogger(__name__)

TICK_S = 5


def fetch_bars(service: CandleService, symbol: str) -> list[Candle]:
    """Newest 1m candles; raises ApiError when the source failed (also when only cache is left)."""
    resp = service.get_candles(symbol, "1m", None, FETCH_BARS)
    if resp.warning:
        raise ApiError("upstream_error", resp.warning)
    if not resp.candles:
        raise ApiError("not_found", f"No 1m candles for {resp.symbol}")
    return resp.candles


class AlertChecker:
    def __init__(
        self,
        db: Database,
        candles: CandleService,
        notifiers: list[Notifier],
        interval_override: int | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.db = db
        self.candles = candles
        self.notifiers = notifiers
        self.interval_override = interval_override
        self.clock = clock
        self._last_check: dict[str, float] = {}

    def tick(self) -> None:
        """Checks every symbol with enabled alerts whose interval has elapsed."""
        for symbol in self.db.enabled_alert_symbols():
            now = self.clock()
            last = self._last_check.get(symbol)
            if last is not None and now - last < check_interval(symbol, self.interval_override):
                continue
            self._last_check[symbol] = now
            try:
                self.check_symbol(symbol)
            except Exception as exc:
                if isinstance(exc, ApiError):
                    log.warning("Alert check for %s skipped: %s", symbol, exc.message)
                else:
                    log.exception("Alert check for %s failed", symbol)

    def check_symbol(self, symbol: str) -> list[AlertEvent]:
        states = self.db.enabled_alert_states(symbol)
        if not states:
            return []
        bars = fetch_bars(self.candles, symbol)
        newest = bars[-1]
        now = int(self.clock())
        events = []
        for st in states:
            a = st.alert
            if st.base_time is not None and newest.time < st.base_time:
                continue  # source went back in time; keep the newer baseline
            high, low = window_extremes(
                bars, st.base_time, st.base_high, st.base_low, st.base_close
            )
            fired = should_fire(a.condition, a.price, high, low, st.base_close, st.armed)
            armed = next_armed(a.condition, a.price, newest.close, st.armed, fired)
            if not fired:
                self.db.save_check(a.id, newest, armed)
                continue
            message = format_message(symbol, a.condition, a.price, newest.close, now, a.note)
            deliveries = dispatch(self.notifiers, message)
            event = self.db.save_trigger(
                a.id,
                newest,
                armed,
                disable=not a.repeat,
                event={
                    "symbol": symbol,
                    "condition": a.condition,
                    "level": a.price,
                    "price": newest.close,
                    "time": now,
                    "message": message,
                    "deliveries": deliveries,
                },
            )
            if event:
                events.append(event)
        return events


def start_scheduler(checker: AlertChecker) -> BackgroundScheduler:
    tick = min(TICK_S, checker.interval_override or TICK_S)
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        checker.tick, "interval", seconds=tick, max_instances=1, coalesce=True, id="alerts"
    )
    scheduler.start()
    return scheduler

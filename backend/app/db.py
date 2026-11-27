"""SQLite storage: closed candles, which time ranges were fetched (coverage), the watchlist,
drawings per symbol, the chart layout, price alerts and their trigger history."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, NamedTuple

from app.models import (
    DEFAULT_WATCHLIST,
    Alert,
    AlertCreate,
    AlertEvent,
    Candle,
    JsonObject,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
    symbol   TEXT    NOT NULL,
    interval TEXT    NOT NULL,
    time     INTEGER NOT NULL,
    o REAL NOT NULL,
    h REAL NOT NULL,
    l REAL NOT NULL,
    c REAL NOT NULL,
    v REAL NOT NULL,
    PRIMARY KEY (symbol, interval, time)
);
-- [start, end) ranges whose closed candles are all in `candles` (possibly none: nights,
-- weekends). Ranges of one (symbol, interval) never overlap or touch; add_coverage merges.
CREATE TABLE IF NOT EXISTS candle_coverage (
    symbol   TEXT    NOT NULL,
    interval TEXT    NOT NULL,
    start    INTEGER NOT NULL,
    end      INTEGER NOT NULL,
    PRIMARY KEY (symbol, interval, start)
);
CREATE TABLE IF NOT EXISTS watchlist (
    symbol   TEXT    PRIMARY KEY,
    position INTEGER NOT NULL
);
-- meta keys: 'watchlist_seeded', 'layout' (JSON object of the last chart layout)
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- data = JSON array of the symbol's drawings, stored verbatim
CREATE TABLE IF NOT EXISTS drawings (
    symbol TEXT PRIMARY KEY,
    data   TEXT NOT NULL
);
-- Price alerts (API shape: models.Alert). base_* and armed are evaluation state, internal, see
-- services/alerts.py: the newest 1m bar seen at the last check (time/high/low/close; NULL = no
-- baseline yet) and whether a gte/lte alert may fire.
CREATE TABLE IF NOT EXISTS alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol            TEXT    NOT NULL,
    condition         TEXT    NOT NULL,
    price             REAL    NOT NULL,
    repeat            INTEGER NOT NULL DEFAULT 0,
    enabled           INTEGER NOT NULL DEFAULT 1,
    drawing_id        TEXT,
    note              TEXT    NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    last_triggered_at INTEGER,
    base_time         INTEGER,
    base_high         REAL,
    base_low          REAL,
    base_close        REAL,
    armed             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS alerts_symbol ON alerts (symbol);
-- Trigger history (models.AlertEvent). No foreign key: history outlives deleted alerts.
-- deliveries = JSON object channel -> "ok" | "error: ...".
CREATE TABLE IF NOT EXISTS alert_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id   INTEGER NOT NULL,
    symbol     TEXT    NOT NULL,
    condition  TEXT    NOT NULL,
    level      REAL    NOT NULL,
    price      REAL    NOT NULL,
    time       INTEGER NOT NULL,
    message    TEXT    NOT NULL,
    deliveries TEXT    NOT NULL
);
"""


def _dumps(value: object) -> str:
    """Strict JSON: raises ValueError on NaN/Infinity, which would make the value unreadable."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class AlertState(NamedTuple):
    alert: Alert
    base_time: int | None
    base_high: float | None
    base_low: float | None
    base_close: float | None
    armed: bool


class Database:
    """Opens a short-lived connection per call, so it is safe from any thread.

    The file and schema are created on first use, not at construction. A fresh database gets
    DEFAULT_WATCHLIST once; emptying the watchlist later does not seed it again.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        if not self._initialized:
            conn.executescript(SCHEMA)
            with conn:
                seeded = conn.execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES ('watchlist_seeded', '1')"
                ).rowcount
                if seeded:
                    conn.executemany(
                        "INSERT OR IGNORE INTO watchlist (symbol, position) VALUES (?, ?)",
                        [(s, i) for i, s in enumerate(DEFAULT_WATCHLIST)],
                    )
            self._initialized = True
        return conn

    # --- candles ----------------------------------------------------------------------------

    def get_candles(self, symbol: str, interval: str, start: int, end: int) -> list[Candle]:
        """Cached candles with start <= time < end, ascending."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT time, o, h, l, c, v FROM candles"
                " WHERE symbol = ? AND interval = ? AND time >= ? AND time < ? ORDER BY time",
                (symbol, interval, start, end),
            ).fetchall()
        return [
            Candle(time=t, open=o, high=h, low=lo, close=c, volume=v) for t, o, h, lo, c, v in rows
        ]

    def upsert_candles(self, symbol: str, interval: str, candles: list[Candle]) -> None:
        if not candles:
            return
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "INSERT OR REPLACE INTO candles (symbol, interval, time, o, h, l, c, v)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (symbol, interval, k.time, k.open, k.high, k.low, k.close, k.volume)
                    for k in candles
                ],
            )

    def get_coverage(
        self, symbol: str, interval: str, start: int, end: int
    ) -> list[tuple[int, int]]:
        """Covered [start, end) ranges overlapping [start, end), ascending."""
        with closing(self._connect()) as conn:
            return conn.execute(
                "SELECT start, end FROM candle_coverage"
                " WHERE symbol = ? AND interval = ? AND start < ? AND end > ? ORDER BY start",
                (symbol, interval, end, start),
            ).fetchall()

    def add_coverage(self, symbol: str, interval: str, start: int, end: int) -> None:
        """Marks [start, end) as fetched, merged with overlapping or touching ranges."""
        if start >= end:
            return
        with closing(self._connect()) as conn, conn:
            key = (symbol, interval)
            rows = conn.execute(
                "SELECT start, end FROM candle_coverage"
                " WHERE symbol = ? AND interval = ? AND start <= ? AND end >= ?",
                (*key, end, start),
            ).fetchall()
            start = min([start, *(a for a, _ in rows)])
            end = max([end, *(b for _, b in rows)])
            conn.execute(
                "DELETE FROM candle_coverage"
                " WHERE symbol = ? AND interval = ? AND start >= ? AND end <= ?",
                (*key, start, end),
            )
            conn.execute(
                "INSERT INTO candle_coverage (symbol, interval, start, end) VALUES (?, ?, ?, ?)",
                (*key, start, end),
            )

    # --- watchlist --------------------------------------------------------------------------

    def get_watchlist(self) -> list[str]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT symbol FROM watchlist ORDER BY position").fetchall()
        return [s for (s,) in rows]

    def add_to_watchlist(self, symbol: str) -> None:
        """Appends `symbol`; no-op if it is already listed."""
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT OR IGNORE INTO watchlist (symbol, position)"
                " SELECT ?, COALESCE(MAX(position) + 1, 0) FROM watchlist",
                (symbol,),
            )

    def set_watchlist(self, symbols: list[str]) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM watchlist")
            conn.executemany(
                "INSERT INTO watchlist (symbol, position) VALUES (?, ?)",
                [(s, i) for i, s in enumerate(symbols)],
            )

    def remove_from_watchlist(self, symbol: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM watchlist WHERE symbol = ?", (symbol,))

    # --- drawings / layout (opaque JSON) ----------------------------------------------------

    def get_drawings(self, symbol: str) -> list[JsonObject]:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT data FROM drawings WHERE symbol = ?", (symbol,)).fetchone()
        return json.loads(row[0]) if row else []

    def set_drawings(self, symbol: str, drawings: list[JsonObject]) -> None:
        """Replaces the whole list. Raises ValueError if it holds NaN/Infinity."""
        data = _dumps(drawings)
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT OR REPLACE INTO drawings (symbol, data) VALUES (?, ?)", (symbol, data)
            )

    def delete_drawings(self, symbol: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM drawings WHERE symbol = ?", (symbol,))

    def get_layout(self) -> JsonObject | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'layout'").fetchone()
        return json.loads(row[0]) if row else None

    def set_layout(self, layout: JsonObject) -> None:
        """Raises ValueError if it holds NaN/Infinity."""
        data = _dumps(layout)
        with closing(self._connect()) as conn, conn:
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('layout', ?)", (data,))

    # --- alerts -----------------------------------------------------------------------------

    def create_alert(self, alert: AlertCreate, created_at: int, base: Candle | None) -> Alert:
        with closing(self._connect()) as conn, conn:
            cur = conn.execute(
                "INSERT INTO alerts (symbol, condition, price, repeat, drawing_id, note,"
                " created_at, base_time, base_high, base_low, base_close)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    alert.symbol,
                    alert.condition,
                    alert.price,
                    int(alert.repeat),
                    alert.drawing_id,
                    alert.note,
                    created_at,
                    *_base_values(base),
                ),
            )
            row = conn.execute(f"{_ALERT_SELECT} WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _alert(row)

    def get_alert(self, alert_id: int) -> Alert | None:
        with closing(self._connect()) as conn:
            row = conn.execute(f"{_ALERT_SELECT} WHERE id = ?", (alert_id,)).fetchone()
        return _alert(row) if row else None

    def list_alerts(self, symbol: str | None = None, linked_only: bool = False) -> list[Alert]:
        where, args = [], []
        if symbol is not None:
            where.append("symbol = ?")
            args.append(symbol)
        if linked_only:
            where.append("drawing_id IS NOT NULL")
        sql = _ALERT_SELECT + (f" WHERE {' AND '.join(where)}" if where else "") + " ORDER BY id"
        with closing(self._connect()) as conn:
            return [_alert(r) for r in conn.execute(sql, args).fetchall()]

    def enabled_alert_symbols(self) -> list[str]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT DISTINCT symbol FROM alerts WHERE enabled = 1 ORDER BY symbol"
            ).fetchall()
        return [s for (s,) in rows]

    def enabled_alert_states(self, symbol: str) -> list[AlertState]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                f"SELECT {_ALERT_COLUMNS}, base_time, base_high, base_low, base_close, armed"
                " FROM alerts WHERE symbol = ? AND enabled = 1 ORDER BY id",
                (symbol,),
            ).fetchall()
        return [AlertState(_alert(r[:10]), *r[10:14], bool(r[14])) for r in rows]

    def update_alert(
        self,
        alert_id: int,
        fields: dict[str, Any],
        rebase: bool = False,
        base: Candle | None = None,
    ) -> Alert | None:
        """Sets the given API columns; `rebase` also resets the baseline to `base` and arms it."""
        values = {k: int(v) if isinstance(v, bool) else v for k, v in fields.items()}
        if rebase:
            values.update(zip(_BASE_COLUMNS, _base_values(base), strict=True), armed=1)
        with closing(self._connect()) as conn, conn:
            if values:
                sets = ", ".join(f"{k} = ?" for k in values)
                conn.execute(f"UPDATE alerts SET {sets} WHERE id = ?", (*values.values(), alert_id))
            row = conn.execute(f"{_ALERT_SELECT} WHERE id = ?", (alert_id,)).fetchone()
        return _alert(row) if row else None

    def delete_alert(self, alert_id: int) -> bool:
        with closing(self._connect()) as conn, conn:
            return conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,)).rowcount > 0

    def delete_linked_alerts(self, symbol: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "DELETE FROM alerts WHERE symbol = ? AND drawing_id IS NOT NULL", (symbol,)
            )

    def save_check(
        self, alert_id: int, base: Candle, armed: bool, price: float | None = None
    ) -> bool:
        """Writes the evaluation state only (+ price when given); False if the alert is gone."""
        extra = {} if price is None else {"price": price}
        with closing(self._connect()) as conn, conn:
            return _save_state(conn, alert_id, base, armed, extra) > 0

    def save_trigger(
        self,
        alert_id: int,
        base: Candle,
        armed: bool,
        disable: bool,
        event: dict[str, Any],
        price: float | None = None,
    ) -> AlertEvent | None:
        """State + last_triggered_at (+ enabled = 0) and the event, atomically; None if gone."""
        extra: dict[str, Any] = {"last_triggered_at": event["time"]}
        if disable:
            extra["enabled"] = 0
        if price is not None:
            extra["price"] = price
        with closing(self._connect()) as conn, conn:
            if not _save_state(conn, alert_id, base, armed, extra):
                return None
            cur = conn.execute(
                "INSERT INTO alert_events"
                " (alert_id, symbol, condition, level, price, time, message, deliveries)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    alert_id,
                    event["symbol"],
                    event["condition"],
                    event["level"],
                    event["price"],
                    event["time"],
                    event["message"],
                    _dumps(event["deliveries"]),
                ),
            )
        return AlertEvent(id=cur.lastrowid, alert_id=alert_id, **event)

    def list_alert_events(self, after: int = 0, limit: int = 50) -> list[AlertEvent]:
        """Events with id > after, newest first."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT id, alert_id, symbol, condition, level, price, time, message, deliveries"
                " FROM alert_events WHERE id > ? ORDER BY id DESC LIMIT ?",
                (after, limit),
            ).fetchall()
        keys = ("id", "alert_id", "symbol", "condition", "level", "price", "time", "message")
        return [
            AlertEvent(**dict(zip(keys, r[:8], strict=True)), deliveries=json.loads(r[8]))
            for r in rows
        ]


_ALERT_COLUMNS = (
    "id, symbol, condition, price, repeat, enabled, drawing_id, note, created_at, last_triggered_at"
)
_ALERT_SELECT = f"SELECT {_ALERT_COLUMNS} FROM alerts"
_BASE_COLUMNS = ("base_time", "base_high", "base_low", "base_close")


def _alert(row: tuple) -> Alert:
    keys = [k.strip() for k in _ALERT_COLUMNS.split(",")]
    return Alert(**dict(zip(keys, row, strict=True)))


def _base_values(base: Candle | None) -> tuple:
    return (base.time, base.high, base.low, base.close) if base else (None, None, None, None)


def _save_state(
    conn: sqlite3.Connection, alert_id: int, base: Candle, armed: bool, extra: dict[str, Any]
) -> int:
    values = {**dict(zip(_BASE_COLUMNS, _base_values(base), strict=True)), "armed": int(armed)}
    values.update(extra)
    sets = ", ".join(f"{k} = ?" for k in values)
    return conn.execute(
        f"UPDATE alerts SET {sets} WHERE id = ?", (*values.values(), alert_id)
    ).rowcount

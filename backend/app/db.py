"""SQLite storage: closed candles, which time ranges were fetched (coverage), the watchlist,
drawings per symbol and the chart layout."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from app.models import DEFAULT_WATCHLIST, Candle, JsonObject

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
"""


def _dumps(value: object) -> str:
    """Strict JSON: raises ValueError on NaN/Infinity, which would make the value unreadable."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


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

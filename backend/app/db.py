"""SQLite storage for closed candles."""

import sqlite3
from contextlib import closing
from pathlib import Path

from app.models import Candle

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
)
"""


class Database:
    """Opens a short-lived connection per call, so it is safe from any thread.

    The file and schema are created on first use, not at construction.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        if not self._initialized:
            conn.execute(SCHEMA)
            conn.commit()
            self._initialized = True
        return conn

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

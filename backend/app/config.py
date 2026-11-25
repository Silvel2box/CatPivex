"""Settings from backend/.env (if present) and environment variables (env vars win)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"  # never bind to other interfaces

DEFAULT_DB_PATH = "catpivex.db"
DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    cors_origins: list[str]
    # Phase 5 alerts. The defaults keep the scheduler off (tests build Settings directly);
    # load_settings turns it on unless CATPIVEX_ALERTS=0.
    alerts_enabled: bool = False
    # CATPIVEX_ALERT_INTERVAL_S: one check interval for every symbol (e2e). None = 30 s crypto /
    # 60 s others (services/alerts.py check_interval).
    alert_interval_s: int | None = None
    # CATPIVEX_TEST_FEED=1: adds the in-memory TEST exchange and PUT /api/test/price (e2e only).
    test_feed: bool = False
    # A channel is used only when both of its values are set.
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    line_channel_token: str | None = None
    line_user_id: str | None = None


def read_env_file(path: Path) -> dict[str, str]:
    """Parse simple KEY=VALUE lines. Blank lines and # comments are ignored."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def load_settings(
    env_file: Path = BACKEND_DIR / ".env", environ: Mapping[str, str] = os.environ
) -> Settings:
    values = {**read_env_file(env_file), **environ}
    db_path = Path(values.get("CATPIVEX_DB_PATH") or DEFAULT_DB_PATH)
    if not db_path.is_absolute():
        db_path = BACKEND_DIR / db_path  # relative to backend/, not the cwd
    origins = values.get("CATPIVEX_CORS_ORIGINS") or DEFAULT_CORS_ORIGINS
    interval = values.get("CATPIVEX_ALERT_INTERVAL_S")
    return Settings(
        db_path=db_path,
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
        alerts_enabled=values.get("CATPIVEX_ALERTS", "1") != "0",
        alert_interval_s=int(interval) if interval else None,
        test_feed=values.get("CATPIVEX_TEST_FEED") == "1",
        telegram_bot_token=values.get("TELEGRAM_BOT_TOKEN") or None,
        telegram_chat_id=values.get("TELEGRAM_CHAT_ID") or None,
        line_channel_token=values.get("LINE_CHANNEL_TOKEN") or None,
        line_user_id=values.get("LINE_USER_ID") or None,
    )

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
    return Settings(
        db_path=db_path,
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
    )

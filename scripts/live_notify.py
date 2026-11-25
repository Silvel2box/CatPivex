"""T5.7/T5.8: send one test message through every channel configured in backend/.env.

Usage: backend/.venv/Scripts/python scripts/live_notify.py   (exit 1 if a configured channel fails)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.config import load_settings  # noqa: E402
from app.notifiers import build_notifiers, dispatch  # noqa: E402

CHANNELS = ("telegram", "line")


def main() -> int:
    notifiers = build_notifiers(load_settings())
    configured = {n.name for n in notifiers}
    results = dispatch(notifiers, "🔔 CatPivex test message: alerts reach this chat.")
    for name in CHANNELS:
        print(f"{name}: {results[name] if name in configured else 'not configured'}")
    return 1 if any(r != "ok" for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

"""T1.9 — hit the running backend (which hits real Binance) for every interval and check the data.

Usage: start the backend (npm run dev:api), then: python scripts/live_smoke.py
Stdlib only. Exit code 0 = all checks passed.
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
SYMBOL = "BINANCE:BTCUSDT"
INTERVALS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400, "1W": 604800}
LIMIT = 500


def get(path: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(BASE + path, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def check_candles(interval: str, step: int, end: int | None = None) -> list[str]:
    q = f"/api/candles?symbol={SYMBOL}&interval={interval}&limit={LIMIT}"
    if end is not None:
        q += f"&end={end}"
    status, body = get(q)
    if status != 200:
        return [f"HTTP {status}: {body}"]
    c = body["candles"]
    errs = []
    if len(c) != LIMIT and interval != "1W":  # BTCUSDT has < 500 weeks of history
        errs.append(f"expected {LIMIT} candles, got {len(c)}")
    times = [x["time"] for x in c]
    if times != sorted(times):
        errs.append("times not ascending")
    if len(set(times)) != len(times):
        errs.append("duplicate times")
    if end is not None and times and times[-1] >= end:
        errs.append(f"end is exclusive but last time {times[-1]} >= {end}")
    if interval != "1W" and any(t % step for t in times):  # weeks start on Monday, not epoch-aligned
        errs.append("times not aligned to interval")
    for x in c:
        if not (x["high"] >= max(x["open"], x["close"]) and x["low"] <= min(x["open"], x["close"])):
            errs.append(f"bad OHLC at {x['time']}: {x}")
            break
        if x["volume"] < 0:
            errs.append(f"negative volume at {x['time']}")
            break
    return errs


def main() -> int:
    failed = 0
    status, body = get("/api/health")
    print(f"health: {status} {body}")
    failed += status != 200

    for interval, step in INTERVALS.items():
        errs = check_candles(interval, step)
        if not errs:  # history page: end = oldest time of the first page
            _, first = get(f"/api/candles?symbol={SYMBOL}&interval={interval}&limit={LIMIT}")
            errs = check_candles(interval, step, end=first["candles"][0]["time"]) if first["candles"] else []
        print(f"{interval:>4}: {'OK' if not errs else 'FAIL ' + '; '.join(errs)}")
        failed += bool(errs)

    for path, code in [
        (f"/api/candles?symbol={SYMBOL}&interval=2h", "invalid_interval"),
        ("/api/candles?symbol=BINANCE:NOTACOIN123&interval=1h", "invalid_symbol"),
    ]:
        status, body = get(path)
        ok = 400 <= status < 500 and body.get("error", {}).get("code") == code
        print(f"error {code}: {'OK' if ok else f'FAIL {status} {body}'}")
        failed += not ok

    print("ALL PASSED" if not failed else f"{failed} CHECK(S) FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""T2.8 — hit the running backend (which hits real Yahoo via yfinance) and check the data.

Usage: start the backend (npm run dev:api), then: python scripts/live_smoke_yahoo.py
(set CATPIVEX_API=http://127.0.0.1:<port> for another port).
Stdlib only, a handful of upstream calls. Exit code 0 = all checks passed.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("CATPIVEX_API", "http://127.0.0.1:8000")
DAY = 86400
TWO_YEARS_AGO = time.time() - 2 * 365 * DAY


def get(path: str, **params) -> tuple[int, object, float]:
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.status, json.load(r), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return e.code, json.load(e), time.perf_counter() - t0


def utc(t: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(t))


def check_series(symbol: str, interval: str, limit: int, want: int | None = None) -> list[str]:
    status, body, secs = get("/api/candles", symbol=symbol, interval=interval, limit=limit)
    if status != 200:
        return [f"HTTP {status}: {body}"]
    c = body["candles"]
    times = [x["time"] for x in c]
    errs = []
    if not body["delayed"]:
        errs.append("expected delayed=true")
    if times != sorted(times):
        errs.append("times not ascending")
    if len(set(times)) != len(times):
        errs.append("duplicate times")
    if want is not None and len(c) != want:
        errs.append(f"expected {want} candles, got {len(c)}")
    if interval in ("1D", "1W") and any(t % DAY for t in times):
        errs.append("1D/1W time not 00:00 UTC")
    if interval == "1D" and (not times or times[0] > TWO_YEARS_AGO):
        errs.append(f"first candle {utc(times[0]) if times else '-'} is not older than 2 years")
    if interval == "1W" and any((t // DAY) % 7 != 4 for t in times):  # epoch day 4 = Monday
        errs.append("1W time not a Monday")
    for x in c:
        if not (x["high"] >= max(x["open"], x["close"]) and x["low"] <= min(x["open"], x["close"])):
            errs.append(f"bad OHLC at {x['time']}: {x}")
            break
    span = f"{utc(times[0])} .. {utc(times[-1])}" if times else "empty"
    hours = sorted({time.gmtime(t).tm_hour * 100 + time.gmtime(t).tm_min for t in times})
    extra = f" utc-hh:mm={hours[:8]}" if interval in ("1h", "4h") else ""
    print(
        f"  {symbol:<10} {interval:>3} n={len(c):<4} {span}  {secs:5.2f}s"
        f"  warning={body['warning']!r}{extra}"
    )
    return errs


def main() -> int:
    failed = 0
    status, body, _ = get("/api/health")
    print(f"health: {status} {body}")
    failed += status != 200

    checks = [
        ("SET:PTT", "1D", 1000, None),
        ("US:AAPL", "1D", 1000, None),
        ("FX:XAUUSD", "1D", 1000, None),
        ("FX:USDTHB", "1W", 200, 200),
        ("SET:PTT", "1h", 500, 500),
        ("SET:PTT", "1h", 500, 500),  # repeat: served from cache (see the time)
        ("SET:PTT", "4h", 200, 200),
        ("US:AAPL", "4h", 100, 100),
        ("US:AAPL", "15m", 300, 300),
    ]
    for symbol, interval, limit, want in checks:
        errs = check_series(symbol, interval, limit, want)
        print(f"{symbol} {interval}: {'OK' if not errs else 'FAIL ' + '; '.join(errs)}")
        failed += bool(errs)

    symbols = "SET:PTT,US:AAPL,FX:XAUUSD,FX:USDTHB,BINANCE:BTCUSDT,SET:NOTAREALTICKER"
    status, quotes, secs = get("/api/quotes", symbols=symbols)
    print(f"quotes: HTTP {status} in {secs:.2f}s")
    for q in quotes if status == 200 else []:
        print(f"  {json.dumps(q)}")
    ok = (
        status == 200
        and [q["symbol"] for q in quotes] == symbols.split(",")
        and all(q["price"] is not None and q["change_percent"] is not None for q in quotes[:5])
        and quotes[5]["price"] is None
        and quotes[5]["error"] is not None
    )
    print(f"quotes: {'OK' if ok else 'FAIL'}")
    failed += not ok

    status, found, secs = get("/api/symbols/search", q="ptt")
    print(f"search ptt: HTTP {status} in {secs:.2f}s -> {[i['symbol'] for i in found][:12]}")
    ok = status == 200 and found and found[0]["symbol"] == "SET:PTT" and len(found) <= 30
    print(f"search: {'OK' if ok else 'FAIL'}")
    failed += not ok

    print("ALL PASSED" if not failed else f"{failed} CHECK(S) FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""Indicator test fixtures from libraries independent of the TS code (T3.1).

Run:  scripts\\.venv\\Scripts\\python scripts\\gen_fixtures.py [--refetch]
(venv + deps: see scripts/requirements-fixtures.txt)

Real candles are downloaded once into scripts/fixture_data/ and reused (--refetch downloads
again). Expected values: TA-Lib (SMA, EMA, BBANDS, RSI; MACD built from talib.EMA as
FORMULAS.md says) and pandas groupby/cumsum for VWAP (not in TA-Lib).
Output: frontend/src/chart/indicators/fixtures/<name>.json, formatted with the frontend's
prettier. Each line is stored as {"index": [...], "value": [...]} — the bars where TA-Lib/pandas
gave a non-NaN value — so number-only arrays stay compact under prettier.
"""

import json
import subprocess
import sys
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np
import pandas as pd
import talib

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "fixture_data"
OUT = ROOT / "frontend" / "src" / "chart" / "indicators" / "fixtures"
FRONTEND = ROOT / "frontend"


# ---------- raw candles (fetched once) ----------


def fetch_binance(symbol: str, interval: str, limit: int) -> list[list[float]]:
    import urllib.request

    url = (
        "https://api.binance.com/api/v3/klines"
        f"?symbol={symbol}&interval={interval}&limit={limit + 1}"
    )
    with urllib.request.urlopen(url, timeout=30) as r:
        rows = json.load(r)
    now_ms = time.time() * 1000
    rows = [k for k in rows if k[6] < now_ms][-limit:]  # closed bars only
    return [[k[0] // 1000, *(float(x) for x in k[1:6])] for k in rows]


def fetch_yahoo(ticker: str, interval: str, sessions: int) -> list[list[float]]:
    import yfinance as yf
    from curl_cffi import CurlOpt
    from curl_cffi import requests as curl_requests

    yf.config.debug.hide_exceptions = False  # otherwise a failed request is an empty frame
    # Same route as backend/yahoo.py; curl_cffi's DNS sometimes stalls, the retry succeeds.
    session = curl_requests.Session(impersonate="chrome", curl_options={CurlOpt.ECH: "false"})
    for attempt in range(4):
        try:
            df = yf.Ticker(ticker, session=session).history(
                period="1mo", interval=interval, prepost=True, auto_adjust=False, actions=False
            )
            break
        except Exception as e:  # noqa: BLE001
            print(f"yahoo attempt {attempt + 1} failed: {e}")
    else:
        raise RuntimeError("yahoo fetch failed")
    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    end = df.index + pd.Timedelta(minutes=5)
    df = df[end <= pd.Timestamp.now(tz="UTC")]  # closed bars only
    days = sorted(set(df.index.date))[-sessions:]  # index is New York time
    df = df[np.isin(df.index.date, days)]
    return [
        [int(ts.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close), float(r.Volume)]
        for ts, r in df.iterrows()
    ]


DATASETS = [
    # name, symbol (app form), interval, VWAP day tz, fetcher, source description
    (
        "btcusdt_1h",
        "BINANCE:BTCUSDT",
        "1h",
        "UTC",
        lambda: fetch_binance("BTCUSDT", "1h", 600),
        "Binance REST /api/v3/klines BTCUSDT 1h, 600 closed bars",
    ),
    (
        "aapl_5m",
        "US:AAPL",
        "5m",
        "America/New_York",
        lambda: fetch_yahoo("AAPL", "5m", 8),
        "yfinance AAPL 5m prepost=True auto_adjust=False, last 8 NY dates (extended hours: "
        "19:00-20:00 ET bars fall on the next UTC date in EST, so the NY reset differs from UTC)",
    ),
]


def load_candles(name: str, fetch, refetch: bool) -> list[list[float]]:
    path = DATA / f"{name}.json"
    if refetch or not path.exists():
        DATA.mkdir(parents=True, exist_ok=True)
        rows = fetch()
        path.write_text(json.dumps(rows), encoding="utf-8")
        print(f"fetched {name}: {len(rows)} bars -> {path.relative_to(ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


# ---------- expected values ----------


def ema_macd(c, fast, slow, signal):
    """MACD from talib.EMA per FORMULAS.md: signal = EMA of the defined macd values."""
    m = talib.EMA(c, timeperiod=fast) - talib.EMA(c, timeperiod=slow)
    sig = np.full_like(c, np.nan)
    ok = ~np.isnan(m)
    if ok.sum() >= signal:
        sig[ok] = talib.EMA(m[ok], timeperiod=signal)
    return {"macd": m, "signal": sig, "hist": m - sig}


def vwap_pandas(df: pd.DataFrame, tz: str):
    day = pd.to_datetime(df["time"], unit="s", utc=True).dt.tz_convert(tz).dt.date
    tp = (df["high"] + df["low"] + df["close"]) / 3
    pv = (tp * df["volume"]).groupby(day).cumsum()
    vol = df["volume"].groupby(day).cumsum()
    return {"value": (pv / vol).where(vol > 0).to_numpy()}


def macd_crosscheck(c, fast, slow, signal) -> dict:
    """talib.MACD vs the EMA-built MACD: per line, NaN prefix, max |diff|, first agreeing bar."""
    a = dict(zip(("macd", "signal", "hist"), talib.MACD(c, fast, slow, signal)))
    b = ema_macd(c, fast, slow, signal)
    res = {}
    for k in a:
        both = ~np.isnan(a[k]) & ~np.isnan(b[k])
        d = np.abs(a[k] - b[k])
        bad = np.where(both & (d > 1e-6))[0]
        first_both = int(np.argmax(both)) if both.any() else None
        res[k] = {
            "talibMACD_first": int(np.argmax(~np.isnan(a[k]))),
            "emaBuilt_first": int(np.argmax(~np.isnan(b[k]))),
            "maxAbsDiff": float(d[both].max()) if both.any() else None,
            "diffAtFirstCommonBar": float(d[first_both]) if first_both is not None else None,
            "agreeWithin1e-6From": int(bad[-1] + 1) if len(bad) else first_both,
        }
    return res


def line(arr) -> dict:
    arr = np.asarray(arr, dtype=float)
    idx = np.where(~np.isnan(arr))[0]
    assert np.isfinite(arr[idx]).all()
    return {"index": [int(i) for i in idx], "value": [float(arr[i]) for i in idx]}


def cases(df: pd.DataFrame, tz: str) -> list[dict]:
    c = df["close"].to_numpy(dtype=float)
    out = []

    def add(type_, params, lib, lines):
        out.append(
            {"type": type_, "params": params, "library": lib, "lines": {k: line(v) for k, v in lines.items()}}
        )

    for p in (20, 50, 200):
        add("sma", {"period": p}, "talib.SMA", {"value": talib.SMA(c, timeperiod=p)})
    for p in (12, 26):
        add("ema", {"period": p}, "talib.EMA", {"value": talib.EMA(c, timeperiod=p)})
    for p, m in ((20, 2), (20, 2.5)):
        up, mid, lo = talib.BBANDS(c, timeperiod=p, nbdevup=m, nbdevdn=m, matype=0)
        add("bb", {"period": p, "mult": m}, "talib.BBANDS(matype=0)", {"upper": up, "middle": mid, "lower": lo})
    for p in (14, 7):
        # FORMULAS.md: fixtures avoid flat seed windows (TA-Lib gives 0, Pine 100). Once an average
        # is > 0 it stays > 0, so only the seed window can hit the case.
        assert np.any(np.diff(c[: p + 1]) > 0) and np.any(np.diff(c[: p + 1]) < 0), "flat RSI seed"
        add("rsi", {"period": p}, "talib.RSI", {"value": talib.RSI(c, timeperiod=p)})
    for f, s, g in ((12, 26, 9), (5, 35, 5)):
        add("macd", {"fast": f, "slow": s, "signal": g}, "talib.EMA (MACD built per FORMULAS.md)", ema_macd(c, f, s, g))
    add("vwap", {}, f"pandas groupby(date in {tz}).cumsum", vwap_pandas(df, tz))

    # ---- Phase 7 (P7.B): ATR, Supertrend ----
    h = df["high"].to_numpy(dtype=float)
    lo = df["low"].to_numpy(dtype=float)
    for p in (14, 7):
        add("atr", {"period": p}, "talib.ATR", {"value": talib.ATR(h, lo, c, timeperiod=p)})
    for p, f in ((10, 3), (7, 2)):
        st = supertrend_loop(h, lo, c, p, f)
        for k in ("up", "down"):
            idx = np.where(~np.isnan(st[k]))[0]
            assert len(idx) > 0 and np.any(np.diff(idx) > 1), f"supertrend {k}: no flip"
        add("supertrend", {"atrPeriod": p, "factor": f}, "numpy loop (Pine rule) over talib.ATR", st)
    return out


def supertrend_loop(h, lo, c, period, factor):
    """Pine ta.supertrend as written in FORMULAS.md, over talib.ATR."""
    atr = talib.ATR(h, lo, c, timeperiod=period)
    src = (h + lo) / 2
    up = np.full_like(c, np.nan)
    down = np.full_like(c, np.nan)
    p_upper = p_lower = 0.0
    p_st = None
    for i in range(len(c)):
        if np.isnan(atr[i]):
            continue
        upper = src[i] + factor * atr[i]
        lower = src[i] - factor * atr[i]
        lower = lower if lower > p_lower or c[i - 1] < p_lower else p_lower
        upper = upper if upper < p_upper or c[i - 1] > p_upper else p_upper
        if p_st is None:
            d = 1
        elif p_st == p_upper:
            d = -1 if c[i] > upper else 1
        else:
            d = 1 if c[i] < lower else -1
        st = lower if d == -1 else upper
        (up if d == -1 else down)[i] = st
        p_upper, p_lower, p_st = upper, lower, st
    return {"up": up, "down": down}


def main() -> None:
    refetch = "--refetch" in sys.argv
    libs = {
        "TA-Lib (python)": version("TA-Lib"),
        "TA-Lib (C)": talib.__ta_version__.decode(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "python": sys.version.split()[0],
    }
    print("libraries:", json.dumps(libs))
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for name, symbol, interval, tz, fetch, source in DATASETS:
        rows = load_candles(name, fetch, refetch)
        df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
        assert df["time"].is_monotonic_increasing and df["time"].is_unique
        utc_day = pd.to_datetime(df["time"], unit="s", utc=True).dt.date
        loc_day = pd.to_datetime(df["time"], unit="s", utc=True).dt.tz_convert(tz).dt.date
        c = df["close"].to_numpy(dtype=float)
        xcheck = {f"{f}/{s}/{g}": macd_crosscheck(c, f, s, g) for f, s, g in ((12, 26, 9), (5, 35, 5))}
        fixture = {
            "name": name,
            "symbol": symbol,
            "interval": interval,
            "vwapTimeZone": tz,
            "source": source,
            "libraries": libs,
            "info": {
                "bars": len(df),
                "localDays": int(loc_day.nunique()),
                "barsWhereUtcDateDiffersFromLocal": int((utc_day != loc_day).sum()),
                "zeroVolumeBars": int((df["volume"] == 0).sum()),
                "talibMACDvsEmaBuilt": xcheck,
            },
            "candles": {k: df[k].tolist() for k in df.columns},
            "cases": cases(df, tz),
        }
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(fixture), encoding="utf-8")
        written.append(path)
        print(f"{name}: {symbol} {interval}, {json.dumps(fixture['info'])}")
        for cs in fixture["cases"]:
            firsts = {k: (v["index"][0] if v["index"] else None) for k, v in cs["lines"].items()}
            print(f"  {cs['type']:5} {json.dumps(cs['params']):40} {cs['library']:45} first={firsts}")
    subprocess.run(
        ["npx", "prettier", "--write", *[str(p) for p in written]], cwd=FRONTEND, check=True, shell=True
    )


if __name__ == "__main__":
    main()

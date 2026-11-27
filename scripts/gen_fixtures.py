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


def stoch_talib(h, lo, c, k_length, k_smooth, d_smooth):
    raw, _ = talib.STOCHF(h, lo, c, fastk_period=k_length, fastd_period=1, fastd_matype=0)
    k = talib.SMA(raw, timeperiod=k_smooth)
    return {"k": k, "d": talib.SMA(k, timeperiod=d_smooth)}


def stochrsi_pandas(c, rsi_length, stoch_length, k_smooth, d_smooth):
    r = pd.Series(talib.RSI(c, timeperiod=rsi_length))
    mn = r.rolling(stoch_length).min()
    mx = r.rolling(stoch_length).max()
    raw = (100 * (r - mn) / (mx - mn)).where(mx != mn, 0).where(mx.notna())
    k = raw.rolling(k_smooth).mean()
    return {"k": k.to_numpy(), "d": k.rolling(d_smooth).mean().to_numpy()}


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

    # ---- P7.A: stoch / stochrsi ----
    h = df["high"].to_numpy(dtype=float)
    lo = df["low"].to_numpy(dtype=float)
    for kl, ks, ds in ((14, 3, 3), (5, 2, 4)):
        add("stoch", {"kLength": kl, "kSmooth": ks, "dSmooth": ds},
            "talib.STOCHF(fastd=1) + talib.SMA x2", stoch_talib(h, lo, c, kl, ks, ds))
    for rl, sl, ks, ds in ((14, 14, 3, 3), (7, 21, 5, 2)):
        assert np.any(np.diff(c[: rl + 1]) > 0) and np.any(np.diff(c[: rl + 1]) < 0), "flat RSI seed"
        add("stochrsi", {"rsiLength": rl, "stochLength": sl, "kSmooth": ks, "dSmooth": ds},
            "talib.RSI + pandas rolling min/max/mean", stochrsi_pandas(c, rl, sl, ks, ds))
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


# ---------- Phase 7: pivot points (daily candles) ----------


def fetch_binance_daily(symbol: str, start: int, end: int) -> list[list[float]]:
    import urllib.request

    url = (
        "https://api.binance.com/api/v3/klines"
        f"?symbol={symbol}&interval=1d&startTime={start * 1000}&endTime={end * 1000}&limit=1000"
    )
    with urllib.request.urlopen(url, timeout=30) as r:
        rows = json.load(r)
    return [[k[0] // 1000, *(float(x) for x in k[1:6])] for k in rows]


def fetch_yahoo_daily(ticker: str, start: str, end: str) -> list[list[float]]:
    """Daily bars, time = 00:00 UTC of the New York trading date (as the backend serves 1D)."""
    import yfinance as yf
    from curl_cffi import CurlOpt
    from curl_cffi import requests as curl_requests

    yf.config.debug.hide_exceptions = False
    session = curl_requests.Session(impersonate="chrome", curl_options={CurlOpt.ECH: "false"})
    for attempt in range(4):
        try:
            df = yf.Ticker(ticker, session=session).history(
                start=start, end=end, interval="1d", auto_adjust=False, actions=False
            )
            break
        except Exception as e:  # noqa: BLE001
            print(f"yahoo daily attempt {attempt + 1} failed: {e}")
    else:
        raise RuntimeError("yahoo daily fetch failed")
    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    return [
        [
            int(pd.Timestamp(ts.date(), tz="UTC").timestamp()),
            float(r.Open),
            float(r.High),
            float(r.Low),
            float(r.Close),
            float(r.Volume),
        ]
        for ts, r in df.iterrows()
    ]


DAILY_BEFORE_DAYS = 120


def daily_fetcher(name: str, df: pd.DataFrame, tz: str):
    """1D candles from DAILY_BEFORE_DAYS before the first bar's date to the last bar's date."""
    first, last = int(df["time"].iloc[0]), int(df["time"].iloc[-1])
    if name == "btcusdt_1h":
        return lambda: fetch_binance_daily("BTCUSDT", first - DAILY_BEFORE_DAYS * 86400, last)
    days = pd.to_datetime(df["time"], unit="s", utc=True).dt.tz_convert(tz).dt.date
    start = (days.iloc[0] - pd.Timedelta(days=DAILY_BEFORE_DAYS)).isoformat()
    end = (days.iloc[-1] + pd.Timedelta(days=1)).isoformat()
    return lambda: fetch_yahoo_daily("AAPL", start, end)


PIVOT_AUTO = {"1m": "D", "5m": "D", "15m": "D", "1h": "W", "4h": "W", "1D": "M", "1W": "M"}
PIVOT_TIMEFRAMES = {0: None, 1: "D", 2: "W", 3: "M"}


def pivot_period(dates: pd.Series, tf: str) -> pd.Series:
    d = pd.to_datetime(dates)
    if tf == "D":
        return d.dt.strftime("%Y-%m-%d")
    if tf == "M":
        return d.dt.strftime("%Y-%m")
    iso = d.dt.isocalendar()
    return iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)


def pivot_pandas(bar_dates: pd.Series, daily: pd.DataFrame, tf: str, kind: int) -> dict:
    """Previous period's H/L/C per FORMULAS.md: groupby period of the daily candles + shift(1)."""
    ddates = pd.to_datetime(daily["time"], unit="s", utc=True).dt.date
    g = daily.groupby(pivot_period(ddates, tf)).agg(
        high=("high", "max"), low=("low", "min"), close=("close", "last")
    )
    keys = pivot_period(bar_dates, tf)
    assert keys.isin(g.index).all(), "daily candles do not cover every bar's period"
    prev = g.shift(1).reindex(keys)
    H, L, C = (prev[k].to_numpy(dtype=float) for k in ("high", "low", "close"))
    P = (H + L + C) / 3
    r = H - L
    if kind == 0:
        return {"P": P, "R1": 2 * P - L, "S1": 2 * P - H, "R2": P + r, "S2": P - r,
                "R3": H + 2 * (P - L), "S3": L - 2 * (H - P)}
    if kind == 1:
        return {"P": P, "R1": P + 0.382 * r, "S1": P - 0.382 * r, "R2": P + 0.618 * r,
                "S2": P - 0.618 * r, "R3": P + r, "S3": P - r}
    k = 1.1 * r
    return {"P": P, "R1": C + k / 12, "S1": C - k / 12, "R2": C + k / 6, "S2": C - k / 6,
            "R3": C + k / 4, "S3": C - k / 4, "R4": C + k / 2, "S4": C - k / 2}


def pivot_cases(name: str, df: pd.DataFrame, daily: pd.DataFrame, tz: str, interval: str) -> list[dict]:
    bar_dates = pd.to_datetime(df["time"], unit="s", utc=True).dt.tz_convert(tz).dt.date
    combos = [(kind, 0) for kind in (0, 1, 2)]
    if name == "btcusdt_1h":
        combos += [(0, 1), (1, 2), (2, 3)]
    out = []
    for kind, timeframe in combos:
        tf = PIVOT_TIMEFRAMES[timeframe] or PIVOT_AUTO[interval]
        lines = pivot_pandas(bar_dates, daily, tf, kind)
        out.append({
            "type": "pivot",
            "params": {"kind": kind, "timeframe": timeframe},
            "library": f"pandas groupby(period {tf}).agg + shift(1)",
            "lines": {k: line(v) for k, v in lines.items()},
        })
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


def volume_profile_numpy(df: pd.DataFrame, rows: int, pct: float) -> dict:
    """VRVP per FORMULAS.md, vectorised: bars x rows overlap matrix, then the value-area walk."""
    h = df["high"].to_numpy(dtype=float)
    lo = df["low"].to_numpy(dtype=float)
    v = df["volume"].to_numpy(dtype=float)
    pmin, pmax = lo.min(), h.max()
    step = (pmax - pmin) / rows
    edges = pmin + step * np.arange(rows + 1)
    edges[-1] = pmax
    row_lo, row_hi = edges[:-1], edges[1:]
    span = h - lo
    flat = span == 0
    overlap = np.clip(np.minimum(h[:, None], row_hi[None, :]) - np.maximum(lo[:, None], row_lo[None, :]), 0, None)
    share = np.zeros_like(overlap)
    share[~flat] = overlap[~flat] / span[~flat, None]
    if flat.any():
        idx = np.minimum(np.floor((lo[flat] - pmin) / step), rows - 1).astype(int) if step > 0 else rows - 1
        share[np.where(flat)[0], idx] = 1.0
    vol = share * v[:, None]
    is_up = df["close"].to_numpy(dtype=float) >= df["open"].to_numpy(dtype=float)
    up = vol[is_up].sum(axis=0)
    down = vol[~is_up].sum(axis=0)
    tot = up + down
    poc = int(np.argmax(tot))
    a = b = poc
    acc = tot[poc]
    target = tot.sum() * pct / 100
    while acc < target and (a > 0 or b < rows - 1):
        above = tot[b + 1] if b < rows - 1 else None
        below = tot[a - 1] if a > 0 else None
        if above is not None and (below is None or above >= below):
            b += 1
            acc += above
        else:
            a -= 1
            acc += below
    return {
        "low": row_lo.tolist(),
        "high": row_hi.tolist(),
        "up": up.tolist(),
        "down": down.tolist(),
        "poc": poc,
        "vaLow": a,
        "vaHigh": b,
        "flatBars": int(flat.sum()),
    }


VOLUME_PROFILE_CASES = {
    "btcusdt_1h": [(150, 24, 70), (400, 50, 68)],
    "aapl_5m": [(300, 24, 70), (120, 80, 95)],
}


def volume_profile_cases(name: str, df: pd.DataFrame) -> list[dict]:
    out = []
    for count, rows, pct in VOLUME_PROFILE_CASES[name]:
        start = len(df) - count
        out.append({
            "start": start,
            "end": len(df) - 1,
            "rows": rows,
            "valueAreaPct": pct,
            "library": "numpy overlap matrix (bars x rows) + value-area loop",
            "expected": volume_profile_numpy(df.iloc[start:], rows, pct),
        })
    return out


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
        daily_rows = load_candles(name.split("_")[0] + "_1d", daily_fetcher(name, df, tz), refetch)
        daily = pd.DataFrame(daily_rows, columns=["time", "open", "high", "low", "close", "volume"])
        assert daily["time"].is_monotonic_increasing and daily["time"].is_unique
        fixture["daily"] = {k: daily[k].tolist() for k in daily.columns}
        fixture["cases"] += pivot_cases(name, df, daily, tz, interval)
        fixture["volumeProfiles"] = volume_profile_cases(name, df)

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

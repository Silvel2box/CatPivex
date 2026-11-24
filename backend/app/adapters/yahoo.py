"""Yahoo Finance adapter for SET / US / FX via yfinance (unofficial, delayed, breaks sometimes).

One YahooAdapter per exchange prefix; they share one YahooSource, which owns the yfinance
calls, retries and error mapping. Candle times: intraday = real UTC open time; 1D / 1W =
00:00 UTC of the exchange-local trading date (1W: its Monday). 4h is resampled from 1h.
"""

import calendar
import json
import logging
import math
import re
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

from app.adapters.base import AdapterError
from app.adapters.resample import local_date, resample
from app.models import INTERVAL_SECONDS, INTERVALS, AssetType, Candle, SymbolInfo

log = logging.getLogger(__name__)

DAY = 86400
YF_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m", "1D": "1d", "1W": "1wk"}
# How far back Yahoo serves intraday data (with a day of margin); 1m also max ~8 days a request.
HISTORY_DAYS = {"1m": 29, "5m": 59, "15m": 59, "1h": 729}
CHUNK_SECONDS = {"1m": 7 * DAY}
OLDEST_DAILY = date(1970, 1, 2)

TIMEOUT_SECONDS = 10
CONNECT_TIMEOUT_MS = 3000  # see _yf(): stalled c-ares DNS lookups
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 1.0  # 1s, 2s
SEARCH_MEMO_SECONDS = 30  # the three exchange adapters share one Yahoo search per query

TICKER_RE = {
    "SET": re.compile(r"^[A-Z0-9-]{1,12}$"),
    "US": re.compile(r"^[A-Z0-9.-]{1,10}$"),
    "FX": re.compile(r"^[A-Z]{6}$"),
}
FX_SPECIAL = {"XAUUSD": "GC=F", "XAGUSD": "SI=F", "USDTHB": "THB=X"}
FX_FROM_YAHOO = {v: k for k, v in FX_SPECIAL.items()}
COMMODITIES = {"XAUUSD", "XAGUSD"}
FX_COMMON = {
    "XAUUSD": "Gold / US Dollar (COMEX gold futures)",
    "XAGUSD": "Silver / US Dollar (COMEX silver futures)",
    "USDTHB": "US Dollar / Thai Baht",
    "EURUSD": "Euro / US Dollar",
    "USDJPY": "US Dollar / Japanese Yen",
    "GBPUSD": "British Pound / US Dollar",
    "AUDUSD": "Australian Dollar / US Dollar",
    "USDCHF": "US Dollar / Swiss Franc",
    "USDCAD": "US Dollar / Canadian Dollar",
    "NZDUSD": "New Zealand Dollar / US Dollar",
    "USDCNY": "US Dollar / Chinese Yuan",
    "USDSGD": "US Dollar / Singapore Dollar",
    "EURTHB": "Euro / Thai Baht",
    "EURJPY": "Euro / Japanese Yen",
    "GBPJPY": "British Pound / Japanese Yen",
}
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS"}
SET_LIST_FILE = Path(__file__).resolve().parent.parent / "data" / "set100.json"

# (yahoo ticker, yfinance interval, start, end) -> DataFrame. start/end: unix seconds for
# intraday, "YYYY-MM-DD" (exchange-local, end exclusive) for 1d / 1wk.
HistoryFn = Callable[[str, str, Any, Any], Any]
SearchFn = Callable[[str], list[dict[str, Any]]]  # query -> Yahoo search "quotes"


# --- real yfinance calls --------------------------------------------------------------------


@cache
def _yf() -> tuple[Any, Any]:
    """yfinance configured once: raise errors (we map them) and use a session that fails fast."""
    import yfinance as yf

    yf.config.debug.hide_exceptions = False
    session = None
    try:
        from curl_cffi import CurlOpt, requests

        # curl_cffi resolves DNS with its bundled c-ares (not the Windows resolver/cache). Its
        # lookups sometimes stall: "curl: (28) Resolving timed out after 10006 ms" (2026-11-24,
        # 3 cold starts in a row), while the immediate retry succeeds. A short connect timeout
        # (DNS + TCP + TLS) makes YahooSource.history retry after ~3 s instead of 10 s.
        # Session curl_options are applied after yfinance's per-request timeout, so this wins.
        # ECH off: fewer DNS lookups (ECH needs an extra HTTPS-record query per host).
        session = requests.Session(
            impersonate="chrome",
            curl_options={
                CurlOpt.ECH: "false",
                CurlOpt.CONNECTTIMEOUT_MS: CONNECT_TIMEOUT_MS,
            },
        )
    except Exception:
        log.warning("curl_cffi session setup failed, using yfinance's default", exc_info=True)
    return yf, session


def yf_history(ticker: str, interval: str, start: Any, end: Any) -> Any:
    yf, session = _yf()
    return yf.Ticker(ticker, session=session).history(
        start=start,
        end=end,
        interval=interval,
        auto_adjust=False,  # split-adjusted, not dividend-adjusted (like TradingView)
        actions=False,
        timeout=TIMEOUT_SECONDS,
    )


def yf_search(query: str) -> list[dict[str, Any]]:
    yf, session = _yf()
    found = yf.Search(
        query, max_results=20, news_count=0, lists_count=0, session=session, timeout=TIMEOUT_SECONDS
    )
    return found.quotes


def classify(exc: Exception, ticker: str) -> AdapterError | None:
    """yfinance exception -> AdapterError; None = Yahoo simply has no prices in that range."""
    names = {c.__name__ for c in type(exc).__mro__}
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if "YFRateLimitError" in names or status == 429:
        return AdapterError("rate_limited", "Yahoo Finance rate limit hit, try again later")
    if "YFTzMissingError" in names or status == 404:
        return AdapterError("invalid_symbol", f"Unknown symbol on Yahoo Finance: {ticker}")
    if "YFPricesMissingError" in names:
        return None
    return AdapterError("upstream_error", f"Yahoo Finance request failed: {exc}"[:300])


class YahooSource:
    """yfinance access shared by the exchange adapters: retries + error mapping + search memo."""

    def __init__(
        self,
        history: HistoryFn = yf_history,
        search: SearchFn = yf_search,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
    ):
        self._history = history
        self._search = search
        self._sleep = sleep
        self._clock = clock
        self._memo: tuple[str, float, list[dict[str, Any]] | AdapterError] | None = None

    def history(self, ticker: str, interval: str, start: Any, end: Any) -> Any:
        """DataFrame (None/empty = no candles in range). Raises AdapterError."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                return self._history(ticker, interval, start, end)
            except Exception as exc:
                err = classify(exc, ticker)
                if err is None:
                    log.debug(
                        "Yahoo %s %s %s..%s: no prices: %s", ticker, interval, start, end, exc
                    )
                    return None
                log.warning(
                    "Yahoo history %s %s %s..%s attempt %d/%d failed: %s: %s",
                    ticker, interval, start, end, attempt, MAX_ATTEMPTS, type(exc).__name__, exc,
                )  # fmt: skip
                if err.code != "upstream_error" or attempt == MAX_ATTEMPTS:
                    raise err from exc
                self._sleep(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1))
        raise AssertionError("unreachable")

    def search(self, query: str) -> list[dict[str, Any]]:
        now = self._clock()
        if self._memo and self._memo[0] == query and now - self._memo[1] < SEARCH_MEMO_SECONDS:
            result = self._memo[2]
        else:
            try:
                result = list(self._search(query))
            except Exception as exc:
                log.warning("Yahoo search %r failed: %s: %s", query, type(exc).__name__, exc)
                result = AdapterError("upstream_error", f"Yahoo search failed: {exc}"[:300])
            self._memo = (query, now, result)
        if isinstance(result, AdapterError):
            raise result
        return result


# --- symbol mapping -------------------------------------------------------------------------


def to_yahoo(exchange: str, ticker: str) -> str:
    """('SET', 'PTT') -> 'PTT.BK', ('US', 'AAPL') -> 'AAPL', ('FX', 'EURUSD') -> 'EURUSD=X'."""
    rx = TICKER_RE.get(exchange)
    if rx is None or not rx.match(ticker):
        raise AdapterError("invalid_symbol", f"Invalid {exchange} ticker: {ticker!r}")
    if exchange == "SET":
        return f"{ticker}.BK"
    if exchange == "FX":
        return FX_SPECIAL.get(ticker, f"{ticker}=X")
    return ticker


def asset_type(exchange: str, ticker: str) -> AssetType:
    if exchange == "FX":
        return "commodity" if ticker in COMMODITIES else "fx"
    return "stock"


def symbol_info(exchange: str, ticker: str, name: str) -> SymbolInfo:
    return SymbolInfo(
        symbol=f"{exchange}:{ticker}",
        name=name,
        exchange=exchange,
        type=asset_type(exchange, ticker),
        realtime=False,
    )


def from_yahoo(quote: dict[str, Any]) -> SymbolInfo | None:
    """A Yahoo search quote -> SymbolInfo, or None if it is not a SET/US/FX symbol we map."""
    sym = str(quote.get("symbol") or "").upper()
    kind = quote.get("quoteType")
    name = str(quote.get("longname") or quote.get("shortname") or sym)
    if kind in ("EQUITY", "ETF") and sym.endswith(".BK"):
        exchange, ticker = "SET", sym.removesuffix(".BK")
    elif kind in ("EQUITY", "ETF") and quote.get("exchange") in US_EXCHANGES and "." not in sym:
        exchange, ticker = "US", sym
    elif sym in FX_FROM_YAHOO:
        exchange, ticker = "FX", FX_FROM_YAHOO[sym]
        name = FX_COMMON[ticker]
    elif kind == "CURRENCY" and sym.endswith("=X"):
        base = sym.removesuffix("=X")
        exchange, ticker = "FX", base if len(base) == 6 else f"USD{base}"
        name = FX_COMMON.get(ticker, name)
    else:
        return None
    if not TICKER_RE[exchange].match(ticker):
        return None
    return symbol_info(exchange, ticker, name)


@cache
def static_symbols(exchange: str) -> tuple[SymbolInfo, ...]:
    """Offline search list: SET100 (data/set100.json) and common FX / metals."""
    if exchange == "SET":
        rows = json.loads(SET_LIST_FILE.read_text(encoding="utf-8"))
        return tuple(symbol_info("SET", t, n) for t, n in rows)
    if exchange == "FX":
        return tuple(symbol_info("FX", t, n) for t, n in FX_COMMON.items())
    return ()


# --- candles --------------------------------------------------------------------------------


def frame_to_candles(df: Any, interval: str) -> list[Candle]:
    """yfinance history DataFrame (tz-aware exchange-local index) -> candles, ascending."""
    if df is None or len(df) == 0:
        return []
    volumes = df["Volume"] if "Volume" in df else [0.0] * len(df)
    out: dict[int, Candle] = {}
    for ts, o, h, lo, c, v in zip(
        df.index, df["Open"], df["High"], df["Low"], df["Close"], volumes, strict=True
    ):
        o, h, lo, c = float(o), float(h), float(lo), float(c)
        if any(math.isnan(x) for x in (o, h, lo, c)):
            continue
        if interval in ("1D", "1W"):
            d = ts.date()  # exchange-local trading date
            if interval == "1W":
                d -= timedelta(days=d.weekday())
            t = calendar.timegm(d.timetuple())
        else:
            t = int(ts.timestamp())
        vol = float(v) if v is not None and not math.isnan(float(v)) else 0.0
        out[t] = Candle(
            time=t, open=o, high=max(h, o, c), low=min(lo, o, c), close=c, volume=vol
        )  # later duplicates (Yahoo's live row) win
    return [out[t] for t in sorted(out)]


def _utc_date(t: int) -> date:
    return datetime.fromtimestamp(t, UTC).date()


class YahooAdapter:
    def __init__(
        self,
        exchange: str,
        source: YahooSource | None = None,
        clock: Callable[[], float] = time.time,
    ):
        if exchange not in TICKER_RE:
            raise ValueError(f"Yahoo adapter supports {sorted(TICKER_RE)}, not {exchange!r}")
        self.exchange = exchange
        self.source = source or YahooSource()
        self._clock = clock

    def supported_intervals(self) -> list[str]:
        return list(INTERVALS)

    def is_realtime(self) -> bool:
        return False

    def earliest_time(self, interval: str, now: int) -> int | None:
        if interval == "4h":  # resampled from 1h; skip the first (possibly cut) local day
            return now - HISTORY_DAYS["1h"] * DAY + DAY
        days = HISTORY_DAYS.get(interval)
        return None if days is None else now - days * DAY

    def get_candles(
        self, ticker: str, interval: str, start: int | None, end: int | None, limit: int
    ) -> list[Candle]:
        if interval not in INTERVAL_SECONDS:
            raise AdapterError("invalid_interval", f"Unsupported interval: {interval!r}")
        yahoo = to_yahoo(self.exchange, ticker)
        s, now = INTERVAL_SECONDS[interval], int(self._clock())
        hi = end if end is not None else now + s
        lo = start if start is not None else hi - limit * s * 5  # rough: sessions leave gaps
        if interval == "4h":
            candles = self._four_hour(yahoo, lo, hi, now)
        elif interval in ("1D", "1W"):
            d0, d1 = _utc_date(lo), _utc_date(hi - 1) + timedelta(days=1)
            if interval == "1W":
                d0 -= timedelta(days=d0.weekday())
            d0 = max(d0, OLDEST_DAILY)
            df = self.source.history(yahoo, YF_INTERVAL[interval], d0.isoformat(), d1.isoformat())
            candles = frame_to_candles(df, interval)
        else:
            frames = self._intraday_frames(yahoo, interval, lo, hi, now)
            candles = _merge(frame_to_candles(df, interval) for df in frames)
        candles = [k for k in candles if lo <= k.time < hi]
        return candles[:limit] if start is not None else candles[-limit:]

    def _intraday_frames(self, yahoo: str, interval: str, lo: int, hi: int, now: int) -> list:
        lo = max(lo, self.earliest_time(interval, now) or lo)
        if lo >= hi:
            return []
        step = CHUNK_SECONDS.get(interval, hi - lo)
        return [
            self.source.history(yahoo, YF_INTERVAL[interval], a, min(a + step, hi))
            for a in range(lo, hi, step)
        ]

    def _four_hour(self, yahoo: str, lo: int, hi: int, now: int) -> list[Candle]:
        # A day before / after so every bucket sees its whole local day, from its first bar.
        fetch_from = lo - DAY
        frames = self._intraday_frames(yahoo, "1h", fetch_from, hi + DAY, now)
        hourly = _merge(frame_to_candles(df, "1h") for df in frames)
        tz = next((str(df.index.tz) for df in frames if df is not None and len(df)), None)
        if not hourly or tz is None:
            return []
        if fetch_from < (self.earliest_time("1h", now) or fetch_from):
            first_day = local_date(hourly[0].time, tz)  # cut by the 730-day limit: unreliable
            hourly = [k for k in hourly if local_date(k.time, tz) != first_day]
        return resample(hourly, tz)

    def search(self, query: str) -> list[SymbolInfo]:
        q = query.strip().upper()
        if ":" in q:
            prefix, q = q.split(":", 1)
            if prefix != self.exchange:
                return []
        if not q:
            return []
        try:
            remote = [i for i in map(from_yahoo, self.source.search(q)) if i]
        except AdapterError:
            remote = []  # already logged; the offline list still answers
        local = [
            i
            for i in static_symbols(self.exchange)
            if q in i.symbol.split(":", 1)[1] or q in i.name.upper()
        ]
        found = {i.symbol: i for i in local}
        found.update((i.symbol, i) for i in remote)
        return [i for i in found.values() if i.exchange == self.exchange]


def _merge(lists: Any) -> list[Candle]:
    out = {k.time: k for candles in lists for k in candles}
    return [out[t] for t in sorted(out)]

# CatPivex

Personal TradingView-style chart app that runs on localhost. Spec: [`PLAN-trading-chart-webapp.md`](PLAN-trading-chart-webapp.md).

Charts by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) (Apache 2.0). The attribution logo stays on.

## Setup (Windows)

Needs Python 3.11+ (`python` on PATH), Node 22+, and Microsoft Edge (used by the e2e tests).

```powershell
npm run setup              # backend venv + pip, frontend npm install, root npm install
copy backend\.env.example backend\.env   # optional; defaults work for Phase 1
```

## Run

```powershell
npm run dev                # API on http://127.0.0.1:8000 + web on http://localhost:5173
```

The backend binds to `127.0.0.1` only.

## Tests

| Command | What | Network |
|---|---|---|
| `npm run check` | ruff + pytest (backend), typecheck + eslint + prettier + vitest (frontend) | none |
| `npm run smoke` | T1.9 + T2.8: every interval on Binance, SET/US/FX history, quotes, search through the API (start `npm run dev:api` first; `CATPIVEX_API` env to use another port) | Binance, Yahoo |
| `npm run e2e` | Playwright in Edge. Starts its own servers on ports 8100/5180 with `backend/e2e.db`, so it never touches your dev session or watchlist | Binance, Yahoo |

Test IDs (T1.1, T1.2, …) in test names match the test list in the project tracker.

## Phase status

### Phase 1: base + crypto chart ✅ (2026-11-24)
- Backend: FastAPI, Binance adapter (retry/backoff, used-weight throttling), SQLite candle cache (closed candles only), `/api/health`, `/api/candles`, `/api/symbols/search`. All errors are `{ "error": { "code", "message" } }`.
- Frontend: Vite + React + TS strict, Lightweight Charts v5 candles + volume, timeframes 1m to 1W, Binance WebSocket realtime with reconnect, load older bars when scrolling left, Asia/Bangkok display time.
- How to check by hand: `npm run dev`, open http://localhost:5173. The last 1m bar moves live, timeframe buttons switch instantly, and dragging right loads older history.

### Phase 2: multiple markets + watchlist ✅ (2026-11-24)
- Symbol search box (click the symbol, or just start typing on the chart): Binance USDT pairs, SET (`SET:PTT`), US (`US:AAPL`), FX/metals (`FX:XAUUSD` = gold futures `GC=F`, `FX:USDTHB`).
- Yahoo adapter via yfinance (delayed ~15 min, "Delayed" badge, 60 s polling). 4h for stocks is resampled from 1h, starting at each day's first bar.
- Cache remembers fetched ranges, so nights/weekends don't cause refetches. 1D/1W candles are stamped 00:00 UTC of the trading date and shown as UTC dates.
- Watchlist on the right: price + change % vs the previous daily close (refreshes every 30 s), add current symbol (+), remove (×), drag to reorder. Stored in SQLite.
- Known: yfinance's HTTP client (curl_cffi) resolves DNS with its own c-ares resolver, which sometimes stalls. The connect timeout is 3 s, so a stall costs about 4 s instead of 12 s (see `backend/app/adapters/yahoo.py` `_yf`).
- Known: `app/data/set100.json` (offline SET search fallback) was written by hand and only approximates the current SET100.

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
| `npm run smoke` | T1.9: every interval against real Binance through the API (start `npm run dev:api` first) | Binance |
| `npm run e2e` | Playwright in Edge against the real dev servers (starts them if not running) | Binance |

Test IDs (T1.1, T1.2, …) in test names match the test list in the project tracker.

## Phase status

### Phase 1: base + crypto chart ✅ (2026-11-24)
- Backend: FastAPI, Binance adapter (retry/backoff, used-weight throttling), SQLite candle cache (closed candles only), `/api/health`, `/api/candles`, `/api/symbols/search`. All errors are `{ "error": { "code", "message" } }`.
- Frontend: Vite + React + TS strict, Lightweight Charts v5 candles + volume, timeframes 1m to 1W, Binance WebSocket realtime with reconnect, load older bars when scrolling left, Asia/Bangkok display time.
- How to check by hand: `npm run dev`, open http://localhost:5173. The last 1m bar moves live, timeframe buttons switch instantly, and dragging right loads older history.
- Known: on 1D the tick labels sit at 07:00 Bangkok (Binance days start 00:00 UTC). This is correct for the data.

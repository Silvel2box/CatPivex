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

### Phase 3: indicators ✅ (2026-11-24)
- **Indicators** button: SMA, EMA, Bollinger Bands and VWAP draw on the price chart. RSI and MACD each get their own pane below it. Each one has its own length, colour, line width (1–4 px) and show/hide controls, and you can add the same type more than once (SMA 20 and SMA 50).
- The legend at the top left shows OHLCV and every indicator value for the bar under the crosshair. When the mouse leaves the chart it shows the last bar.
- Formulas follow Pine Script v5 and TA-Lib (`frontend/src/chart/indicators/FORMULAS.md`). VWAP resets on each market's own day: Binance and FX on UTC, SET on Bangkok time, US on New York time. It is hidden on 1D/1W.
- Realtime bars update the indicators incrementally. A unit test checks that this matches a full recompute.
- Expected values in the unit tests come from TA-Lib and pandas, not our own code. To regenerate them:
  ```
  python -m venv scripts\.venv
  scripts\.venv\Scripts\python -m pip install -r scripts\requirements-fixtures.txt
  scripts\.venv\Scripts\python scripts\gen_fixtures.py   # add --refetch for fresh candles
  ```

### Phase 4: drawing tools + saved layout ✅ (2026-11-24)
- The toolbar on the left has five tools:
  - trend line (Alt+T)
  - horizontal line with a price label (Alt+H)
  - vertical line (Alt+V)
  - rectangle (Alt+R)
  - Fibonacci retracement (Alt+F)
- Click to place a drawing. Two-point tools take either two clicks or one press-drag-release. Esc cancels; Delete removes the selected drawing.
- Click a drawing to select it. Drag its body to move it or an end point to reshape it, and change its colour or width in the toolbar. Dragging empty space still scrolls the chart.
- The magnet (in the toolbar, off by default) is weak: it snaps to the open, high, low or close of the nearest bar only when the mouse is within 10 px of it.
- Hovering a drawing shows its handles. While you draw, and for the selected drawing, its anchor prices and times are labelled on the axes. A Fibonacci retracement has filled bands, so you can grab it anywhere inside.
- With a tool active, a dot (and its price/time on the axes) shows where the click will land. Fibonacci points snap to a wick's high or low within 15 px, even with the magnet off. End points can be grabbed from 10 px away.
- Fibonacci background opacity (0–50%) is set per drawing in the toolbar while it is selected.
- Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo drawing changes per symbol; a whole drag is one step.
- Hold Shift while drawing or dragging a trend line end to keep it horizontal, vertical or at 45°.
- Right-click a drawing for its menu (Delete; for Fibonacci also Reverse and Extend lines right). The same Fibonacci options are in the toolbar.
- Watchlist "+" opens a search: add any symbol without switching the chart (it stays open to add several).
- The Lightweight Charts licence link is shown under the watchlist instead of the logo on the chart.
- Drawings are anchored by (time, price) and saved per symbol. They stay at the same time and price when you change timeframe, even at a time with no bar (for example 13:30 drawn on 1h and shown on 1D).
- The layout is saved and comes back after a reload: symbol, timeframe, indicators with their settings, volume and magnet. It is saved 0.5 s after the last change.
- e2e tests reset the saved layout before each test (`e2e/fixtures.ts`).

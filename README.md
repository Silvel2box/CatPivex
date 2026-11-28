# CatPivex

Personal TradingView-style chart app that runs on localhost. Spec: [`PLAN-trading-chart-webapp.md`](PLAN-trading-chart-webapp.md).

Charts by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) (Apache 2.0). The licence's attribution link is shown under the watchlist; keep it if you fork this.

Free for personal and community use; **commercial use is not allowed**. See [Terms of use](#terms-of-use).

## Setup (Windows)

Needs Python 3.11+ (`python` on PATH), Node 22+, and Microsoft Edge (used by the e2e tests).

```powershell
npm run setup              # backend venv + pip, frontend npm install, root npm install
copy backend\.env.example backend\.env   # optional: only needed for Telegram/LINE alerts
```

`npm run setup` also turns on a git pre-commit hook (`scripts/check_secrets.py`) that refuses commits containing `.env` files, private keys, Telegram/LINE/GitHub tokens, or values filled into `.env.example`. Your tokens belong only in `backend/.env`, which git ignores.

## Price alerts

Open **Alerts** in the top bar to add one (crossing, crossing up/down, ≥, ≤; once or repeat), or right-click a horizontal line, horizontal ray or trend line → **Add alert**: that alert follows the line when you drag it and is deleted with the line. A trend line alert watches the line extended to the right (drawn dashed up to the bell) and uses the line's price at the moment of each check; a steep line moving through a still price also counts as a cross. The backend checks crypto every 30 s and stocks/FX every 60 s, using the 1m high/low since the last check, so a wick that touches the level counts. Every trigger shows a browser notification with a sound (allow notifications when the browser asks) and goes to the History tab.

Phone notifications are optional. Fill in either channel in `backend/.env`, restart `npm run dev`, then run `npm run notify:test`:

- **Telegram:** message [@BotFather](https://t.me/BotFather), `/newbot`, copy the token to `TELEGRAM_BOT_TOKEN`. Send any message to your new bot, open `https://api.telegram.org/bot<token>/getUpdates` and copy `message.chat.id` to `TELEGRAM_CHAT_ID`.
- **LINE (Messaging API, not LINE Notify, which has shut down):** create a Messaging API channel in the [LINE Developers console](https://developers.line.biz/console/). Copy the long-lived channel access token (Messaging API tab) to `LINE_CHANNEL_TOKEN` and "Your user ID" (Basic settings tab) to `LINE_USER_ID`. Add the bot as a friend with its QR code. The free plan has a monthly message quota.
  - Common mix-ups: the **channel access token** is about 170 characters long. The 32-character "Channel secret" on the Basic settings tab is a different value. The **user ID** starts with `U` and is 33 characters long. The 10-digit "Channel ID" is a different value. Either mix-up gives `HTTP 401` or `400` in `npm run notify:test`.
  - Messages arrive in the chat with your bot, not in your personal chat. Search your chat list for the bot's name. Some LINE versions put official-account chats in a separate folder.

Known limitation: if you delete a line that has an alert and then undo (Ctrl+Z), the line comes back but its alert does not. Add the alert again.

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
| `npm run notify:test` | T5.7 + T5.8: sends one test message through each channel set in `backend/.env` ("not configured" otherwise) | Telegram, LINE |
| `npm run e2e` | Playwright in Edge. Starts its own servers on ports 8100/5180 with `backend/e2e.db`, so it never touches your dev session or watchlist | Binance, Yahoo |

Test IDs (T1.1, T1.2, …) in test names match the test list in the project tracker.

## Phase status

### Phase 1: base + crypto chart ✅ (2026-11-24)
- Backend: FastAPI, Binance adapter (retry/backoff, used-weight throttling), SQLite candle cache (closed candles only), `/api/health`, `/api/candles`, `/api/symbols/search`. All errors are `{ "error": { "code", "message" } }`.
- Frontend: Vite + React + TS strict, Lightweight Charts v5 candles + volume, timeframes 1m to 1W, Binance WebSocket realtime with reconnect, load older bars when scrolling left, Asia/Bangkok display time.
- How to check by hand: `npm run dev`, open http://localhost:5173. The last 1m bar moves live, timeframe buttons switch instantly, and dragging right loads older history.

### Phase 2: multiple markets + watchlist ✅ (2026-11-24)
- Symbol search box (click the symbol, or just start typing on the chart): Binance USDT pairs, SET (`SET:PTT`), US (`US:AAPL`), FX/metals (`FX:XAUUSD` = gold futures `GC=F`, `FX:USDTHB`).
- Yahoo adapter via yfinance (delayed ~15 min, 60 s polling). The "Delayed · as of 24 Nov, 16:20" badge shows the newest minute the source has (Bangkok time, refreshed every 60 s, on any timeframe); hover it for the full date and when it was last checked. 4h for stocks is resampled from 1h, starting at each day's first bar.
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
- Click a drawing to select it. Drag its body to move it or an end point to reshape it, and change its colour or width in the floating bar that appears above the chart (Phase 6). Dragging empty space still scrolls the chart.
- The magnet (in the toolbar, off by default) is weak: it snaps to the open, high, low or close of the nearest bar only when the mouse is within 10 px of it.
- Hovering a drawing shows its handles. While you draw, and for the selected drawing, its anchor prices and times are labelled on the axes. A Fibonacci retracement has filled bands, so you can grab it anywhere inside.
- With a tool active, a dot (and its price/time on the axes) shows where the click will land. Fibonacci points snap to a wick's high or low within 15 px, even with the magnet off. End points can be grabbed from 10 px away.
- Fibonacci background opacity (0–50%) is set per drawing in the floating bar while it is selected.
- Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo drawing changes per symbol; a whole drag is one step.
- Hold Shift while drawing or dragging a trend line end to keep it horizontal, vertical or at 45°.
- Right-click a drawing for its menu (Delete; for Fibonacci also Reverse and Extend lines right). The same Fibonacci options are in the toolbar.
- Watchlist "+" opens a search: add any symbol without switching the chart (it stays open to add several).
- The Lightweight Charts licence link is shown under the watchlist instead of the logo on the chart.
- Drawings are anchored by (time, price) and saved per symbol. They stay at the same time and price when you change timeframe, even at a time with no bar (for example 13:30 drawn on 1h and shown on 1D).
- The layout is saved and comes back after a reload: symbol, timeframe, indicators with their settings, volume and magnet. It is saved 0.5 s after the last change.
- e2e tests reset the saved layout before each test (`e2e/fixtures.ts`).

### Phase 5: price alerts ✅ (2026-11-25)
- Backend: `alerts` + `alert_events` tables, `/api/alerts` CRUD, `/api/alerts/events?after=<id>`, APScheduler checks (30 s crypto / 60 s others), Telegram + LINE Messaging API notifiers (tokens never appear in errors or logs), alerts linked to a horizontal line follow it on every drawings save.
- Frontend: Alerts panel (list, create/edit, enable toggle, history with per-channel delivery status), right-click a horizontal line → Add/Edit/Remove alert, bell mark on lines with an alert, browser notification + sound, in-app toast when notifications are blocked.
- e2e uses an in-memory `TEST` exchange (`CATPIVEX_TEST_FEED=1`, `PUT /api/test/price`) and never sends real Telegram/LINE messages.

### Phase 6: drawing tools, round 1 ✅ (2026-11-25)
- **Horizontal ray** (Alt+J): starts at the point you click and runs to the right. It can carry a price alert like a horizontal line (right-click → Add alert, or the bell in the floating bar); the alert follows the ray when you drag it.
- **Measure**: the ruler button, or Shift+click on empty chart space, then click the end (or drag). Shows the price change, percent, number of bars and time. It is not saved; the next click or Esc clears it.
- **Floating bar**: appears when a drawing is selected, with colour, width, Fibonacci options, alert and delete. Drag it by its grip; the position is saved.
- **Stay in drawing mode** (lock button under the magnet): the tool stays active after each drawing, so you can place several lines in a row. Esc or right-click leaves the tool.

### Phase 7: indicators, round 2 ✅ (2026-11-25)
- New indicators: **Stochastic**, **Stoch RSI**, **ATR**, **Supertrend** and **Pivot Points** (Standard / Fibonacci / Camarilla; Auto, daily, weekly or monthly). Formulas: `frontend/src/chart/indicators/FORMULAS.md`; test values come from TA-Lib and pandas.
- Pivot Points use the 1D candles of the symbol (fetched automatically). Auto = daily pivots up to 15m, weekly on 30m–4h, monthly on 1D/1W. Each period is its own segment, and Supertrend breaks where the trend flips.
- ATR follows TA-Lib's start (the first value is one bar later than TradingView's); the values match after the first few dozen bars.
- Legend: hover an indicator's name for 👁 hide/show, ⚙ settings (opens the Indicators panel at that indicator) and × remove. A hidden indicator stays in the legend, dimmed.

### Phase 8: drawing tools, round 3 ✅ (2026-11-27)
- **Long / Short position**: one click places it with the stop 40 px away and the target at 2R, 20 bars wide. Drag the target, stop, entry or right-edge handles; the labels show target and stop price with %, and the risk/reward ratio. The stop and target can't cross the entry.
- **Fibonacci levels**: select a fib, then **Levels** in the floating bar to tick which levels show (0–1 plus 1.272, 1.618, 2, 2.618, 3.618, 4.236) or type your own (−5 to 10). Saved per fib.
- **Text**: pick the T tool, click and type. Enter saves, Shift+Enter adds a line, Esc cancels. Double-click a text (or the pencil in the floating bar) to edit it; clear it to delete. Colour and font size are in the floating bar.

### Phase 9: volume profile + trend line alerts ✅ (2026-11-27)
- **Volume Profile (visible range)** in Indicators: volume per price row for the candles on screen, drawn from the right edge (blue = up candles, yellow = down), the value area (70%) darker and the POC as a red line; the legend shows the POC price. It recalculates when you scroll or zoom. Each candle's volume is spread evenly over its high–low range (there is no lower-timeframe data), so it can differ a little from TradingView's.
- **Alerts on trend lines**: see Price alerts above.

### Phase 10: Ichimoku Cloud ✅ (2026-11-28)
- **Ichimoku Cloud** in Indicators (TradingView defaults 9 / 26 / 52 / 26): conversion and base lines, the lagging span drawn 25 bars back, and leading spans A and B drawn 25 bars ahead with the cloud between them (green where A ≥ B, red below; it takes the span colours from the settings). The cloud runs past the last candle: drag the chart left to see the part ahead.

## Terms of use

CatPivex is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

- **Allowed:** using it for yourself, sharing it with friends and communities, studying it, changing it, and sharing your changes, all without charge. When you share it, include `LICENSE.md` and its `Required Notice` line.
- **Not allowed without written permission from the author:**
  - selling it, or charging for access to it
  - running it as a paid service
  - putting it inside a commercial product
  - using it to run a business
  - removing the licence or the attribution
- **Not financial advice.** Charts, indicators and alerts are tools only. Every trading decision and its result is yours.
- **No warranty.** Prices can be delayed (Yahoo data is about 15 minutes behind) or wrong. Alerts can arrive late or not at all, for example when your PC sleeps, the network drops, or a data source fails. Do not rely on CatPivex alone for decisions where money is at stake.
- **Market data** comes from Binance and Yahoo Finance and is subject to their terms. Yahoo Finance data is for personal use only. CatPivex is not affiliated with Binance, Yahoo, TradingView, Telegram or LINE.
- **Your tokens and data stay on your machine.** Telegram/LINE tokens live only in `backend/.env`, and alert messages go only to the chat you configure. Never commit `.env` or post your tokens anywhere.

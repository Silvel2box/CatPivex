# แผนงาน: Personal Trading Chart Web App (แนว TradingView สำหรับใช้เอง)

> เอกสารนี้เขียนให้ Claude Code ใช้เป็นสเปกในการเขียนโค้ดทั้งโปรเจกต์
> ทำทีละ Phase ตามลำดับ ทุก Phase ต้องรันได้และผ่าน Acceptance criteria ก่อนขึ้น Phase ถัดไป

---

## 0. เป้าหมายและข้อจำกัด

**เป้าหมาย**: เว็บแอปดูกราฟราคาส่วนตัว รันบนเครื่องตัวเอง (localhost) หน้าตาและการใช้งานคล้าย TradingView
- กราฟแท่งเทียน + volume, เปลี่ยน timeframe, ซูม/เลื่อนลื่น
- Watchlist หลายตลาด (คริปโต, หุ้นไทย, หุ้น US, ทอง/forex)
- Indicator พื้นฐาน, เครื่องมือวาดเส้น, แจ้งเตือนราคา

**ข้อจำกัด (ห้ามละเมิด)**
- ห้ามดึง/คัดลอกโค้ด, ข้อมูล, หรือ API ภายในของ tradingview.com — ใช้เฉพาะไลบรารีโอเพนซอร์สและแหล่งข้อมูลที่เปิดให้ใช้
- ใช้ **TradingView Lightweight Charts** (Apache 2.0) ได้ แต่ต้องแสดงลิงก์ attribution ตามเงื่อนไขไลบรารี (เปิด option `attributionLogo` ไว้ หรือใส่ลิงก์ในหน้า About/footer)
- ใช้คนเดียว ไม่ต้องมีระบบ user/login (แต่ backend ต้อง bind `127.0.0.1` เท่านั้น)

---

## 1. Tech stack

| ส่วน | เลือกใช้ | เหตุผล |
|---|---|---|
| Frontend | Vite + TypeScript (vanilla หรือ React ก็ได้ — **ใช้ React**) | เร็ว, type-safe |
| กราฟ | `lightweight-charts` v5.x | กราฟตัวเดียวกับ TradingView, เบา |
| State | Zustand | เบา ไม่ต้อง boilerplate |
| Styling | Tailwind CSS, ธีมมืดเป็นค่าเริ่มต้น | |
| Backend | Python 3.11+ / FastAPI / uvicorn | ใช้ yfinance ได้, ทำ cache/alert ง่าย |
| Storage | SQLite (ผ่าน `sqlite3` หรือ SQLModel) | cache แท่งเทียน, watchlist, drawings, alerts |
| Scheduler | APScheduler (ใน process เดียวกับ FastAPI) | เช็ค alert เป็นรอบ |

> หมายเหตุ Lightweight Charts v5: สร้าง series ด้วย `chart.addSeries(CandlestickSeries, options)` ไม่ใช่ `addCandlestickSeries()` แบบ v4 — ตรวจ API จาก docs ของเวอร์ชันที่ติดตั้งจริงก่อนเขียน

---

## 2. โครงสร้างโปรเจกต์

```
trading-chart/
├── README.md
├── docker-compose.yml          # optional (Phase 5)
├── backend/
│   ├── pyproject.toml          # หรือ requirements.txt
│   ├── app/
│   │   ├── main.py             # FastAPI app, CORS เฉพาะ localhost:5173
│   │   ├── config.py           # อ่าน .env
│   │   ├── db.py               # SQLite init + migrations ง่ายๆ
│   │   ├── models.py           # Pydantic schemas
│   │   ├── adapters/
│   │   │   ├── base.py         # DataAdapter interface
│   │   │   ├── binance.py      # คริปโต
│   │   │   ├── yahoo.py        # หุ้นไทย/US/ทอง/forex ผ่าน yfinance
│   │   │   └── registry.py     # map symbol prefix -> adapter
│   │   ├── services/
│   │   │   ├── candles.py      # ดึง + cache + merge
│   │   │   ├── indicators.py   # (ถ้าจะคำนวณฝั่ง server สำหรับ alert)
│   │   │   └── alerts.py       # เช็คเงื่อนไข + ส่งแจ้งเตือน
│   │   └── routers/
│   │       ├── market.py       # /api/symbols, /api/candles
│   │       ├── watchlist.py
│   │       ├── drawings.py
│   │       └── alerts.py
│   └── tests/
└── frontend/
    ├── package.json
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # layout หลัก
        ├── api/client.ts       # fetch wrapper ไป backend
        ├── realtime/
        │   └── binanceWs.ts    # WebSocket kline stream (ต่อตรงจาก browser)
        ├── chart/
        │   ├── ChartView.tsx   # สร้าง/ทำลาย chart, resize observer
        │   ├── series.ts       # candle + volume
        │   ├── indicators/     # sma.ts, ema.ts, rsi.ts, macd.ts, bb.ts, vwap.ts
        │   └── drawings/       # primitives: hline.ts, trendline.ts, rect.ts
        ├── components/
        │   ├── TopBar.tsx      # ค้นหา symbol, timeframe, indicator menu
        │   ├── Watchlist.tsx
        │   ├── DrawingToolbar.tsx
        │   ├── IndicatorPanel.tsx
        │   └── AlertsPanel.tsx
        ├── store/              # zustand stores
        └── utils/
```

---

## 3. รูปแบบ Symbol และ Data adapters

**Symbol format**: `<EXCHANGE>:<TICKER>` เช่น
- `BINANCE:BTCUSDT` → Binance adapter
- `SET:PTT` → Yahoo adapter แปลงเป็น `PTT.BK`
- `US:AAPL` → Yahoo `AAPL`
- `FX:XAUUSD` → Yahoo `GC=F` (ทองฟิวเจอร์ส) หรือ `XAUUSD=X` ถ้าใช้ได้ — ให้ adapter มี mapping table
- `FX:USDTHB` → Yahoo `THB=X`

**Interface** (`adapters/base.py`)
```python
class DataAdapter(Protocol):
    def search(self, query: str) -> list[SymbolInfo]: ...
    def get_candles(self, ticker: str, interval: str,
                    start: int | None, end: int | None, limit: int) -> list[Candle]: ...
    def supported_intervals(self) -> list[str]: ...
    def is_realtime(self) -> bool: ...
```

**Candle**: `{ time: int (unix seconds, UTC), open, high, low, close, volume }`

**Timeframes ที่รองรับ (UI)**: `1m 5m 15m 1h 4h 1D 1W`
- Binance: รองรับทั้งหมดโดยตรง
- Yahoo: ไม่มี 4h → resample จาก 1h ฝั่ง backend; ข้อมูล intraday ของ Yahoo ย้อนหลังได้จำกัด (1m ~7 วัน, 1h ~730 วัน) ให้ adapter คืนข้อความเตือนถ้าช่วงที่ขอเกิน

**Binance**
- REST history: `GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&endTime=...`
- Realtime: browser ต่อ WebSocket `wss://stream.binance.com:9443/ws/btcusdt@kline_1m` ตรงๆ (ไม่ต้องผ่าน backend)
- Reconnect อัตโนมัติแบบ exponential backoff, ping/pong ตามที่ Binance กำหนด

**Yahoo (yfinance)**
- ดีเลย์ ~15 นาทีสำหรับหุ้น — แสดงป้าย "Delayed" บนกราฟ
- Frontend poll `/api/candles` ทุก 30–60 วินาทีขณะตลาดเปิดเพื่ออัปเดตแท่งล่าสุด
- yfinance ไม่ใช่ API ทางการ อาจพัง → ห่อด้วย try/except, cache ผลไว้, log error ชัดเจน
- เผื่อในอนาคต: เพิ่ม adapter `twelvedata.py` / `finnhub.py` ที่อ่าน API key จาก `.env` (ไม่ต้องทำใน MVP แต่ interface ต้องรองรับ)

**Cache (SQLite)**
- ตาราง `candles(symbol, interval, time, o, h, l, c, v, PRIMARY KEY(symbol, interval, time))`
- ขอข้อมูล → ดู cache ก่อน → ดึงเฉพาะช่วงที่ขาด → upsert
- แท่งล่าสุด (ยังไม่ปิด) ห้าม cache ถาวร ให้ดึงใหม่เสมอ

---

## 4. Backend API

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/symbols/search?q=` | รวมผลจากทุก adapter |
| GET | `/api/candles?symbol=&interval=&end=&limit=500` | ใช้ `end` สำหรับโหลดย้อนหลัง (infinite scroll ซ้าย) |
| GET/POST/DELETE | `/api/watchlist` | รายการ symbol + ลำดับ |
| GET | `/api/quotes?symbols=a,b,c` | ราคาล่าสุด + % เปลี่ยนแปลง สำหรับ watchlist |
| GET/PUT/DELETE | `/api/drawings/{symbol}` | เก็บเส้นที่วาดเป็น JSON ต่อ symbol |
| GET/PUT | `/api/layout` | indicator ที่เปิด, timeframe ล่าสุด, symbol ล่าสุด |
| GET/POST/PATCH/DELETE | `/api/alerts` | แจ้งเตือนราคา |

Error format เดียวกันทั้งระบบ: `{ "error": { "code": "...", "message": "..." } }`

---

## 5. Frontend — layout และ UX

```
┌──────────────────────────────────────────────────────────┐
│ TopBar: [ค้นหา symbol] [1m 5m 15m 1h 4h 1D 1W] [Indicators] [Alerts] │
├────┬─────────────────────────────────────────┬───────────┤
│Draw│                                         │ Watchlist │
│tool│        Main chart (candle + volume)     │  BTCUSDT  │
│bar │                                         │  SET:PTT  │
│    ├─────────────────────────────────────────┤  US:AAPL  │
│    │   Sub-pane: RSI / MACD (ถ้าเปิด)        │  ...      │
└────┴─────────────────────────────────────────┴───────────┘
```

- ธีมมืดค่าเริ่มต้น, สีแท่งเขียว `#26a69a` / แดง `#ef5350`
- Crosshair แสดง OHLCV + ค่า indicator ที่ตำแหน่งเมาส์ (legend มุมซ้ายบน)
- เลื่อนซ้ายสุด → โหลดข้อมูลย้อนหลังเพิ่มอัตโนมัติ (`subscribeVisibleLogicalRangeChange`)
- Keyboard: `Alt+H` เส้นแนวนอน, `Alt+T` trendline, `Esc` ยกเลิก, `Delete` ลบเส้นที่เลือก, พิมพ์ตัวอักษรบนกราฟ → เปิดช่องค้นหา symbol
- เวลาแสดงเป็น Asia/Bangkok (แปลงตอนแสดงผลเท่านั้น เก็บเป็น UTC)
- จำ layout ล่าสุดผ่าน `/api/layout`
- Sub-pane: ใช้ระบบ panes ของ Lightweight Charts v5 (ถ้าเวอร์ชันที่ติดตั้งรองรับ) มิฉะนั้นสร้าง chart แยกแล้ว sync time scale

---

## 6. Indicators (คำนวณฝั่ง frontend, pure functions + unit test)

| Indicator | ค่าเริ่มต้น | แสดงที่ |
|---|---|---|
| SMA | 20, 50, 200 | main |
| EMA | 12, 26 | main |
| Bollinger Bands | 20, 2σ | main |
| VWAP | รีเซ็ตรายวัน (intraday เท่านั้น) | main |
| Volume | — | main (histogram, scale แยก) |
| RSI | 14 (เส้น 30/70) | sub-pane |
| MACD | 12, 26, 9 | sub-pane |

- แต่ละ indicator: `compute(candles, params) => series[]` + ตั้งค่าพารามิเตอร์/สีได้จาก IndicatorPanel
- เมื่อแท่งล่าสุดอัปเดต realtime ให้คำนวณใหม่เฉพาะช่วงท้าย (incremental) ไม่ต้องคำนวณทั้งชุด
- Unit test เทียบค่ากับ fixture ที่คำนวณด้วย pandas/TA-Lib ไว้ล่วงหน้า (ยอม error < 1e-6)

---

## 7. Drawing tools

Lightweight Charts ไม่มีเครื่องมือวาดในตัว → เขียนเป็น **Series Primitives** (plugin API ของไลบรารี)
- MVP: เส้นแนวนอน (horizontal line พร้อม label ราคา), trendline (2 จุด), สี่เหลี่ยมโซน
- ภายหลัง: Fibonacci retracement, ray, ข้อความ
- จุดยึดเก็บเป็น `(time, price)` ไม่ใช่พิกัดพิกเซล เพื่อให้ถูกต้องเมื่อซูม/เปลี่ยน timeframe
- เลือก/ลาก/ลบได้, magnet snap ไปที่ OHLC ของแท่งใกล้สุด (toggle ได้)
- บันทึกต่อ symbol ผ่าน `/api/drawings/{symbol}` (debounce 500ms)

---

## 8. Price alerts

- เงื่อนไข: ราคา `crosses above` / `crosses below` / `>=` / `<=` ค่าที่กำหนด, หรือแตะเส้นแนวนอนที่วาดไว้ (คลิกขวาที่เส้น → "สร้าง alert")
- Backend APScheduler เช็คทุก 30 วินาที (คริปโต) / 60 วินาที (หุ้น) ใช้ราคาจาก adapter
- เมื่อ trigger: บันทึกเวลา, ปิด alert (หรือ repeat ตามตั้งค่า), ส่งแจ้งเตือนผ่าน:
  1. Browser Notification + เสียง (frontend poll `/api/alerts?triggered_since=`)
  2. Telegram Bot (ถ้าตั้ง `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ใน `.env`)
  3. LINE Messaging API push message (ถ้าตั้ง `LINE_CHANNEL_TOKEN`, `LINE_USER_ID`) — **อย่าใช้ LINE Notify เพราะปิดบริการไปแล้ว**
- Notifier เป็น interface เดียวกัน เพิ่มช่องทางใหม่ได้ง่าย

---

## 9. Phases และ Acceptance criteria

### Phase 1 — โครงพื้นฐาน + กราฟคริปโต
- ตั้ง monorepo, backend FastAPI + frontend Vite/React/TS, script รันพร้อมกัน (`make dev` หรือ npm script)
- Binance adapter + `/api/candles` + cache SQLite
- ChartView แสดงแท่งเทียน + volume, เปลี่ยน timeframe ได้, realtime ผ่าน WebSocket
- ✅ เปิด `BINANCE:BTCUSDT` 1m แล้วแท่งล่าสุดขยับแบบเรียลไทม์, เปลี่ยนเป็น 1h/1D ได้ไม่ค้าง, เลื่อนซ้ายแล้วโหลดย้อนหลังต่อเนื่อง

### Phase 2 — หลายตลาด + Watchlist
- Yahoo adapter (SET/US/FX), resample 4h, symbol search รวม
- Watchlist (เพิ่ม/ลบ/ลากเรียง) พร้อมราคาล่าสุดและ % เปลี่ยนแปลง, คลิกเพื่อเปลี่ยนกราฟ
- ป้าย Delayed สำหรับแหล่งที่ไม่ realtime
- ✅ `SET:PTT`, `US:AAPL`, `FX:XAUUSD` แสดงกราฟ 1D ย้อนหลัง ≥ 2 ปีได้, watchlist อัปเดตราคาเอง

### Phase 3 — Indicators
- ทุกตัวในข้อ 6 + IndicatorPanel ตั้งค่าได้ + legend ตาม crosshair + sub-pane RSI/MACD
- ✅ unit test indicator ผ่านทั้งหมด, เปิด SMA20 + BB + RSI + MACD พร้อมกันบน 1m realtime แล้วไม่กระตุก (≥ 50fps ตอนเลื่อน)

### Phase 4 — Drawing tools + บันทึก layout
- เส้นแนวนอน, trendline, สี่เหลี่ยม, เลือก/ลาก/ลบ, บันทึกต่อ symbol
- บันทึก layout ล่าสุด
- ✅ วาดเส้นบน 1h แล้วเปลี่ยนเป็น 1D เส้นยังอยู่ตำแหน่งราคา/เวลาเดิม, refresh หน้าแล้วทุกอย่างกลับมาครบ

### Phase 5 — Alerts + ขัดเกลา
- ระบบ alert ข้อ 8 ครบ, หน้า AlertsPanel (สร้าง/แก้/ลบ/ประวัติ)
- `docker-compose.yml` (optional), README วิธีติดตั้ง/ตั้งค่า `.env`
- ✅ ตั้ง alert BTC ที่ราคาใกล้ปัจจุบันแล้วได้รับแจ้งเตือนในเบราว์เซอร์และ Telegram ภายใน 1 นาทีหลังราคาข้าม

---

## 10. มาตรฐานโค้ด

- TypeScript `strict: true`, ESLint + Prettier; Python ใช้ ruff + type hints, pytest
- แยก logic คำนวณ (indicators, resample, alert conditions) เป็น pure function ที่มี test
- ห้าม hardcode API key — อ่านจาก `.env` และมี `.env.example`
- Backend bind `127.0.0.1` เท่านั้น, CORS อนุญาตเฉพาะ origin ของ frontend dev/prod
- ทุก adapter ต้องจัดการ rate limit (Binance: เคารพ header `X-MBX-USED-WEIGHT`), retry แบบ backoff, timeout
- Commit แยกตาม Phase, ท้าย Phase สรุปสิ่งที่ทำ + วิธีทดสอบใน README

---

## 11. นอกขอบเขต (ไม่ต้องทำตอนนี้)

- ระบบส่งคำสั่งซื้อขาย / เชื่อมโบรกเกอร์
- Backtesting, ภาษาสคริปต์ indicator แบบ Pine Script
- Multi-user, login, deploy ขึ้น cloud
- กราฟหลายช่องพร้อมกัน (multi-chart layout)

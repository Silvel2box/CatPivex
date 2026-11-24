// Shared API contract. Mirror of backend/app/models.py — change both together.
// See models.py docstring for /api/candles semantics (end is exclusive, time = open time in unix seconds UTC).

export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const;
export type Interval = (typeof INTERVALS)[number];

export const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
};

export type AssetType = 'crypto' | 'stock' | 'fx' | 'commodity';

export type ErrorCode =
  | 'invalid_symbol'
  | 'invalid_interval'
  | 'validation_error'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'internal_error';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: AssetType;
  realtime: boolean;
}

export interface CandlesResponse {
  symbol: string;
  interval: Interval;
  candles: Candle[];
  delayed: boolean;
  warning: string | null;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
}

export interface ErrorResponse {
  error: ErrorBody;
}

// GET/POST/PUT/DELETE /api/watchlist all return this.
export interface Watchlist {
  symbols: string[];
}

// GET /api/quotes?symbols=a,b -> Quote[] in the requested order.
// change / change_percent are vs the previous 1D candle's close. Failed symbol: price null + error.
export interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  change_percent: number | null;
  time: number | null;
  delayed: boolean;
  error: ErrorBody | null;
}

// GET/PUT/DELETE /api/drawings/{symbol} all return this (DELETE -> drawings []).
// PUT body: { drawings: [...] }. The backend stores the list as opaque JSON objects; the
// frontend validates them on load (chart/drawings/geometry.ts sanitizeDrawings).
export interface DrawingsResponse {
  symbol: string;
  drawings: unknown[];
}

// GET/PUT /api/layout. layout = null until first saved. PUT body: { layout: {...} } (opaque JSON
// object; persist/layout.ts sanitizeLayout validates it on load).
export interface LayoutResponse {
  layout: Record<string, unknown> | null;
}

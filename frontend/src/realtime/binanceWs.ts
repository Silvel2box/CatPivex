import type { Candle, Interval } from '../api/types';

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const BINANCE_INTERVAL: Record<Interval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
  '1W': '1w',
};

/** Kline stream URL for a `BINANCE:` symbol, or null for any other exchange. */
export function klineStreamUrl(symbol: string, interval: Interval): string | null {
  const [exchange, ticker] = symbol.split(':');
  if (exchange !== 'BINANCE' || !ticker) return null;
  return `${WS_BASE}/${ticker.toLowerCase()}@kline_${BINANCE_INTERVAL[interval]}`;
}

export interface KlineUpdate {
  candle: Candle;
  closed: boolean;
}

/** Parse a Binance kline stream message (JSON string or already-parsed object). */
export function parseKlineMessage(raw: unknown): KlineUpdate | null {
  let msg: unknown = raw;
  if (typeof raw === 'string') {
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const { e, k: rawK } = msg as { e?: unknown; k?: unknown };
  if (e !== 'kline' || typeof rawK !== 'object' || rawK === null) return null;
  const k = rawK as Record<string, unknown>;
  const candle: Candle = {
    time: Math.floor(Number(k.t) / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
  if (!Object.values(candle).every(Number.isFinite) || typeof k.x !== 'boolean') return null;
  return { candle, closed: k.x };
}

/** Reconnect delay for the given 0-based attempt: 1s, 2s, 4s, ... capped at 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** Minimal WebSocket surface used here, so tests can inject a fake. */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface KlineStreamHandlers {
  onKline: (update: KlineUpdate) => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * Connect to a kline stream and keep it connected (Binance drops connections every 24h).
 * Returns a dispose function that stops the stream and cancels pending reconnects.
 */
export function connectKlineStream(
  url: string,
  handlers: KlineStreamHandlers,
  createSocket: (url: string) => WebSocketLike = (u) => new WebSocket(u) as WebSocketLike,
): () => void {
  let ws: WebSocketLike | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const open = () => {
    const socket = createSocket(url);
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      handlers.onStatus?.(true);
    };
    socket.onmessage = (ev) => {
      const update = parseKlineMessage(ev.data);
      if (update) handlers.onKline(update);
    };
    // A browser fires `close` after `error`; reconnect from `close` only.
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      handlers.onStatus?.(false);
      if (disposed) return;
      timer = setTimeout(open, backoffDelay(attempt++));
    };
  };

  open();

  return () => {
    disposed = true;
    clearTimeout(timer);
    const socket = ws;
    ws = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    handlers.onStatus?.(false);
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  connectKlineStream,
  klineStreamUrl,
  parseKlineMessage,
  type WebSocketLike,
} from './binanceWs';

// Shape from Binance docs: <symbol>@kline_<interval> payload.
const kline = (x: boolean) =>
  JSON.stringify({
    e: 'kline',
    E: 1764000065123,
    s: 'BTCUSDT',
    k: {
      t: 1764000060000,
      T: 1764000119999,
      s: 'BTCUSDT',
      i: '1m',
      o: '86000.10',
      c: '86050.55',
      h: '86100.00',
      l: '85990.01',
      v: '12.345',
      n: 100,
      x,
      q: '1061000.0',
    },
  });

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }
  // test helpers
  open() {
    this.onopen?.({});
  }
  drop() {
    this.close();
  }
}

describe('T1.8 parseKlineMessage', () => {
  it('parses an open (not closed) kline: ms -> s, strings -> numbers', () => {
    expect(parseKlineMessage(kline(false))).toEqual({
      candle: {
        time: 1764000060,
        open: 86000.1,
        high: 86100,
        low: 85990.01,
        close: 86050.55,
        volume: 12.345,
      },
      closed: false,
    });
  });

  it('parses a closed kline', () => {
    expect(parseKlineMessage(kline(true))?.closed).toBe(true);
  });

  it('accepts an already-parsed object', () => {
    expect(parseKlineMessage(JSON.parse(kline(false)))?.candle.time).toBe(1764000060);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['other event', JSON.stringify({ e: 'trade', p: '1' })],
    ['missing k', JSON.stringify({ e: 'kline' })],
    ['non-numeric price', kline(false).replace('"86000.10"', '"abc"')],
    ['missing x', kline(false).replace(',"x":false', '')],
    ['non-string input', 42],
  ])('returns null for malformed input: %s', (_name, raw) => {
    expect(parseKlineMessage(raw)).toBeNull();
  });
});

describe('T1.8 backoffDelay', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10, 50].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ]);
  });
});

describe('T1.8 klineStreamUrl', () => {
  it('builds lowercase stream URLs and maps 1D/1W', () => {
    expect(klineStreamUrl('BINANCE:BTCUSDT', '1m')).toBe(
      'wss://stream.binance.com:9443/ws/btcusdt@kline_1m',
    );
    expect(klineStreamUrl('BINANCE:ETHUSDT', '1D')).toMatch(/ethusdt@kline_1d$/);
    expect(klineStreamUrl('BINANCE:ETHUSDT', '1W')).toMatch(/ethusdt@kline_1w$/);
  });

  it('returns null for non-Binance symbols', () => {
    expect(klineStreamUrl('SET:PTT', '1D')).toBeNull();
  });
});

describe('T1.8 connectKlineStream reconnect', () => {
  const create = (url: string) => new FakeSocket(url);

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects after 1s, then 2s; a successful open resets the backoff', () => {
    const status: boolean[] = [];
    const onKline = vi.fn();
    const dispose = connectKlineStream(
      'wss://x',
      { onKline, onStatus: (c) => status.push(c) },
      create,
    );
    expect(FakeSocket.instances).toHaveLength(1);

    // First drop -> reconnect after 1s.
    FakeSocket.instances[0].drop();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // Second drop without a successful open -> 2s.
    FakeSocket.instances[1].drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    // Open succeeds, messages flow, then drop -> back to 1s.
    FakeSocket.instances[2].open();
    FakeSocket.instances[2].onmessage?.({ data: kline(false) });
    FakeSocket.instances[2].onmessage?.({ data: 'garbage' });
    expect(onKline).toHaveBeenCalledTimes(1);
    FakeSocket.instances[2].drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(4);
    expect(status).toEqual([false, false, true, false]);

    dispose();
  });

  it('error closes the socket and triggers a reconnect', () => {
    connectKlineStream('wss://x', { onKline: vi.fn() }, create);
    FakeSocket.instances[0].onerror?.({});
    expect(FakeSocket.instances[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('dispose closes the socket and cancels pending reconnects', () => {
    const dispose = connectKlineStream('wss://x', { onKline: vi.fn() }, create);
    FakeSocket.instances[0].drop();
    dispose();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    const dispose2 = connectKlineStream('wss://x', { onKline: vi.fn() }, create);
    const live = FakeSocket.instances[1];
    dispose2();
    expect(live.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

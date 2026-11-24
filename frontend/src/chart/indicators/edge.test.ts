import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import { dayKeyFor, INDICATORS, runIndicator } from './index';
import type { IndicatorDef } from './types';

const HOUR = 3600;
const T0 = Date.UTC(2026, 0, 5) / 1000; // 00:00 UTC

const bar = (i: number, close: number, volume = 1): Candle => ({
  time: T0 + i * HOUR,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume,
});
const series = (closes: number[]) => closes.map((c, i) => bar(i, c));
const utc = dayKeyFor('BINANCE:BTCUSDT');
const defs: IndicatorDef[] = Object.values(INDICATORS);
const run = (d: IndicatorDef, bars: Candle[], params = d.defaults) =>
  runIndicator(d.calc, params, utc, bars);
const points = (lines: Record<string, { value: number }[]>) =>
  Object.values(lines).flatMap((l) => l.map((p) => p.value));

/** Throws on any write, so a `next` that mutates its input state fails the test. */
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

describe('T3.3 edge cases', () => {
  for (const d of defs) {
    it(`${d.type}: empty input → no points; update still works`, () => {
      const r = run(d, []);
      expect(points(r.lines)).toEqual([]);
      expect(r.update(bar(0, 1))?.time).toBe(T0);
    });

    it(`${d.type}: next never mutates the incoming state`, () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
      let s = deepFreeze(d.calc.init(d.defaults, utc));
      for (const b of series(closes)) s = deepFreeze(d.calc.next(s, b).state);
    });

    it(`${d.type}: non-finite values are never emitted`, () => {
      const bars = series(Array.from({ length: 60 }, (_, i) => 100 + i));
      bars[40] = { ...bars[40], close: NaN, high: Infinity, volume: Infinity };
      const r = run(d, bars);
      const last = r.update({ ...bars[59], close: NaN });
      expect(points(r.lines).every(Number.isFinite)).toBe(true);
      expect(Object.values(last?.values ?? {}).every(Number.isFinite)).toBe(true);
    });
  }

  it('fewer bars than the period → no points, no throw', () => {
    const closes = (n: number) => series(Array.from({ length: n }, (_, i) => 100 + (i % 3)));
    expect(points(run(INDICATORS.sma, closes(19)).lines)).toEqual([]);
    expect(points(run(INDICATORS.ema, closes(11)).lines)).toEqual([]);
    expect(points(run(INDICATORS.bb, closes(19)).lines)).toEqual([]);
    expect(points(run(INDICATORS.rsi, closes(14)).lines)).toEqual([]); // needs 14 changes
    expect(points(run(INDICATORS.macd, closes(25)).lines)).toEqual([]);
    expect(run(INDICATORS.sma, closes(20)).lines.value).toHaveLength(1);
    expect(run(INDICATORS.rsi, closes(15)).lines.value).toHaveLength(1);
    const macd = run(INDICATORS.macd, closes(34)).lines;
    expect([macd.macd.length, macd.signal.length, macd.hist.length]).toEqual([9, 1, 1]);
  });

  describe('RSI edge rule (Pine ta.rsi)', () => {
    const rsi = (closes: number[]) =>
      run(INDICATORS.rsi, series(closes)).lines.value.map((p) => p.value);
    const n = 30;

    it('flat → 100 (avgLoss = 0, also when avgGain = 0)', () => {
      expect(rsi(Array(n).fill(50))).toEqual(Array(n - 14).fill(100));
    });
    it('up only → 100', () => {
      expect(rsi(Array.from({ length: n }, (_, i) => 50 + i))).toEqual(Array(n - 14).fill(100));
    });
    it('down only → 0', () => {
      expect(rsi(Array.from({ length: n }, (_, i) => 50 - i))).toEqual(Array(n - 14).fill(0));
    });
    it('flat, then one drop → 0', () => {
      expect(rsi([...Array(15).fill(50), 49]).at(-1)).toBe(0);
    });
  });

  it('VWAP: zero cumulative volume → no point; resets at the day key', () => {
    const bars = [
      bar(0, 10, 0), // day 1, no volume yet → no point
      bar(1, 20, 2), // → tp 20
      bar(2, 40, 0), // zero volume mid-day → unchanged 20
      bar(3, 30, 2), // (20·2 + 30·2) / 4 = 25
      bar(24, 99, 0), // next UTC day, zero volume → no point (no carry-over)
      bar(25, 50, 1), // → 50
    ];
    const r = run(INDICATORS.vwap, bars).lines.value;
    expect(r.map((p) => p.time)).toEqual([1, 2, 3, 5].map((i) => bars[i].time));
    expect(r.map((p) => p.value)).toEqual([20, 20, 25, 50]);
  });
});

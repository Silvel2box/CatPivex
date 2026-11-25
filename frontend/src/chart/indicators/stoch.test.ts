import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import { dayKeyFor, INDICATORS, runIndicator } from './index';
import type { IndicatorType, Params } from './types';

const T0 = Date.UTC(2026, 0, 5) / 1000;
const utc = dayKeyFor('BINANCE:BTCUSDT');

const candle = (i: number, close: number, spread: number): Candle => ({
  time: T0 + i * 3600,
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume: 1,
});
const wave = (n: number) =>
  Array.from({ length: n }, (_, i) => candle(i, 100 + Math.sin(i / 2) * 10 + i * 0.1, 1 + (i % 4)));
const run = (type: IndicatorType, bars: Candle[], params: Params) =>
  runIndicator(INDICATORS[type].calc, params, utc, bars).lines;
const firstIndex = (bars: Candle[], line: { time: number }[]) =>
  bars.findIndex((b) => b.time === line[0].time);

describe('T7.1 Stochastic / Stoch RSI edge cases', () => {
  it('stoch: HH = LL → raw 0', () => {
    const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 0));
    const lines = run('stoch', flat, { kLength: 5, kSmooth: 1, dSmooth: 1 });
    expect(lines.k.map((p) => p.value)).toEqual(Array(16).fill(0));
    expect(lines.d.map((p) => p.value)).toEqual(Array(16).fill(0));
  });

  it('stoch: close at the high → 100, at the low → 0', () => {
    const bars = [candle(0, 10, 0), candle(1, 20, 0), candle(2, 15, 0), candle(3, 10, 0)];
    const k = run('stoch', bars, { kLength: 3, kSmooth: 1, dSmooth: 1 }).k.map((p) => p.value);
    expect(k).toEqual([50, 0]);
    expect(run('stoch', bars.slice(0, 2), { kLength: 2, kSmooth: 1, dSmooth: 1 }).k).toEqual([
      { time: bars[1].time, value: 100 },
    ]);
  });

  it('stochrsi: max = min → raw 0 (RSI stuck at 100)', () => {
    const up = Array.from({ length: 40 }, (_, i) => candle(i, 50 + i, 1));
    const lines = run('stochrsi', up, { rsiLength: 5, stochLength: 4, kSmooth: 2, dSmooth: 2 });
    expect(lines.k.length).toBeGreaterThan(0);
    expect([...lines.k, ...lines.d].every((p) => p.value === 0)).toBe(true);
  });

  const stochSets = [
    { kLength: 14, kSmooth: 3, dSmooth: 3 },
    { kLength: 5, kSmooth: 1, dSmooth: 4 },
    { kLength: 1, kSmooth: 1, dSmooth: 1 },
  ];
  for (const p of stochSets) {
    it(`stoch warm-up ${JSON.stringify(p)}`, () => {
      const bars = wave(60);
      const lines = run('stoch', bars, p);
      expect(firstIndex(bars, lines.k)).toBe(p.kLength + p.kSmooth - 2);
      expect(firstIndex(bars, lines.d)).toBe(p.kLength + p.kSmooth + p.dSmooth - 3);
      expect(run('stoch', bars.slice(0, p.kLength + p.kSmooth - 2), p).k).toBeUndefined();
    });
  }

  const rsiSets = [
    { rsiLength: 14, stochLength: 14, kSmooth: 3, dSmooth: 3 },
    { rsiLength: 2, stochLength: 1, kSmooth: 1, dSmooth: 1 },
    { rsiLength: 7, stochLength: 21, kSmooth: 5, dSmooth: 2 },
  ];
  for (const p of rsiSets) {
    it(`stochrsi warm-up ${JSON.stringify(p)}`, () => {
      const bars = wave(80);
      const lines = run('stochrsi', bars, p);
      const k0 = p.rsiLength + p.stochLength + p.kSmooth - 2;
      expect(firstIndex(bars, lines.k)).toBe(k0);
      expect(firstIndex(bars, lines.d)).toBe(k0 + p.dSmooth - 1);
      expect(run('stochrsi', bars.slice(0, k0), p).k).toBeUndefined();
    });
  }

  it('stochrsi k and d stay within 0..100', () => {
    const lines = run('stochrsi', wave(200), INDICATORS.stochrsi.defaults);
    const all = [...lines.k, ...lines.d].map((p) => p.value);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((v) => v >= 0 && v <= 100)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { INTERVALS, type Candle, type Interval } from '../../api/types';
import { dayKeyFor, INDICATORS, runIndicator } from './index';
import { autoTimeframe, periodKey } from './pivot';

const DAY = 86400;
const at = (date: string, hour = 0) => Date.parse(`${date}T00:00:00Z`) / 1000 + hour * 3600;
const candle = (time: number, high: number, low: number, close: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

const run = (
  bars: Candle[],
  daily: Candle[] | null,
  params: Record<string, number>,
  interval: Interval = '1h',
  symbol = 'BINANCE:BTCUSDT',
) =>
  runIndicator(INDICATORS.pivot.calc, params, { ...dayKeyFor(symbol), interval, daily }, bars)
    .lines;

describe('T7.3 pivot points', () => {
  it('Auto: ≤15m → Day, 1h/4h → Week, 1D/1W → Month', () => {
    expect(Object.fromEntries(INTERVALS.map((i) => [i, autoTimeframe(i)]))).toEqual({
      '1m': 'day',
      '5m': 'day',
      '15m': 'day',
      '1h': 'week',
      '4h': 'week',
      '1D': 'month',
      '1W': 'month',
    });
  });

  it('period keys: ISO week (Monday start) across year boundaries, month yyyy-mm', () => {
    expect(periodKey('2024-12-29', 'week')).toBe('2024-W52');
    expect(periodKey('2024-12-30', 'week')).toBe('2025-W01');
    expect(periodKey('2025-01-05', 'week')).toBe('2025-W01');
    expect(periodKey('2025-01-06', 'week')).toBe('2025-W02');
    expect(periodKey('2020-12-31', 'week')).toBe('2020-W53');
    expect(periodKey('2021-01-03', 'week')).toBe('2020-W53');
    expect(periodKey('2021-01-04', 'week')).toBe('2021-W01');
    expect(periodKey('2025-01-31', 'month')).toBe('2025-01');
    expect(periodKey('2025-01-31', 'day')).toBe('2025-01-31');
  });

  it('uses the previous period only; a bar with none has no point', () => {
    const daily = [candle(at('2025-01-06'), 110, 90, 100), candle(at('2025-01-07'), 130, 95, 120)];
    const bars = [at('2025-01-06', 5), at('2025-01-07', 5), at('2025-01-08', 5)].map((t) =>
      candle(t, 1, 1, 1),
    );
    const lines = run(bars, daily, { kind: 0, timeframe: 1 });
    expect(lines.P.map((p) => p.time)).toEqual([bars[1].time, bars[2].time]);
    expect(lines.P[0].value).toBe(100);
    // The 8th has no daily candle: it uses the latest earlier day.
    expect(lines.P[1].value).toBeCloseTo((130 + 95 + 120) / 3, 10);
    expect(run(bars, null, { kind: 0, timeframe: 1 })).toEqual({});
  });

  it('week and month group the daily candles: H = max, L = min, C = last close', () => {
    const daily = [
      candle(at('2024-12-30'), 105, 95, 100),
      candle(at('2025-01-03'), 120, 98, 110),
      candle(at('2025-01-31'), 140, 90, 130),
    ];
    const week = run([candle(at('2025-01-06', 1), 1, 1, 1)], daily, { kind: 0, timeframe: 2 });
    expect(week.P[0].value).toBeCloseTo((120 + 95 + 110) / 3, 10);
    const month = run([candle(at('2025-02-03'), 1, 1, 1)], daily, { kind: 0, timeframe: 3 }, '1D');
    expect(month.P[0].value).toBeCloseTo((140 + 90 + 130) / 3, 10);
  });

  it('intraday bars use the exchange day (US: New York), 1D bars their UTC date', () => {
    const daily = [candle(at('2025-01-06'), 110, 90, 100), candle(at('2025-01-07'), 130, 95, 120)];
    const lateNy = candle(at('2025-01-08', 1), 1, 1, 1); // 20:00 on the 7th in New York
    const ny = run([lateNy], daily, { kind: 0, timeframe: 1 }, '5m', 'US:AAPL');
    expect(ny.P[0].value).toBe(100);
    const utc = run([lateNy], daily, { kind: 0, timeframe: 1 }, '5m', 'BINANCE:BTCUSDT');
    expect(utc.P[0].value).toBeCloseTo(115, 10);
    const d1 = run(
      [candle(at('2025-01-07'), 1, 1, 1)],
      daily,
      { kind: 0, timeframe: 1 },
      '1D',
      'US:AAPL',
    );
    expect(d1.P[0].value).toBe(100);
  });

  it('levels per kind; R4/S4 only for Camarilla', () => {
    const daily = [candle(at('2025-01-06'), 110, 90, 100)];
    const bars = [candle(at('2025-01-07', 3), 1, 1, 1)];
    const value = (kind: number) =>
      Object.fromEntries(
        Object.entries(run(bars, daily, { kind, timeframe: 1 })).map(([k, l]) => [
          k,
          Number(l[0].value.toFixed(6)),
        ]),
      );
    expect(value(0)).toEqual({ P: 100, R1: 110, S1: 90, R2: 120, S2: 80, R3: 130, S3: 70 });
    expect(value(1)).toEqual({
      P: 100,
      R1: 107.64,
      S1: 92.36,
      R2: 112.36,
      S2: 87.64,
      R3: 120,
      S3: 80,
    });
    expect(value(2)).toEqual({
      P: 100,
      R1: 101.833333,
      S1: 98.166667,
      R2: 103.666667,
      S2: 96.333333,
      R3: 105.5,
      S3: 94.5,
      R4: 111,
      S4: 89,
    });
  });

  it('daily is read once in init (the run does not see later changes)', () => {
    const daily = [candle(at('2025-01-06'), 110, 90, 100)];
    const r = runIndicator(
      INDICATORS.pivot.calc,
      { kind: 0, timeframe: 1 },
      { ...dayKeyFor('BINANCE:X'), interval: '1h', daily },
      [],
    );
    daily[0] = candle(at('2025-01-06'), 200, 0, 0);
    expect(r.update(candle(at('2025-01-07') + DAY / 2, 1, 1, 1))?.values?.P).toBe(100);
  });
});

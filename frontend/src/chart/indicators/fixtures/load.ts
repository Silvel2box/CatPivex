// Test-only: fixtures written by scripts/gen_fixtures.py (TA-Lib / pandas expected values).
import type { Candle, Interval } from '../../../api/types';
import { dayKeyFor } from '../index';
import type { CalcContext, IndicatorType, Params } from '../types';

export interface FixtureLine {
  /** Bars where the reference library gave a value (gaps = undefined). */
  index: number[];
  value: number[];
}

export interface FixtureCase {
  type: IndicatorType;
  params: Params;
  library: string;
  lines: Record<string, FixtureLine>;
}

export interface FixtureVolumeProfile {
  start: number;
  end: number;
  rows: number;
  valueAreaPct: number;
  library: string;
  expected: {
    low: number[];
    high: number[];
    up: number[];
    down: number[];
    poc: number;
    vaLow: number;
    vaHigh: number;
    flatBars: number;
  };
}

export interface Fixture {
  name: string;
  symbol: string;
  interval: Interval;
  vwapTimeZone: string;
  candles: Record<keyof Candle, number[]>;
  daily?: Record<keyof Candle, number[]>;
  cases: FixtureCase[];
  volumeProfiles?: FixtureVolumeProfile[];
}

const files = import.meta.glob<Fixture>('./*.json', { eager: true, import: 'default' });

export const FIXTURES: Fixture[] = Object.values(files);

export function candlesOf(f: Fixture, c = f.candles): Candle[] {
  return c.time.map((time, i) => ({
    time,
    open: c.open[i],
    high: c.high[i],
    low: c.low[i],
    close: c.close[i],
    volume: c.volume[i],
  }));
}

export function contextOf(f: Fixture): CalcContext {
  return {
    ...dayKeyFor(f.symbol),
    interval: f.interval,
    daily: f.daily ? candlesOf(f, f.daily) : null,
  };
}

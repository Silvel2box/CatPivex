// Test-only: fixtures written by scripts/gen_fixtures.py (TA-Lib / pandas expected values).
import type { Candle } from '../../../api/types';
import type { IndicatorType, Params } from '../types';

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

export interface Fixture {
  name: string;
  symbol: string;
  interval: string;
  vwapTimeZone: string;
  candles: Record<keyof Candle, number[]>;
  cases: FixtureCase[];
}

const files = import.meta.glob<Fixture>('./*.json', { eager: true, import: 'default' });

export const FIXTURES: Fixture[] = Object.values(files);

export function candlesOf(f: Fixture): Candle[] {
  const c = f.candles;
  return c.time.map((time, i) => ({
    time,
    open: c.open[i],
    high: c.high[i],
    low: c.low[i],
    close: c.close[i],
    volume: c.volume[i],
  }));
}

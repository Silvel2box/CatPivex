import { bbCalc } from './bb';
import { emaCalc } from './ema';
import { macdCalc } from './macd';
import { rsiCalc } from './rsi';
import { smaCalc } from './sma';
import type { CalcContext, IndicatorDef, IndicatorType } from './types';
import { vwapCalc } from './vwap';

export { runIndicator } from './runner';
export type * from './types';

export const INDICATORS: Record<IndicatorType, IndicatorDef> = {
  sma: {
    type: 'sma',
    label: 'SMA',
    pane: 'main',
    defaults: { period: 20 },
    params: [{ key: 'period', label: 'Length', min: 1, max: 500, step: 1 }],
    lines: [{ key: 'value', label: 'SMA', color: '#f7a600', kind: 'line' }],
    calc: smaCalc,
  },
  ema: {
    type: 'ema',
    label: 'EMA',
    pane: 'main',
    defaults: { period: 12 },
    params: [{ key: 'period', label: 'Length', min: 1, max: 500, step: 1 }],
    lines: [{ key: 'value', label: 'EMA', color: '#2962ff', kind: 'line' }],
    calc: emaCalc,
  },
  bb: {
    type: 'bb',
    label: 'Bollinger Bands',
    pane: 'main',
    defaults: { period: 20, mult: 2 },
    params: [
      { key: 'period', label: 'Length', min: 2, max: 500, step: 1 },
      { key: 'mult', label: 'StdDev', min: 0.1, max: 10, step: 0.1 },
    ],
    lines: [
      { key: 'upper', label: 'Upper', color: '#2196f3', kind: 'line' },
      { key: 'middle', label: 'Basis', color: '#ff6d00', kind: 'line' },
      { key: 'lower', label: 'Lower', color: '#2196f3', kind: 'line' },
    ],
    calc: bbCalc,
  },
  vwap: {
    type: 'vwap',
    label: 'VWAP',
    pane: 'main',
    defaults: {},
    params: [],
    lines: [{ key: 'value', label: 'VWAP', color: '#e040fb', kind: 'line' }],
    intradayOnly: true,
    calc: vwapCalc,
  },
  rsi: {
    type: 'rsi',
    label: 'RSI',
    pane: 'sub',
    defaults: { period: 14 },
    params: [{ key: 'period', label: 'Length', min: 2, max: 200, step: 1 }],
    lines: [{ key: 'value', label: 'RSI', color: '#7e57c2', kind: 'line' }],
    levels: [30, 70],
    calc: rsiCalc,
  },
  macd: {
    type: 'macd',
    label: 'MACD',
    pane: 'sub',
    defaults: { fast: 12, slow: 26, signal: 9 },
    params: [
      { key: 'fast', label: 'Fast', min: 1, max: 200, step: 1 },
      { key: 'slow', label: 'Slow', min: 2, max: 400, step: 1 },
      { key: 'signal', label: 'Signal', min: 1, max: 200, step: 1 },
    ],
    lines: [
      { key: 'hist', label: 'Histogram', color: '#26a69a', kind: 'histogram' },
      { key: 'macd', label: 'MACD', color: '#2962ff', kind: 'line' },
      { key: 'signal', label: 'Signal', color: '#ff6d00', kind: 'line' },
    ],
    levels: [0],
    calc: macdCalc,
  },
};

const DAY_TZ: Record<string, string> = { SET: 'Asia/Bangkok', US: 'America/New_York' };
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** VWAP session day: BINANCE/FX (and unknown) → UTC date, SET → Bangkok, US → New York. */
export function dayKeyFor(symbol: string): CalcContext {
  const tz = DAY_TZ[symbol.split(':')[0] ?? ''] ?? 'UTC';
  let fmt = dayFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); // yyyy-mm-dd
    dayFormatters.set(tz, fmt);
  }
  const f = fmt;
  return { dayKey: (time) => f.format(new Date(time * 1000)) };
}

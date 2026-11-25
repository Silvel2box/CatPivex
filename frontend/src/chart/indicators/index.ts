import { atrCalc } from './atr';
import { bbCalc } from './bb';
import { emaCalc } from './ema';
import { macdCalc } from './macd';
import { pivotCalc } from './pivot';
import { rsiCalc } from './rsi';
import { smaCalc } from './sma';
import { stochCalc } from './stoch';
import { stochrsiCalc } from './stochrsi';
import { supertrendCalc } from './supertrend';
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
  stoch: {
    type: 'stoch',
    label: 'Stochastic',
    pane: 'sub',
    defaults: { kLength: 14, kSmooth: 3, dSmooth: 3 },
    params: [
      { key: 'kLength', label: '%K length', min: 1, max: 200, step: 1 },
      { key: 'kSmooth', label: '%K smoothing', min: 1, max: 50, step: 1 },
      { key: 'dSmooth', label: '%D smoothing', min: 1, max: 50, step: 1 },
    ],
    lines: [
      { key: 'k', label: '%K', color: '#2962ff', kind: 'line' },
      { key: 'd', label: '%D', color: '#ff6d00', kind: 'line' },
    ],
    levels: [20, 80],
    calc: stochCalc,
  },
  stochrsi: {
    type: 'stochrsi',
    label: 'Stoch RSI',
    pane: 'sub',
    defaults: { rsiLength: 14, stochLength: 14, kSmooth: 3, dSmooth: 3 },
    params: [
      { key: 'rsiLength', label: 'RSI length', min: 2, max: 200, step: 1 },
      { key: 'stochLength', label: 'Stoch length', min: 1, max: 200, step: 1 },
      { key: 'kSmooth', label: '%K smoothing', min: 1, max: 50, step: 1 },
      { key: 'dSmooth', label: '%D smoothing', min: 1, max: 50, step: 1 },
    ],
    lines: [
      { key: 'k', label: '%K', color: '#2962ff', kind: 'line' },
      { key: 'd', label: '%D', color: '#ff6d00', kind: 'line' },
    ],
    levels: [20, 80],
    calc: stochrsiCalc,
  },
  atr: {
    type: 'atr',
    label: 'ATR',
    pane: 'sub',
    defaults: { period: 14 },
    params: [{ key: 'period', label: 'Length', min: 1, max: 500, step: 1 }],
    lines: [{ key: 'value', label: 'ATR', color: '#b71c1c', kind: 'line' }],
    calc: atrCalc,
  },
  supertrend: {
    type: 'supertrend',
    label: 'Supertrend',
    pane: 'main',
    defaults: { atrPeriod: 10, factor: 3 },
    params: [
      { key: 'atrPeriod', label: 'ATR length', min: 1, max: 500, step: 1 },
      { key: 'factor', label: 'Factor', min: 0.1, max: 20, step: 0.1 },
    ],
    lines: [
      { key: 'up', label: 'Up trend', color: '#089981', kind: 'line', gaps: true },
      { key: 'down', label: 'Down trend', color: '#f23645', kind: 'line', gaps: true },
    ],
    calc: supertrendCalc,
  },
  pivot: {
    type: 'pivot',
    label: 'Pivot Points',
    pane: 'main',
    defaults: { kind: 0, timeframe: 0 },
    params: [
      {
        key: 'kind',
        label: 'Type',
        min: 0,
        max: 2,
        step: 1,
        options: [
          { value: 0, label: 'Standard' },
          { value: 1, label: 'Fibonacci' },
          { value: 2, label: 'Camarilla' },
        ],
      },
      {
        key: 'timeframe',
        label: 'Timeframe',
        min: 0,
        max: 3,
        step: 1,
        options: [
          { value: 0, label: 'Auto' },
          { value: 1, label: 'Day' },
          { value: 2, label: 'Week' },
          { value: 3, label: 'Month' },
        ],
      },
    ],
    lines: [
      { key: 'R4', label: 'R4', color: '#f23645', kind: 'line', gaps: true },
      { key: 'R3', label: 'R3', color: '#f23645', kind: 'line', gaps: true },
      { key: 'R2', label: 'R2', color: '#f23645', kind: 'line', gaps: true },
      { key: 'R1', label: 'R1', color: '#f23645', kind: 'line', gaps: true },
      { key: 'P', label: 'P', color: '#ff9800', kind: 'line', gaps: true },
      { key: 'S1', label: 'S1', color: '#089981', kind: 'line', gaps: true },
      { key: 'S2', label: 'S2', color: '#089981', kind: 'line', gaps: true },
      { key: 'S3', label: 'S3', color: '#089981', kind: 'line', gaps: true },
      { key: 'S4', label: 'S4', color: '#089981', kind: 'line', gaps: true },
    ],
    needsDaily: true,
    calc: pivotCalc,
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

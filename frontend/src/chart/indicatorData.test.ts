import { describe, expect, it } from 'vitest';
import type { Candle } from '../api/types';
import type { IndicatorInstance } from '../store/indicatorStore';
import {
  HIST_DOWN,
  activeInstances,
  buildLegend,
  formatValue,
  formatVolume,
  histColor,
  indexAt,
  instanceLabel,
  toSeriesData,
} from './indicatorData';
import { INDICATORS } from './indicators';
import type { IndicatorCalc, IndicatorDef, Params } from './indicators/types';

// Fake calc: never called by these helpers, only needed to satisfy IndicatorDef.
const fakeCalc: IndicatorCalc<Params, unknown> = {
  init: () => null,
  next: (state, c) => ({ state, out: { value: c.close } }),
};

const def = (over: Partial<IndicatorDef>): IndicatorDef => ({
  type: 'sma',
  label: 'SMA',
  pane: 'main',
  defaults: { period: 20 },
  params: [{ key: 'period', label: 'Length', min: 1, max: 500, step: 1 }],
  lines: [{ key: 'value', label: 'SMA', color: '#f7a600', kind: 'line' }],
  calc: fakeCalc,
  ...over,
});

const DEFS: Record<string, IndicatorDef> = {
  sma: def({}),
  vwap: def({ type: 'vwap', label: 'VWAP', params: [], defaults: {}, intradayOnly: true }),
  macd: def({
    type: 'macd',
    label: 'MACD',
    pane: 'sub',
    params: [
      { key: 'fast', label: 'Fast', min: 1, max: 200, step: 1 },
      { key: 'slow', label: 'Slow', min: 2, max: 400, step: 1 },
      { key: 'signal', label: 'Signal', min: 1, max: 200, step: 1 },
    ],
    lines: [
      { key: 'hist', label: 'Histogram', color: '#26a69a', kind: 'histogram' },
      { key: 'macd', label: 'MACD', color: '#2962ff', kind: 'line' },
    ],
  }),
};

const inst = (id: string, type: IndicatorInstance['type'], visible = true): IndicatorInstance => ({
  id,
  type,
  params: {},
  colors: {},
  widths: {},
  visible,
});

const bar = (time: number, open: number, close: number): Candle => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1500,
});

describe('T3.7 indicator helpers', () => {
  it('activeInstances drops hidden ones and intradayOnly on 1D/1W, keeping order', () => {
    const list = [inst('a', 'sma'), inst('b', 'vwap'), inst('c', 'macd', false), inst('d', 'macd')];
    expect(activeInstances(list, DEFS, '5m').map((i) => i.id)).toEqual(['a', 'b', 'd']);
    expect(activeInstances(list, DEFS, '1D').map((i) => i.id)).toEqual(['a', 'd']);
    expect(activeInstances(list, DEFS, '1W').map((i) => i.id)).toEqual(['a', 'd']);
  });

  it('histogram points are coloured by sign; lines carry no colour', () => {
    expect(histColor(0, '#00ff00')).toBe('#00ff00');
    expect(histColor(-0.01, '#00ff00')).toBe(HIST_DOWN);
    const pts = [
      { time: 1, value: 2 },
      { time: 2, value: -1 },
    ];
    expect(toSeriesData('histogram', pts, '#0f0')).toEqual([
      { time: 1, value: 2, color: '#0f0' },
      { time: 2, value: -1, color: HIST_DOWN },
    ]);
    expect(toSeriesData('line', pts, '#0f0')).toEqual(pts);
  });

  it('indexAt finds exact times by binary search', () => {
    const pts = [10, 20, 30, 40].map((time) => ({ time, value: time }));
    expect(indexAt(pts, 10)).toBe(0);
    expect(indexAt(pts, 40)).toBe(3);
    expect(indexAt(pts, 25)).toBe(-1);
    expect(indexAt([], 10)).toBe(-1);
  });

  it('labels and number formatting', () => {
    expect(instanceLabel(DEFS.sma, { period: 50 })).toBe('SMA 50');
    expect(instanceLabel(DEFS.macd, { fast: 12, slow: 26, signal: 9 })).toBe('MACD 12 26 9');
    expect(instanceLabel(DEFS.vwap, {})).toBe('VWAP');
    expect(instanceLabel(INDICATORS.pivot, { kind: 2, timeframe: 0 })).toBe(
      'Pivot Points Camarilla Auto',
    );
    expect(formatValue(95123.456)).toBe('95,123.46');
    expect(formatValue(1.08543)).toBe('1.0854');
    expect(formatValue(-0.001234)).toBe('-0.001234');
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue(NaN)).toBe('—');
    expect(formatVolume(1500)).toBe('1.5K');
  });

  it('buildLegend shows the crosshair bar or the last bar, with per-line values', () => {
    const bars = [bar(60, 1, 2), bar(120, 3, 2), bar(180, 2, 4)];
    const sources = [
      {
        id: 'm',
        def: DEFS.macd,
        params: { fast: 12, slow: 26, signal: 9 },
        colors: { hist: '#00ff00', macd: '#123456' },
        lines: {
          hist: [
            { time: 120, value: -0.5 },
            { time: 180, value: 0.5 },
          ],
          macd: [{ time: 180, value: 1.5 }],
        },
      },
    ];
    const at = (time: number | null) =>
      buildLegend({ symbol: 'BINANCE:BTCUSDT', interval: '1m', bars, time, sources });

    const hover = at(120);
    expect(hover.time).toBe(120);
    expect(hover.color).toBe('#ef5350'); // close < open
    expect(hover.rows[0].label).toBe('MACD 12 26 9');
    expect(hover.rows[0].values).toEqual([
      { line: 'hist', text: '-0.5', color: HIST_DOWN },
      { line: 'macd', text: '—', color: '#123456' },
    ]);

    for (const off of [null, 999]) {
      const last = at(off);
      expect(last.time).toBe(180);
      expect(last.color).toBe('#26a69a');
      expect(last.rows[0].values.map((v) => v.text)).toEqual(['0.5', '1.5000']);
    }

    expect(buildLegend({ symbol: 'X', interval: '1D', bars: [], time: null, sources: [] })).toEqual(
      { symbol: 'X', interval: '1D', time: null, bar: null, color: '#26a69a', rows: [] },
    );
  });
});

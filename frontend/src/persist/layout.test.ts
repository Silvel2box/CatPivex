import { describe, expect, it } from 'vitest';
import { INDICATORS } from '../chart/indicators';
import { DEFAULT_LAYOUT, sanitizeLayout, type Layout } from './layout';

const sma = {
  id: 'ind-1',
  type: 'sma',
  params: { period: 50 },
  colors: { value: '#ff0000' },
  widths: { value: 3 },
  visible: false,
};
const macd = {
  id: 'ind-2',
  type: 'macd',
  params: { fast: 12, slow: 26, signal: 9 },
  colors: { hist: '#26a69a', macd: '#2962ff', signal: '#ff6d00' },
  widths: { macd: 2, signal: 1 },
  visible: true,
};
const vwap = {
  id: 'ind-3',
  type: 'vwap',
  params: {},
  colors: { value: '#e040fb' },
  widths: { value: 1 },
  visible: true,
};

const valid: Layout = {
  version: 1,
  symbol: 'SET:PTT',
  interval: '1D',
  indicators: [sma, macd, vwap] as Layout['indicators'],
  volumeVisible: false,
  magnet: false,
};

describe('T4.8 sanitizeLayout', () => {
  it('returns DEFAULT_LAYOUT for null, {} and garbage', () => {
    for (const raw of [null, undefined, {}, [], 'layout', 42, true, [valid]]) {
      expect(sanitizeLayout(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('returns a fresh object (callers may mutate it without touching DEFAULT_LAYOUT)', () => {
    const out = sanitizeLayout(null);
    expect(out).not.toBe(DEFAULT_LAYOUT);
    expect(out.indicators).not.toBe(DEFAULT_LAYOUT.indicators);
  });

  it('keeps a fully valid layout', () => {
    expect(sanitizeLayout(structuredClone(valid))).toEqual(valid);
  });

  it('replaces each invalid top-level field on its own', () => {
    const out = sanitizeLayout({
      ...valid,
      version: 7, // other version: fields still read one by one
      symbol: 'btcusdt', // lowercase, no exchange
      interval: '2h',
      volumeVisible: 'yes',
    });
    expect(out).toEqual({
      ...valid,
      symbol: DEFAULT_LAYOUT.symbol,
      interval: DEFAULT_LAYOUT.interval,
      volumeVisible: DEFAULT_LAYOUT.volumeVisible,
    });
    expect(sanitizeLayout({ ...valid, magnet: 1, indicators: 'none' })).toEqual({
      ...valid,
      magnet: DEFAULT_LAYOUT.magnet,
      indicators: [],
    });
  });

  it('accepts the symbol charset of the regex', () => {
    for (const symbol of [
      'BINANCE:BTCUSDT',
      'US:BRK.B',
      'FX:EURUSD=X',
      'US:^GSPC',
      'SET:SET50-F',
    ]) {
      expect(sanitizeLayout({ symbol }).symbol).toBe(symbol);
    }
    for (const symbol of ['BTCUSDT', 'BINANCE:', ':BTC', 'BINANCE:btc', 'A:B C', 7]) {
      expect(sanitizeLayout({ symbol }).symbol).toBe(DEFAULT_LAYOUT.symbol);
    }
  });

  it('drops indicators with an unknown type or invalid params (never fills them in)', () => {
    const bad = [
      { ...sma, id: 'x1', type: 'ichimoku' },
      { ...sma, id: 'x2', type: 'toString' },
      { ...sma, id: 'x3', params: { period: 0 } }, // below min
      { ...sma, id: 'x4', params: { period: 20.5 } }, // off step
      { ...sma, id: 'x5', params: { period: '20' } },
      { ...sma, id: 'x6', params: {} }, // missing
      { ...macd, id: 'x7', params: { fast: 12, slow: 26 } },
      { ...sma, id: 'x8', params: null },
      { ...sma, id: '' },
      { ...sma, id: undefined },
      null,
      'sma',
    ];
    const out = sanitizeLayout({ ...valid, indicators: [...bad, sma] });
    expect(out.indicators).toEqual([sma]);
  });

  it('strips unknown param keys', () => {
    const out = sanitizeLayout({ indicators: [{ ...sma, params: { period: 50, junk: 1 } }] });
    expect(out.indicators[0].params).toEqual({ period: 50 });
  });

  it('drops duplicate indicator ids (first valid one wins)', () => {
    const out = sanitizeLayout({
      indicators: [sma, { ...macd, id: sma.id }, { ...vwap, id: 'ind-9' }],
    });
    expect(out.indicators.map((i) => [i.id, i.type])).toEqual([
      ['ind-1', 'sma'],
      ['ind-9', 'vwap'],
    ]);
  });

  it('bad colour -> the def colour; bad width -> default width; histograms get no width', () => {
    const out = sanitizeLayout({
      indicators: [
        {
          ...macd,
          colors: { hist: 'green', macd: '#12345', signal: '#ABCDEF', junk: '#000000' },
          widths: { hist: 2, macd: 5, signal: '2' },
        },
        { ...sma, colors: {}, widths: null, visible: 'no' },
      ],
    });
    const [m, s] = out.indicators;
    expect(m.colors).toEqual({
      hist: INDICATORS.macd.lines[0].color,
      macd: INDICATORS.macd.lines[1].color,
      signal: '#ABCDEF',
    });
    expect(m.widths).toEqual({ macd: 1, signal: 1 });
    expect(s.colors).toEqual({ value: INDICATORS.sma.lines[0].color });
    expect(s.widths).toEqual({ value: 1 });
    expect(s.visible).toBe(true);
  });
});

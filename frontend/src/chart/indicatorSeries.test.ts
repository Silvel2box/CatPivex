import type { IChartApi } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../api/types';
import type { IndicatorInstance } from '../store/indicatorStore';
import { GAP_COLOR, HIST_DOWN } from './indicatorData';
import { IndicatorLayer } from './indicatorSeries';
import { applyRealtimeBar } from './series';
import { runIndicator } from './indicators';
import type { BarValues, IndicatorCalc, IndicatorRun, LinePoint, Params } from './indicators/types';

/** Minimal stand-in for the chart: panes of series, empty panes (except 0) disappear. */
function fakeChart() {
  const panes: FakeSeries[][] = [[]];
  interface FakeSeries {
    opts: Record<string, unknown>;
    data: { time: number; value: number; color?: string }[];
    updates: { time: number; value: number; color?: string; historical?: boolean }[];
    priceLines: number[];
    setData(d: FakeSeries['data']): void;
    update(p: FakeSeries['data'][number], historical?: boolean): void;
    applyOptions(o: Record<string, unknown>): void;
    options(): Record<string, unknown>;
    createPriceLine(o: { price: number }): void;
    getPane(): { paneIndex(): number };
  }
  const paneApi = (pane: FakeSeries[]) => ({
    paneIndex: () => panes.indexOf(pane),
    setStretchFactor: () => {},
  });
  const chart = {
    addSeries(_def: unknown, opts: Record<string, unknown>, paneIndex = 0) {
      if (paneIndex >= panes.length) panes.push([]);
      const pane = panes[paneIndex];
      const s: FakeSeries = {
        opts,
        data: [],
        updates: [],
        priceLines: [],
        setData(d) {
          s.data = d;
        },
        update(p, historical) {
          s.updates.push(historical ? { ...p, historical } : p);
        },
        applyOptions(o) {
          Object.assign(s.opts, o);
        },
        options: () => s.opts,
        createPriceLine(o) {
          s.priceLines.push(o.price);
        },
        getPane: () => paneApi(pane),
      };
      pane.push(s);
      return s;
    },
    removeSeries(s: FakeSeries) {
      const pane = panes.find((p) => p.includes(s))!;
      pane.splice(pane.indexOf(s), 1);
      const i = panes.indexOf(pane);
      if (pane.length === 0 && i > 0) panes.splice(i, 1);
    },
    panes: () => panes.map(paneApi),
  };
  return { chart: chart as unknown as IChartApi, panes };
}

/** Fake run: every line = close - open at every bar; update replaces/appends. */
function fakeRunner() {
  const calls: Params[] = [];
  const run = vi.fn((_calc: unknown, params: Params, _ctx: unknown, bars: Candle[]) => {
    calls.push(params);
    const keys = ['value', 'hist', 'macd', 'signal'];
    const v = (b: Candle) => b.close - b.open;
    const lines: Record<string, LinePoint[]> = Object.fromEntries(
      keys.map((k) => [k, bars.map((b) => ({ time: b.time, value: v(b) }))]),
    );
    const result: IndicatorRun = {
      lines,
      update(bar) {
        const pts = lines.value;
        const last = pts[pts.length - 1];
        if (last && bar.time < last.time) return null;
        const values = Object.fromEntries(keys.map((k) => [k, v(bar)]));
        for (const k of keys) {
          const p = { time: bar.time, value: v(bar) };
          if (last && last.time === bar.time) lines[k][lines[k].length - 1] = p;
          else lines[k].push(p);
        }
        return { time: bar.time, values };
      },
    };
    return result;
  });
  return { run, calls };
}

const bar = (time: number, open: number, close: number): Candle => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1,
});
const BARS = [bar(60, 1, 2), bar(120, 3, 1)];

const inst = (id: string, type: IndicatorInstance['type'], params: Params = {}) => ({
  id,
  type,
  params,
  colors: {},
  widths: {},
  visible: true,
});

describe('T3.7 IndicatorLayer (fake chart + fake runner)', () => {
  it('main indicators share pane 0, each sub indicator gets its own pane', () => {
    const { chart, panes } = fakeChart();
    const layer = new IndicatorLayer(chart, fakeRunner().run);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    layer.setInstances([inst('a', 'sma', { period: 20 }), inst('b', 'rsi'), inst('c', 'macd')]);
    expect(panes.map((p) => p.length)).toEqual([1, 1, 3]);
    expect(panes[0][0].opts).toMatchObject({ lastValueVisible: false, priceLineVisible: false });
    expect(panes[1][0].priceLines).toEqual([30, 70]);
    // MACD histogram coloured by sign.
    expect(panes[2][0].data.map((p) => p.color)).toEqual(['#26a69a', HIST_DOWN]);

    layer.setInstances([inst('a', 'sma', { period: 20 }), inst('c', 'macd')]);
    expect(panes.map((p) => p.length)).toEqual([1, 3]);
    layer.setInstances([]);
    expect(panes.map((p) => p.length)).toEqual([0]);
  });

  it('reruns only the instance whose params changed; source change reruns all once', () => {
    const { chart } = fakeChart();
    const { run, calls } = fakeRunner();
    const layer = new IndicatorLayer(chart, run);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    const a = inst('a', 'sma', { period: 20 });
    const b = inst('b', 'ema', { period: 12 });
    layer.setInstances([a, b]);
    expect(calls).toHaveLength(2);
    layer.setInstances([a, { ...b, params: { period: 50 } }]);
    expect(calls.slice(2)).toEqual([{ period: 50 }]);
    layer.setInstances([a, { ...b, params: { period: 50 }, colors: { value: '#fff' } }]);
    expect(calls).toHaveLength(3);
    layer.setSource('BINANCE:ETHUSDT', '5m', BARS);
    expect(calls).toHaveLength(5);
  });

  it('line width: applied on create, changed without rerunning; histogram untouched', () => {
    const { chart, panes } = fakeChart();
    const { run, calls } = fakeRunner();
    const layer = new IndicatorLayer(chart, run);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    const c = { ...inst('c', 'macd'), widths: { macd: 2 } };
    layer.setInstances([c]);
    const [hist, macd, signal] = panes[1];
    expect(macd.opts.lineWidth).toBe(2);
    expect(signal.opts.lineWidth).toBe(1); // default when unset
    expect(hist.opts.lineWidth).toBeUndefined();
    layer.setInstances([{ ...c, widths: { macd: 2, signal: 4 } }]);
    expect(signal.opts.lineWidth).toBe(4);
    expect(calls).toHaveLength(1);
  });

  it('realtime bars update series incrementally, without rerunning', () => {
    const { chart, panes } = fakeChart();
    const { run } = fakeRunner();
    const layer = new IndicatorLayer(chart, run);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    layer.setInstances([inst('c', 'macd')]);
    layer.update(bar(120, 3, 5)); // replace last
    layer.update(bar(180, 5, 4)); // append
    layer.update(bar(60, 1, 1)); // older: ignored
    expect(run).toHaveBeenCalledTimes(1);
    const [hist, macd] = panes[1];
    expect(hist.updates).toEqual([
      { time: 120, value: 2, color: '#26a69a' },
      { time: 180, value: -1, color: HIST_DOWN },
    ]);
    expect(macd.updates).toEqual([
      { time: 120, value: 2 },
      { time: 180, value: -1 },
    ]);
    expect(layer.debug()[0].lines.macd).toEqual({
      count: 3,
      last: { time: 180, value: -1 },
      width: 1,
    });
  });

  it('hides intradayOnly on 1D/1W; a throwing runner logs once and leaves empty series', () => {
    const { chart, panes } = fakeChart();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = new IndicatorLayer(chart, () => {
      throw new Error('stub');
    });
    layer.setInstances([inst('v', 'vwap'), inst('r', 'rsi')]);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    layer.setSource('BINANCE:BTCUSDT', '1m', BARS);
    expect(layer.debug().map((d) => d.type)).toEqual(['vwap', 'rsi']);
    expect(err).toHaveBeenCalledTimes(2); // once per instance
    expect(panes[1][0].data).toEqual([]);
    layer.update(bar(180, 1, 2)); // no run: nothing happens
    layer.setSource('BINANCE:BTCUSDT', '1D', BARS);
    expect(layer.debug().map((d) => d.type)).toEqual(['rsi']);
    expect(panes.map((p) => p.length)).toEqual([0, 1]);
    err.mockRestore();
  });
});

describe('T7.2 gaps lines (fake chart, real runner)', () => {
  // close > open → up (and SMA "value"), close < open → down, flat → nothing.
  const splitCalc: IndicatorCalc<Params, null> = {
    init: () => null,
    next(state, c) {
      let out: BarValues | null = null;
      if (c.close > c.open) out = { up: c.close, value: c.close };
      else if (c.close < c.open) out = { down: c.close };
      return { state, out };
    },
  };
  const run = (
    _calc: unknown,
    params: Params,
    ctx: Parameters<typeof runIndicator>[2],
    bars: Candle[],
  ) => runIndicator(splitCalc, params, ctx, bars);

  const setup = (bars: Candle[]) => {
    const { chart, panes } = fakeChart();
    const layer = new IndicatorLayer(chart, run);
    layer.setSource('BINANCE:BTCUSDT', '1m', bars);
    layer.setInstances([inst('st', 'supertrend'), inst('s', 'sma', { period: 20 })]);
    const [up, down, sma] = panes[0];
    return { layer, up, down, sma };
  };

  it('setData: whitespace after the first point for gaps lines only', () => {
    const { up, down, sma } = setup([
      bar(60, 2, 2),
      bar(120, 1, 2),
      bar(180, 3, 1),
      bar(240, 1, 4),
    ]);
    expect(up.data).toEqual([
      { time: 120, value: 2, color: GAP_COLOR },
      { time: 180 },
      { time: 240, value: 4 },
    ]);
    expect(down.data).toEqual([{ time: 180, value: 1, color: GAP_COLOR }, { time: 240 }]);
    expect(sma.data).toEqual([
      { time: 120, value: 2 },
      { time: 240, value: 4 },
    ]);
  });

  it('realtime: gap → value → gap on the same bar, break colour on the point before a gap', () => {
    const bars = [bar(60, 2, 2), bar(120, 1, 2)];
    const { layer, up, down, sma } = setup(bars);
    // As ChartView: the bar is merged into the candles before the layer update.
    const tick = (b: Candle) => {
      applyRealtimeBar(bars, b);
      layer.update(b);
    };
    tick(bar(180, 1, 3));
    expect(down.updates).toEqual([]); // not started: no whitespace
    tick(bar(240, 4, 3));
    tick(bar(240, 4, 6));
    tick(bar(240, 4, 2));
    tick(bar(300, 1, 5));
    expect(up.updates).toEqual([
      { time: 120, value: 2, historical: true },
      { time: 180, value: 3 },
      { time: 180, value: 3, color: GAP_COLOR, historical: true },
      { time: 240 },
      { time: 180, value: 3, historical: true },
      { time: 240, value: 6 },
      { time: 180, value: 3, color: GAP_COLOR, historical: true },
      { time: 240 },
      { time: 180, value: 3, color: GAP_COLOR, historical: true }, // 240 is still a gap
      { time: 300, value: 5 },
    ]);
    expect(down.updates).toEqual([
      { time: 240, value: 3 },
      { time: 240 },
      { time: 240, value: 2 },
      { time: 240, value: 2, color: GAP_COLOR, historical: true },
      { time: 300 },
    ]);
    expect(sma.updates).toEqual([
      { time: 180, value: 3 },
      { time: 240, value: 6 },
      { time: 300, value: 5 },
    ]);
    const lines = layer.debug()[0].lines;
    expect(lines.up).toMatchObject({ count: 3, last: { time: 300, value: 5 } });
    expect(lines.down).toMatchObject({ count: 1, last: { time: 240, value: 2 } });
  });
});

import type { IChartApi } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import type { fetchCandles } from '../api/client';
import type { Candle, CandlesResponse } from '../api/types';
import type { IndicatorInstance } from '../store/indicatorStore';
import { HIST_DOWN } from './indicatorData';
import { IndicatorLayer } from './indicatorSeries';
import type { CalcContext, IndicatorRun, LinePoint, Params } from './indicators/types';

/** Minimal stand-in for the chart: panes of series, empty panes (except 0) disappear. */
function fakeChart() {
  const panes: FakeSeries[][] = [[]];
  interface FakeSeries {
    opts: Record<string, unknown>;
    data: { time: number; value: number; color?: string }[];
    updates: { time: number; value: number; color?: string }[];
    priceLines: number[];
    setData(d: FakeSeries['data']): void;
    update(p: FakeSeries['data'][number]): void;
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
        update(p) {
          s.updates.push(p);
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

function fakeDaily() {
  const reqs: {
    query: { symbol: string; interval: string; limit?: number };
    signal: AbortSignal;
    resolve(candles: Candle[]): void;
    reject(err: unknown): void;
  }[] = [];
  const fetch = vi.fn(
    (query: { symbol: string; interval: string; limit?: number }, signal?: AbortSignal) =>
      new Promise<CandlesResponse>((resolve, reject) =>
        reqs.push({
          query,
          signal: signal!,
          resolve: (candles) =>
            resolve({
              symbol: query.symbol,
              interval: '1D',
              candles,
              delayed: false,
              warning: null,
            }),
          reject,
        }),
      ),
  );
  return { fetch: fetch as unknown as typeof fetchCandles, reqs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ctxOf = (run: ReturnType<typeof fakeRunner>['run'], i: number) =>
  run.mock.calls[i][2] as CalcContext;
const DAY0 = Date.UTC(2026, 10, 24) / 1000;
const DAILY = [bar(DAY0 - 86400, 1, 2), bar(DAY0, 2, 3)];
const pivot = inst('p', 'pivot', { kind: 0, timeframe: 0 });

describe('T7.3 IndicatorLayer daily candles for pivots', () => {
  it('fetches 1D once for the symbol and reruns only pivots when it arrives', async () => {
    const { chart, panes } = fakeChart();
    const { run } = fakeRunner();
    const { fetch, reqs } = fakeDaily();
    const layer = new IndicatorLayer(chart, run, fetch);
    const now = Math.floor(Date.now() / 1000);
    const recent = [bar(now - 120, 1, 2), bar(now - 60, 2, 3)];
    layer.setSource('BINANCE:BTCUSDT', '1m', recent);
    layer.setInstances([inst('s', 'sma', { period: 20 })]);
    expect(reqs).toHaveLength(0);
    layer.setInstances([inst('s', 'sma', { period: 20 }), pivot]);
    layer.setSource('BINANCE:BTCUSDT', '1m', recent);
    expect(reqs.map((r) => r.query)).toEqual([
      { symbol: 'BINANCE:BTCUSDT', interval: '1D', limit: 100 },
    ]);
    expect(run).toHaveBeenCalledTimes(4);
    expect(ctxOf(run, 1)).toMatchObject({ interval: '1m', daily: null });
    expect(panes[0][1].opts).toMatchObject({ lastValueVisible: false, priceLineVisible: false });

    reqs[0].resolve(DAILY);
    await flush();
    expect(run).toHaveBeenCalledTimes(5);
    expect(run.mock.calls[4][1]).toEqual(pivot.params);
    expect(ctxOf(run, 4)).toMatchObject({ interval: '1m', daily: DAILY });
    expect(ctxOf(run, 4).dayKey(DAY0)).toBe('2026-11-24');

    layer.setSource('BINANCE:BTCUSDT', '5m', recent); // cached per symbol
    expect(reqs).toHaveLength(1);
    expect(ctxOf(run, run.mock.calls.length - 1).daily).toBe(DAILY);
  });

  it('long history asks for more days (capped at 1000); a symbol switch aborts the old request', async () => {
    const { chart } = fakeChart();
    const { run } = fakeRunner();
    const { fetch, reqs } = fakeDaily();
    const layer = new IndicatorLayer(chart, run, fetch);
    layer.setInstances([pivot]);
    layer.setSource('BINANCE:BTCUSDT', '1h', BARS); // 1970: capped
    layer.setSource('BINANCE:ETHUSDT', '1h', BARS);
    expect(reqs.map((r) => [r.query.symbol, r.query.limit, r.signal.aborted])).toEqual([
      ['BINANCE:BTCUSDT', 1000, true],
      ['BINANCE:ETHUSDT', 1000, false],
    ]);
    const calls = run.mock.calls.length;
    reqs[0].resolve(DAILY);
    await flush();
    expect(run).toHaveBeenCalledTimes(calls);
    reqs[1].resolve(DAILY);
    await flush();
    expect(run).toHaveBeenCalledTimes(calls + 1);
    expect(ctxOf(run, calls).daily).toBe(DAILY);
  });

  it('1D: the chart bars are the daily data (no fetch); a bar of a new day reruns pivots', () => {
    const { chart } = fakeChart();
    const { run } = fakeRunner();
    const { fetch, reqs } = fakeDaily();
    const layer = new IndicatorLayer(chart, run, fetch);
    const bars = [...DAILY];
    layer.setSource('BINANCE:BTCUSDT', '1D', bars);
    layer.setInstances([pivot, inst('s', 'sma', { period: 20 })]);
    expect(ctxOf(run, 0)).toMatchObject({ interval: '1D', daily: bars });
    layer.update(bar(DAY0, 2, 4)); // same day
    expect(run).toHaveBeenCalledTimes(2);
    bars.push(bar(DAY0 + 86400, 4, 5));
    layer.update(bars[2]);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2][1]).toEqual(pivot.params);
    expect(reqs).toHaveLength(0);
  });

  it('a realtime bar of a new day refetches; a failed fetch logs once and leaves pivots empty', async () => {
    const { chart, panes } = fakeChart();
    const { run } = fakeRunner();
    const { fetch, reqs } = fakeDaily();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = new IndicatorLayer(chart, run, fetch);
    layer.setSource('BINANCE:BTCUSDT', '1m', [bar(DAY0 + 60, 1, 2)]);
    layer.setInstances([pivot]);
    reqs[0].resolve(DAILY);
    await flush();
    layer.update(bar(DAY0 + 120, 2, 3));
    expect(reqs).toHaveLength(1);
    layer.update(bar(DAY0 + 86400, 3, 4));
    expect(reqs).toHaveLength(2);
    reqs[1].reject(new Error('offline'));
    await flush();
    expect(ctxOf(run, run.mock.calls.length - 1).daily).toBeNull();
    layer.update(bar(DAY0 + 2 * 86400, 3, 4));
    reqs[2].reject(new Error('offline'));
    await flush();
    expect(err).toHaveBeenCalledTimes(1);
    expect(panes[0]).toHaveLength(9);
    err.mockRestore();
  });
});

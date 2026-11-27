import type { IChartApi, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../api/types';
import { sanitizeLayout } from '../persist/layout';
import { useIndicatorStore, type IndicatorInstance } from '../store/indicatorStore';
import { buildLegend, instanceLabel, withHiddenSources } from './indicatorData';
import { IndicatorLayer } from './indicatorSeries';
import { INDICATORS } from './indicators';
import { VolumeProfilePrimitive, type ProfileSpec } from './VolumeProfilePrimitive';

const candle = (i: number, low: number, high: number, volume: number): Candle => ({
  time: 1000 + i * 60,
  open: low,
  close: high,
  low,
  high,
  volume,
});

function setup(bars: Candle[], range: { from: number; to: number } | null) {
  const state = { bars, range };
  const onChange = vi.fn();
  const requestUpdate = vi.fn();
  const p = new VolumeProfilePrimitive(() => state.bars, onChange);
  const chart = { timeScale: () => ({ getVisibleLogicalRange: () => state.range }) };
  const series = { priceToCoordinate: (price: number) => 500 - price };
  p.attached({ chart, series, requestUpdate } as unknown as SeriesAttachedParameter<Time>);
  return { p, state, onChange, requestUpdate };
}

const spec = (patch: Partial<ProfileSpec> = {}): ProfileSpec => ({
  id: 'v',
  rows: 4,
  valueArea: 70,
  width: 30,
  up: '#2962ff',
  down: '#fbc02d',
  poc: '#f23645',
  ...patch,
});

const bars = Array.from({ length: 10 }, (_, i) => candle(i, i, i + 4, 10 + i));

describe('VolumeProfilePrimitive', () => {
  it('profiles the visible bars only, clamped to the data', () => {
    const { p } = setup(bars, { from: 6.4, to: 14 });
    p.setProfiles([spec()]);
    const [d] = p.debug();
    expect(d.bars).toEqual({
      from: 7,
      to: 9,
      firstTime: bars[7].time,
      lastTime: bars[9].time,
      volume: 17 + 18 + 19,
    });
    expect(d.rows).toHaveLength(4);
    expect(d.rows[0].low).toBe(7);
    expect(d.rows[3].high).toBe(13);
    const sum = d.rows.reduce((s, r) => s + r.up + r.down, 0);
    expect(sum).toBeCloseTo(54, 9);
  });

  it('no visible bars → no profile', () => {
    const { p } = setup(bars, { from: 20, to: 30 });
    p.setProfiles([spec()]);
    expect(p.debug()[0]).toMatchObject({ bars: null, rows: [], poc: null, pocPrice: null });
  });

  it('recomputes on range change, realtime last-bar change and params; notifies once per change', () => {
    const live = bars.map((b) => ({ ...b }));
    const { p, state, onChange, requestUpdate } = setup(live, { from: 0, to: 9 });
    p.setProfiles([spec()]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    p.updateAllViews();
    p.updateAllViews();
    expect(onChange).toHaveBeenCalledTimes(1);
    const before = p.debug()[0];

    state.range = { from: 2, to: 9 };
    p.updateAllViews();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(p.debug()[0].bars?.from).toBe(2);

    live[9] = { ...live[9], volume: 1000, high: 20 };
    p.updateAllViews();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(before.bars?.volume).toBe(145);
    expect(p.debug()[0].bars?.volume).toBe(12 + 13 + 14 + 15 + 16 + 17 + 18 + 1000);

    p.setProfiles([spec({ rows: 8 })]);
    p.updateAllViews();
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(p.debug()[0].rows).toHaveLength(8);

    p.setProfiles([spec({ rows: 8, width: 50, up: '#000000' })]);
    p.updateAllViews();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('POC price = middle of the POC row', () => {
    const { p } = setup(bars, { from: 0, to: 9 });
    p.setProfiles([spec()]);
    const d = p.debug()[0];
    const row = d.rows[d.poc!];
    expect(p.pocPrice('v')).toBe((row.low + row.high) / 2);
    expect(d.pocPrice).toBe(p.pocPrice('v'));
  });
});

describe('VRVP in the indicator framework', () => {
  const inst = (patch: Partial<IndicatorInstance> = {}): IndicatorInstance => ({
    id: 'ind-1',
    type: 'vrvp',
    params: { ...INDICATORS.vrvp.defaults },
    colors: { up: '#2962ff', down: '#fbc02d', poc: '#123456' },
    widths: {},
    visible: true,
    ...patch,
  });

  it('labels: full name in the list, VRVP + params in the legend', () => {
    expect(INDICATORS.vrvp.label).toBe('Volume Profile (visible range)');
    expect(instanceLabel(INDICATORS.vrvp, INDICATORS.vrvp.defaults)).toBe('VRVP 24 70 30');
  });

  it('layer: no series or pane; specs go to the profile view; legend shows the POC price', () => {
    const addSeries = vi.fn();
    const chart = { addSeries, removeSeries: vi.fn(), panes: () => [] } as unknown as IChartApi;
    const run = vi.fn();
    const layer = new IndicatorLayer(chart, run);
    const setProfiles = vi.fn();
    const view = { setProfiles, pocPrice: vi.fn(() => 123.5) };
    layer.setProfileView(view as unknown as VolumeProfilePrimitive);
    layer.setInstances([inst()]);
    layer.setSource('BINANCE:BTCUSDT', '1h', bars);
    expect(addSeries).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(setProfiles).toHaveBeenLastCalledWith([
      {
        id: 'ind-1',
        rows: 24,
        valueArea: 70,
        width: 30,
        up: '#2962ff',
        down: '#fbc02d',
        poc: '#123456',
      },
    ]);
    expect(layer.debug()).toEqual([
      { id: 'ind-1', type: 'vrvp', params: { rows: 24, valueArea: 70, width: 30 }, lines: {} },
    ]);
    layer.update({ ...bars[9], close: 99 });

    const legend = buildLegend({
      symbol: 'BINANCE:BTCUSDT',
      interval: '1h',
      bars,
      time: null,
      sources: layer.legendSources(),
    });
    expect(legend.rows[0]).toEqual({
      id: 'ind-1',
      label: 'VRVP 24 70 30',
      hidden: false,
      values: [{ line: 'poc', text: '123.50', color: '#123456' }],
    });

    layer.setInstances([inst({ visible: false })]);
    expect(setProfiles).toHaveBeenLastCalledWith([]);
    const hidden = withHiddenSources([inst({ visible: false })], [], INDICATORS, '1h');
    expect(hidden[0]).toMatchObject({ id: 'ind-1', hidden: true });
  });

  it('store adds it with colours and no widths; a saved layout restores it', () => {
    const id = useIndicatorStore.getState().add('vrvp');
    const added = useIndicatorStore.getState().instances.find((i) => i.id === id)!;
    expect(added.colors).toEqual({ up: '#2962ff', down: '#fbc02d', poc: '#f23645' });
    expect(added.widths).toEqual({});
    expect(useIndicatorStore.getState().updateParams(id, { rows: 50 })).toBe(true);
    expect(useIndicatorStore.getState().updateParams(id, { rows: 201 })).toBe(false);
    expect(useIndicatorStore.getState().updateParams(id, { valueArea: 72 })).toBe(false);
    const saved = JSON.parse(
      JSON.stringify({ indicators: useIndicatorStore.getState().instances }),
    ) as unknown;
    expect(sanitizeLayout(saved).indicators).toEqual([
      { ...added, params: { rows: 50, valueArea: 70, width: 30 } },
    ]);
    useIndicatorStore.getState().remove(id);
  });
});

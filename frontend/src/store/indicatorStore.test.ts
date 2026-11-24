import { beforeEach, describe, expect, it } from 'vitest';
import { INDICATORS, type Params } from '../chart/indicators';
import { isValidParam, useIndicatorStore } from './indicatorStore';

const store = () => useIndicatorStore.getState();

beforeEach(() => useIndicatorStore.setState({ instances: [], volumeVisible: true }));

describe('T3.6 indicator store', () => {
  it('adds an instance with the type defaults and line colours', () => {
    const id = store().add('macd');
    const [inst] = store().instances;
    expect(inst).toMatchObject({ id, type: 'macd', visible: true });
    expect(inst.params).toEqual(INDICATORS.macd.defaults);
    expect(inst.params).not.toBe(INDICATORS.macd.defaults);
    expect(inst.colors).toEqual({ hist: '#26a69a', macd: '#2962ff', signal: '#ff6d00' });
    expect(inst.widths).toEqual({ macd: 1, signal: 1 }); // the histogram has no width
  });

  it('sets a line width of 1–4 px; rejects other widths and histogram lines', () => {
    const id = store().add('macd');
    expect(store().setWidth(id, 'macd', 3)).toBe(true);
    const before = store().instances[0];
    for (const [line, w] of [
      ['macd', 0],
      ['macd', 5],
      ['macd', 2.5],
      ['macd', NaN],
      ['hist', 2],
      ['nope', 2],
    ] as const) {
      expect(store().setWidth(id, line, w)).toBe(false);
    }
    expect(store().setWidth('missing', 'macd', 2)).toBe(false);
    expect(store().instances[0]).toBe(before);
    expect(before.widths).toEqual({ macd: 3, signal: 1 });
  });

  it('allows several instances of one type with independent params', () => {
    const ids = [store().add('sma'), store().add('sma'), store().add('sma')];
    expect(new Set(ids).size).toBe(3);
    expect(store().updateParams(ids[1], { period: 50 })).toBe(true);
    expect(store().updateParams(ids[2], { period: 200 })).toBe(true);
    expect(store().instances.map((i) => i.params.period)).toEqual([20, 50, 200]);
  });

  it('removes only the given instance', () => {
    const a = store().add('rsi');
    const b = store().add('rsi');
    store().remove(a);
    expect(store().instances.map((i) => i.id)).toEqual([b]);
  });

  it('rejects invalid params and leaves the instance unchanged', () => {
    const id = store().add('bb');
    const before = store().instances[0];
    const bad: Params[] = [
      { period: 0 }, // below min
      { period: 501 }, // above max
      { period: 20.5 }, // off the step grid
      { period: NaN },
      { period: Infinity },
      { mult: 0 },
      { unknown: 3 },
    ];
    for (const patch of bad) {
      expect(store().updateParams(id, patch)).toBe(false);
    }
    expect(store().updateParams('missing', { period: 10 })).toBe(false);
    expect(store().instances[0]).toBe(before);
    expect(store().updateParams(id, { mult: 2.5 })).toBe(true);
    expect(store().instances[0].params).toEqual({ period: 20, mult: 2.5 });
  });

  it('updates colours and visibility, toggles volume', () => {
    const id = store().add('ema');
    store().setColor(id, 'value', '#ffffff');
    store().toggleVisible(id);
    expect(store().instances[0]).toMatchObject({ colors: { value: '#ffffff' }, visible: false });
    store().toggleVolume();
    expect(store().volumeVisible).toBe(false);
  });

  it('isValidParam respects min/max/step with float steps', () => {
    const f = { key: 'mult', label: 'StdDev', min: 0.1, max: 10, step: 0.1 };
    expect(isValidParam(f, 0.3)).toBe(true);
    expect(isValidParam(f, 2)).toBe(true);
    expect(isValidParam(f, 0.05)).toBe(false);
    expect(isValidParam(f, 2.25)).toBe(false);
  });
});

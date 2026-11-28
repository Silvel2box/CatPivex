import { describe, expect, it } from 'vitest';
import type { Candle } from '../api/types';
import { shiftLine, shiftUpdate, type ShiftedLine } from './indicatorData';
import { INDICATORS, runIndicator } from './indicators';
import type { BarValues, IndicatorCalc, LinePoint, Params } from './indicators/types';
import { applyRealtimeBar } from './series';

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: 100 + i * 10 }));
const pts = (idx: number[], b: { time: number }[]) =>
  idx.map((i) => ({ time: b[i].time, value: i }));

describe('shiftLine', () => {
  const b = bars(6);
  const line = pts([1, 2, 3, 4, 5], b);

  it('k > 0: drawn k bars later, the rest goes to the future (logical index)', () => {
    expect(shiftLine(line, b, 2)).toEqual({
      points: [
        { time: b[3].time, value: 1 },
        { time: b[4].time, value: 2 },
        { time: b[5].time, value: 3 },
      ],
      future: [
        { logical: 6, value: 4 },
        { logical: 7, value: 5 },
      ],
    });
  });

  it('k < 0: drawn earlier, points before bar 0 are dropped, no future', () => {
    expect(shiftLine(line, b, -2)).toEqual({
      points: [
        { time: b[0].time, value: 2 },
        { time: b[1].time, value: 3 },
        { time: b[2].time, value: 4 },
        { time: b[3].time, value: 5 },
      ],
      future: [],
    });
  });

  it('k = 0 keeps the line; holes stay holes; points off the bars are dropped', () => {
    const holey = [...pts([0, 2], b), { time: b[2].time + 1, value: 9 }, ...pts([5], b)];
    expect(shiftLine(holey, b, 0).points).toEqual(pts([0, 2, 5], b));
    expect(shiftLine(pts([0, 2, 5], b), b, 1)).toEqual({
      points: [
        { time: b[1].time, value: 0 },
        { time: b[3].time, value: 2 },
      ],
      future: [{ logical: 6, value: 5 }],
    });
  });

  it('empty bars / points', () => {
    expect(shiftLine([], b, 3)).toEqual({ points: [], future: [] });
    expect(shiftLine(line, [], 3)).toEqual({ points: [], future: [] });
  });
});

/** Lightweight Charts' update(): same time as the last point replaces it, newer appends. */
function fakeSeries() {
  const s = {
    data: [] as LinePoint[],
    sets: 0,
    update(p: LinePoint) {
      const last = s.data[s.data.length - 1];
      if (last && p.time < last.time) throw new Error('update older than the last point');
      if (last && last.time === p.time) s.data[s.data.length - 1] = p;
      else s.data.push(p);
    },
    setData(d: LinePoint[]) {
      s.data = [...d];
      s.sets++;
    },
  };
  return s;
}

const candle = (time: number, close: number, spread: number): Candle => ({
  time,
  open: close - spread / 3,
  high: close + spread,
  low: close - spread,
  close,
  volume: 1,
});

function randomBars(n: number, seed: number): Candle[] {
  let x = seed;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    price += (rnd() - 0.5) * 4;
    return candle(1000 + i * 60, price, 0.5 + rnd() * 2);
  });
}

/** Partial ticks of a bar, then the bar itself. */
const ticks = (b: Candle): Candle[] => [
  { ...b, close: b.open, high: b.open + 0.1, low: b.open - 0.1 },
  { ...b, high: b.high + 3, close: b.high + 2 },
  b,
];

/**
 * Runs `calc` on the first `start` bars, streams the rest tick by tick and after every tick
 * checks, per offset line, the incremental state and a fake series against a full shift.
 */
function streamCheck(
  calc: IndicatorCalc<Params, unknown>,
  params: Params,
  offsets: Record<string, number>,
  all: Candle[],
  start: number,
) {
  const ctx = { dayKey: () => 'd' };
  const live = all.slice(0, start);
  const run = runIndicator(calc, params, ctx, live);
  const state: Record<string, ShiftedLine> = {};
  const series: Record<string, ReturnType<typeof fakeSeries>> = {};
  for (const [k, off] of Object.entries(offsets)) {
    state[k] = shiftLine(run.lines[k] ?? [], live, off);
    series[k] = fakeSeries();
    series[k].setData(state[k].points);
  }
  let updates = 0;
  for (let i = start - 1; i < all.length; i++) {
    for (const t of ticks(all[i])) {
      applyRealtimeBar(live, t);
      run.update(t);
      for (const [k, off] of Object.entries(offsets)) {
        const op = shiftUpdate(state[k], run.lines[k] ?? [], live, off);
        if (op === 'update') {
          series[k].update(state[k].points[state[k].points.length - 1]);
          updates++;
        } else if (op === 'set') series[k].setData(state[k].points);
        const full = shiftLine(runIndicator(calc, params, ctx, live).lines[k] ?? [], live, off);
        expect(state[k]).toEqual(full);
        expect(series[k].data).toEqual(full.points);
      }
    }
  }
  return { series, updates };
}

describe('shiftUpdate: incremental = full shift', () => {
  const ichi = INDICATORS.ichimoku;
  const offsets = (p: Params) =>
    Object.fromEntries(ichi.lines.filter((l) => l.offset).map((l) => [l.key, l.offset!(p)]));

  it('Ichimoku defaults over 160 bars, from before the warm-up; ticks never call setData', () => {
    const p = ichi.defaults;
    expect(offsets(p)).toEqual({ lagging: -25, leadA: 25, leadB: 25 });
    const { series, updates } = streamCheck(ichi.calc, p, offsets(p), randomBars(160, 7), 10);
    for (const s of Object.values(series)) expect(s.sets).toBe(1);
    expect(updates).toBeGreaterThan(0);
  });

  it('small params, displacement 1 (no shift) and long displacement', () => {
    const bars = randomBars(60, 3);
    for (const displacement of [1, 2, 5, 40]) {
      const p = { conversion: 3, base: 5, spanB: 8, displacement };
      streamCheck(ichi.calc, p, offsets(p), bars, 1);
    }
  });

  it('a value that disappears on a tick of the last bar falls back to setData', () => {
    const flaky: IndicatorCalc<Params, null> = {
      init: () => null,
      next: (state, c) => {
        const out: BarValues = {};
        if (c.close !== c.open) out.v = c.close;
        return { state, out };
      },
    };
    const bars = randomBars(30, 11);
    for (const k of [-3, 0, 3]) {
      const { series } = streamCheck(flaky, {}, { v: k }, bars, 5);
      if (k <= 0) expect(series.v.sets).toBeGreaterThan(1);
    }
  });
});

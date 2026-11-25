import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import { candlesOf, contextOf, FIXTURES } from './fixtures/load';
import { INDICATORS, runIndicator } from './index';
import type { BarValues, CalcContext, IndicatorCalc, IndicatorRun, Params } from './types';

/** Realtime ticks of a bar: partial states (f = 0 → no volume, so VWAP loses its point), then the bar. */
const ticks = (b: Candle): Candle[] => [
  ...[0.3, 0, 1.7].map((f) => ({
    ...b,
    high: Math.max(b.high, b.open + (b.close - b.open) * f),
    low: Math.min(b.low, b.open + (b.close - b.open) * f),
    close: b.open + (b.close - b.open) * f,
    volume: b.volume * f,
  })),
  b,
];

/** Lines without empty arrays: a run keeps a line's (now empty) array after its last point is
 * removed by an update, while a fresh run never creates it. Both mean "no points". */
const nonEmpty = (lines: IndicatorRun['lines']) =>
  Object.fromEntries(Object.entries(lines).filter(([, l]) => l.length > 0));

/**
 * Streams `bars[from..]` into `run` tick by tick (`bars[from - 1]` is re-ticked first when it is
 * already in the run). After every tick, lines and the returned values must equal a fresh full run.
 */
function stream(
  run: IndicatorRun,
  calc: IndicatorCalc<Params, unknown>,
  params: Params,
  ctx: CalcContext,
  bars: Candle[],
  from: number,
) {
  for (let i = Math.max(from - 1, 0); i < bars.length; i++) {
    for (const t of ticks(bars[i])) {
      const got = run.update(t);
      const fresh = runIndicator(calc, params, ctx, [...bars.slice(0, i), t]).lines;
      const values: BarValues = {};
      for (const [k, line] of Object.entries(fresh)) {
        const p = line[line.length - 1];
        if (p?.time === t.time) values[k] = p.value;
      }
      expect(got).toEqual({ time: t.time, values: Object.keys(values).length ? values : null });
      expect(nonEmpty(run.lines)).toEqual(fresh);
    }
  }
}

describe('T3.2 incremental update == full recompute', () => {
  for (const f of FIXTURES) {
    const bars = candlesOf(f);
    const ctx = contextOf(f);
    for (const c of f.cases) {
      const calc = INDICATORS[c.type].calc;
      const name = `${f.name} ${c.type} ${JSON.stringify(c.params)}`;

      it(`${name}: N-6 bars, re-tick the last, stream 5 more; older bar → null`, () => {
        const start = bars.length - 6;
        const run = runIndicator(calc, c.params, ctx, bars.slice(0, start));
        stream(run, calc, c.params, ctx, bars, start);
        const full = runIndicator(calc, c.params, ctx, bars).lines;
        expect(nonEmpty(run.lines)).toEqual(full);
        expect(run.update(bars[10])).toBeNull();
        expect(nonEmpty(run.lines)).toEqual(full);
      });

      it(`${name}: from empty, 80 bars tick by tick`, () => {
        // aapl_5m: the first 80 bars include pre-market (zero volume) and the first volume bar.
        const some = bars.slice(0, 80);
        const run = runIndicator(calc, c.params, ctx, []);
        stream(run, calc, c.params, ctx, some, 0);
        expect(nonEmpty(run.lines)).toEqual(runIndicator(calc, c.params, ctx, some).lines);
      });
    }
  }
});

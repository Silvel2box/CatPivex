import type { Candle } from '../../api/types';
import type { BarValues, CalcContext, IndicatorCalc, IndicatorRun, Params } from './types';

/** Keeps finite values only, so lines never carry NaN/Infinity (null if nothing is left). */
function finite(out: BarValues | null): BarValues | null {
  if (!out) return null;
  const clean: BarValues = {};
  let any = false;
  for (const [k, v] of Object.entries(out)) {
    if (Number.isFinite(v)) {
      clean[k] = v;
      any = true;
    }
  }
  return any ? clean : null;
}

/**
 * Folds `calc.next` over `bars`. Keeps the state before and after the last bar, so `update` can
 * recompute the last bar (same time) or append a newer one with a single `next` call.
 */
export function runIndicator(
  calc: IndicatorCalc<Params, unknown>,
  params: Params,
  ctx: CalcContext,
  bars: Candle[],
): IndicatorRun {
  const lines: IndicatorRun['lines'] = {};
  let before = calc.init(params, ctx); // state before the last bar
  let after = before; // state after the last bar
  let lastTime: number | null = null;

  const append = (time: number, values: BarValues | null) => {
    if (!values) return;
    for (const [k, value] of Object.entries(values)) (lines[k] ??= []).push({ time, value });
  };

  const step = (bar: Candle): BarValues | null => {
    before = after;
    const r = calc.next(before, bar);
    after = r.state;
    lastTime = bar.time;
    return finite(r.out);
  };

  for (const bar of bars) append(bar.time, step(bar));

  return {
    lines,
    update(bar) {
      if (lastTime !== null && bar.time < lastTime) return null;
      let values: BarValues | null;
      if (lastTime === null || bar.time > lastTime) {
        values = step(bar);
      } else {
        // Same time: recompute the last bar from the state before it and replace its points.
        const r = calc.next(before, bar);
        after = r.state;
        values = finite(r.out);
        for (const line of Object.values(lines)) {
          if (line[line.length - 1]?.time === bar.time) line.pop();
        }
      }
      append(bar.time, values);
      return { time: bar.time, values };
    },
  };
}

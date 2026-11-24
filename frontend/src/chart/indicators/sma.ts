import type { IndicatorCalc } from './types';

export type SmaParams = { period: number };

export interface SmaState {
  readonly period: number;
  /** Last `period` closes (fewer while warming up). */
  readonly buf: readonly number[];
}

/** Appends `x` to a rolling window of `size` values without mutating `buf`. */
export function pushWindow(buf: readonly number[], x: number, size: number): number[] {
  const out = buf.length >= size ? buf.slice(buf.length - size + 1) : buf.slice();
  out.push(x);
  return out;
}

export function mean(xs: readonly number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export const smaCalc: IndicatorCalc<SmaParams, SmaState> = {
  init: ({ period }) => ({ period, buf: [] }),
  next(state, candle) {
    const buf = pushWindow(state.buf, candle.close, state.period);
    const out = buf.length === state.period ? { value: mean(buf) } : null;
    return { state: { period: state.period, buf }, out };
  },
};

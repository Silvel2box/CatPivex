import type { IndicatorCalc } from './types';

export type EmaParams = { period: number };

export interface EmaState {
  readonly period: number;
  /** Inputs seen while seeding (stops at `period`). */
  readonly count: number;
  /** Sum of the first `period` inputs (SMA seed). */
  readonly seedSum: number;
  /** Last EMA value, null before the seed bar. */
  readonly ema: number | null;
}

export const emaInit = (period: number): EmaState => ({ period, count: 0, seedSum: 0, ema: null });

/** One EMA step (FORMULAS.md): SMA seed at the `period`-th input, then α·x + (1-α)·ema. */
export function emaStep(s: EmaState, x: number): EmaState {
  if (s.ema !== null) {
    const alpha = 2 / (s.period + 1);
    return { ...s, ema: alpha * x + (1 - alpha) * s.ema };
  }
  const count = s.count + 1;
  const seedSum = s.seedSum + x;
  return { ...s, count, seedSum, ema: count === s.period ? seedSum / s.period : null };
}

export const emaCalc: IndicatorCalc<EmaParams, EmaState> = {
  init: ({ period }) => emaInit(period),
  next(state, candle) {
    const s = emaStep(state, candle.close);
    return { state: s, out: s.ema === null ? null : { value: s.ema } };
  },
};

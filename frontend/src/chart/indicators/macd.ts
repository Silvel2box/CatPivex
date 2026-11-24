import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type MacdParams = { fast: number; slow: number; signal: number };

export const macdCalc: IndicatorCalc<MacdParams, unknown> = {
  init() {
    throw new Error('macd: not implemented');
  },
  next() {
    throw new Error('macd: not implemented');
  },
};

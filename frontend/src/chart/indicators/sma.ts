import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type SmaParams = { period: number };

export const smaCalc: IndicatorCalc<SmaParams, unknown> = {
  init() {
    throw new Error('sma: not implemented');
  },
  next() {
    throw new Error('sma: not implemented');
  },
};

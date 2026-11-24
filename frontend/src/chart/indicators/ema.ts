import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type EmaParams = { period: number };

export const emaCalc: IndicatorCalc<EmaParams, unknown> = {
  init() {
    throw new Error('ema: not implemented');
  },
  next() {
    throw new Error('ema: not implemented');
  },
};

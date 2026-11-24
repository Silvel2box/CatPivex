import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type RsiParams = { period: number };

export const rsiCalc: IndicatorCalc<RsiParams, unknown> = {
  init() {
    throw new Error('rsi: not implemented');
  },
  next() {
    throw new Error('rsi: not implemented');
  },
};

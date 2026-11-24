import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type BbParams = { period: number; mult: number };

export const bbCalc: IndicatorCalc<BbParams, unknown> = {
  init() {
    throw new Error('bb: not implemented');
  },
  next() {
    throw new Error('bb: not implemented');
  },
};

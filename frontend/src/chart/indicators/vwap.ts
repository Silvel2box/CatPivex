import type { IndicatorCalc } from './types';

// STUB (P3.0) — implement per FORMULAS.md. Keep `type` (not interface) so it fits Params.
export type VwapParams = Record<string, never>;

export const vwapCalc: IndicatorCalc<VwapParams, unknown> = {
  init() {
    throw new Error('vwap: not implemented');
  },
  next() {
    throw new Error('vwap: not implemented');
  },
};

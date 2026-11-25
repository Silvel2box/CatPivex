import type { Candle } from '../../api/types';
import type { IndicatorCalc } from './types';

export type AtrParams = { period: number };

export interface AtrState {
  readonly period: number;
  readonly prevClose: number | null;
  /** True ranges seen while seeding (stops at `period`; bar 0 is not counted). */
  readonly count: number;
  readonly seedSum: number;
  readonly atr: number | null;
}

export const atrInit = (period: number): AtrState => ({
  period,
  prevClose: null,
  count: 0,
  seedSum: 0,
  atr: null,
});

export function atrStep(s: AtrState, c: Candle): AtrState {
  if (s.prevClose === null) return { ...s, prevClose: c.close };
  const tr = Math.max(
    c.high - c.low,
    Math.abs(c.high - s.prevClose),
    Math.abs(c.low - s.prevClose),
  );
  if (s.atr !== null) {
    return { ...s, prevClose: c.close, atr: (s.atr * (s.period - 1) + tr) / s.period };
  }
  const count = s.count + 1;
  const seedSum = s.seedSum + tr;
  const atr = count === s.period ? seedSum / s.period : null;
  return { ...s, prevClose: c.close, count, seedSum, atr };
}

export const atrCalc: IndicatorCalc<AtrParams, AtrState> = {
  init: ({ period }) => atrInit(period),
  next(state, candle) {
    const s = atrStep(state, candle);
    return { state: s, out: s.atr === null ? null : { value: s.atr } };
  },
};

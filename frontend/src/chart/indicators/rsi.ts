import type { IndicatorCalc } from './types';

export type RsiParams = { period: number };

export interface RsiState {
  readonly period: number;
  readonly prevClose: number | null;
  /** Changes seen while seeding (stops at `period`). */
  readonly count: number;
  /** Sums of gains/losses while seeding, then Wilder averages. */
  readonly gain: number;
  readonly loss: number;
}

/** Pine ta.rsi edge rule: avgLoss = 0 → 100 (also when both are 0); avgGain = 0 → 0. */
function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export const rsiCalc: IndicatorCalc<RsiParams, RsiState> = {
  init: ({ period }) => ({ period, prevClose: null, count: 0, gain: 0, loss: 0 }),
  next(state, candle) {
    const { period, prevClose } = state;
    if (prevClose === null) return { state: { ...state, prevClose: candle.close }, out: null };
    const change = candle.close - prevClose;
    const g = Math.max(change, 0);
    const l = Math.max(-change, 0);
    let { count, gain, loss } = state;
    if (count < period) {
      count += 1;
      gain += g;
      loss += l;
      if (count === period) {
        gain /= period; // seed: simple mean of the first `period` changes
        loss /= period;
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    const s = { period, prevClose: candle.close, count, gain, loss };
    return { state: s, out: count === period ? { value: rsiValue(gain, loss) } : null };
  },
};

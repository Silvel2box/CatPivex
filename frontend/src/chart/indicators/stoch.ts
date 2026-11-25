import { mean, pushWindow } from './sma';
import type { BarValues, IndicatorCalc } from './types';

export type StochParams = { kLength: number; kSmooth: number; dSmooth: number };

export interface KdState {
  readonly kSmooth: number;
  readonly dSmooth: number;
  readonly raws: readonly number[];
  readonly ks: readonly number[];
}

export interface StochState {
  readonly kLength: number;
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly kd: KdState;
}

export function stochRaw(x: number, lo: number, hi: number): number {
  return hi === lo ? 0 : (100 * (x - lo)) / (hi - lo);
}

export const kdInit = (kSmooth: number, dSmooth: number): KdState => ({
  kSmooth,
  dSmooth,
  raws: [],
  ks: [],
});

export function kdStep(state: KdState, raw: number): { kd: KdState; out: BarValues | null } {
  const raws = pushWindow(state.raws, raw, state.kSmooth);
  if (raws.length < state.kSmooth) return { kd: { ...state, raws }, out: null };
  const k = mean(raws);
  const ks = pushWindow(state.ks, k, state.dSmooth);
  return {
    kd: { ...state, raws, ks },
    out: ks.length === state.dSmooth ? { k, d: mean(ks) } : { k },
  };
}

export const stochCalc: IndicatorCalc<StochParams, StochState> = {
  init: ({ kLength, kSmooth, dSmooth }) => ({
    kLength,
    highs: [],
    lows: [],
    kd: kdInit(kSmooth, dSmooth),
  }),
  next(state, candle) {
    const highs = pushWindow(state.highs, candle.high, state.kLength);
    const lows = pushWindow(state.lows, candle.low, state.kLength);
    if (highs.length < state.kLength) return { state: { ...state, highs, lows }, out: null };
    const raw = stochRaw(candle.close, Math.min(...lows), Math.max(...highs));
    const { kd, out } = kdStep(state.kd, raw);
    return { state: { kLength: state.kLength, highs, lows, kd }, out };
  },
};

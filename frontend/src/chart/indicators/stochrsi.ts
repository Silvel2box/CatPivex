import { rsiCalc, type RsiState } from './rsi';
import { pushWindow } from './sma';
import { kdInit, kdStep, stochRaw, type KdState } from './stoch';
import type { IndicatorCalc } from './types';

export type StochRsiParams = {
  rsiLength: number;
  stochLength: number;
  kSmooth: number;
  dSmooth: number;
};

export interface StochRsiState {
  readonly stochLength: number;
  readonly rsi: RsiState;
  readonly rsis: readonly number[];
  readonly kd: KdState;
}

export const stochrsiCalc: IndicatorCalc<StochRsiParams, StochRsiState> = {
  init: ({ rsiLength, stochLength, kSmooth, dSmooth }, ctx) => ({
    stochLength,
    rsi: rsiCalc.init({ period: rsiLength }, ctx),
    rsis: [],
    kd: kdInit(kSmooth, dSmooth),
  }),
  next(state, candle) {
    const r = rsiCalc.next(state.rsi, candle);
    const value = r.out?.value;
    if (value === undefined) return { state: { ...state, rsi: r.state }, out: null };
    const rsis = pushWindow(state.rsis, value, state.stochLength);
    const next = { ...state, rsi: r.state, rsis };
    if (rsis.length < state.stochLength) return { state: next, out: null };
    const { kd, out } = kdStep(state.kd, stochRaw(value, Math.min(...rsis), Math.max(...rsis)));
    return { state: { ...next, kd }, out };
  },
};

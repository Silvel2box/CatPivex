import { atrInit, atrStep, type AtrState } from './atr';
import type { BarValues, IndicatorCalc } from './types';

export type SupertrendParams = { atrPeriod: number; factor: number };

export interface SupertrendState {
  readonly factor: number;
  readonly atr: AtrState;
  readonly prevClose: number | null;
  /** Final bands and supertrend of the previous bar (0 / null before the first defined bar). */
  readonly prevUpper: number;
  readonly prevLower: number;
  readonly prevSt: number | null;
}

export const supertrendCalc: IndicatorCalc<SupertrendParams, SupertrendState> = {
  init: ({ atrPeriod, factor }) => ({
    factor,
    atr: atrInit(atrPeriod),
    prevClose: null,
    prevUpper: 0,
    prevLower: 0,
    prevSt: null,
  }),
  next(state, candle) {
    const atr = atrStep(state.atr, candle);
    const { factor, prevClose, prevUpper, prevLower, prevSt } = state;
    if (atr.atr === null || prevClose === null) {
      return { state: { ...state, atr, prevClose: candle.close }, out: null };
    }
    const src = (candle.high + candle.low) / 2;
    let upper = src + factor * atr.atr;
    let lower = src - factor * atr.atr;
    lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    let dir: 1 | -1;
    if (prevSt === null) dir = 1;
    else if (prevSt === prevUpper) dir = candle.close > upper ? -1 : 1;
    else dir = candle.close < lower ? 1 : -1;
    const st = dir === -1 ? lower : upper;
    const out: BarValues = dir === -1 ? { up: st } : { down: st };
    return {
      state: {
        factor,
        atr,
        prevClose: candle.close,
        prevUpper: upper,
        prevLower: lower,
        prevSt: st,
      },
      out,
    };
  },
};

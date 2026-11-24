import { emaInit, emaStep, type EmaState } from './ema';
import type { BarValues, IndicatorCalc } from './types';

export type MacdParams = { fast: number; slow: number; signal: number };

export interface MacdState {
  readonly fast: EmaState;
  readonly slow: EmaState;
  /** EMA of the macd values, fed only once macd is defined. */
  readonly signal: EmaState;
}

export const macdCalc: IndicatorCalc<MacdParams, MacdState> = {
  init: ({ fast, slow, signal }) => ({
    fast: emaInit(fast),
    slow: emaInit(slow),
    signal: emaInit(signal),
  }),
  next(state, candle) {
    const fast = emaStep(state.fast, candle.close);
    const slow = emaStep(state.slow, candle.close);
    if (fast.ema === null || slow.ema === null) {
      return { state: { fast, slow, signal: state.signal }, out: null };
    }
    const macd = fast.ema - slow.ema;
    const signal = emaStep(state.signal, macd);
    const out: BarValues =
      signal.ema === null ? { macd } : { macd, signal: signal.ema, hist: macd - signal.ema };
    return { state: { fast, slow, signal }, out };
  },
};

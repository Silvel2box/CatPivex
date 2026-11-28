import { pushWindow } from './sma';
import type { BarValues, IndicatorCalc } from './types';

export type IchimokuParams = {
  conversion: number;
  base: number;
  spanB: number;
  displacement: number;
};

export interface IchimokuState {
  readonly params: IchimokuParams;
  readonly highs: readonly number[];
  readonly lows: readonly number[];
}

function midpoint(highs: readonly number[], lows: readonly number[], n: number): number | null {
  if (highs.length < n) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = highs.length - n; i < highs.length; i++) {
    if (highs[i] > hi) hi = highs[i];
    if (lows[i] < lo) lo = lows[i];
  }
  return (hi + lo) / 2;
}

export const ichimokuCalc: IndicatorCalc<IchimokuParams, IchimokuState> = {
  init: (params) => ({ params, highs: [], lows: [] }),
  next(state, candle) {
    const { conversion, base, spanB } = state.params;
    const keep = Math.max(conversion, base, spanB);
    const highs = pushWindow(state.highs, candle.high, keep);
    const lows = pushWindow(state.lows, candle.low, keep);
    const out: BarValues = { lagging: candle.close };
    const tenkan = midpoint(highs, lows, conversion);
    const kijun = midpoint(highs, lows, base);
    const leadB = midpoint(highs, lows, spanB);
    if (tenkan !== null) out.tenkan = tenkan;
    if (kijun !== null) out.kijun = kijun;
    if (tenkan !== null && kijun !== null) out.leadA = (tenkan + kijun) / 2;
    if (leadB !== null) out.leadB = leadB;
    return { state: { params: state.params, highs, lows }, out };
  },
};

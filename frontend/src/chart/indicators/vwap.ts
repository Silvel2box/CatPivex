import type { CalcContext, IndicatorCalc } from './types';

export type VwapParams = Record<string, never>;

export interface VwapState {
  readonly ctx: CalcContext;
  /** Session-day key of the last bar; the sums reset when it changes. */
  readonly day: string | null;
  readonly pv: number;
  readonly vol: number;
}

export const vwapCalc: IndicatorCalc<VwapParams, VwapState> = {
  init: (_params, ctx) => ({ ctx, day: null, pv: 0, vol: 0 }),
  next(state, candle) {
    const day = state.ctx.dayKey(candle.time);
    const same = day === state.day;
    const tp = (candle.high + candle.low + candle.close) / 3;
    const pv = (same ? state.pv : 0) + tp * candle.volume;
    const vol = (same ? state.vol : 0) + candle.volume;
    return { state: { ctx: state.ctx, day, pv, vol }, out: vol > 0 ? { value: pv / vol } : null };
  },
};

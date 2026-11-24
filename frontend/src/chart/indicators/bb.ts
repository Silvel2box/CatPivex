import { mean, pushWindow } from './sma';
import type { IndicatorCalc } from './types';

export type BbParams = { period: number; mult: number };

export interface BbState {
  readonly period: number;
  readonly mult: number;
  readonly buf: readonly number[];
}

export const bbCalc: IndicatorCalc<BbParams, BbState> = {
  init: ({ period, mult }) => ({ period, mult, buf: [] }),
  next(state, candle) {
    const buf = pushWindow(state.buf, candle.close, state.period);
    const next = { ...state, buf };
    if (buf.length !== state.period) return { state: next, out: null };
    const middle = mean(buf);
    let ss = 0;
    for (const x of buf) ss += (x - middle) ** 2;
    const dev = state.mult * Math.sqrt(ss / state.period); // population std-dev
    return { state: next, out: { upper: middle + dev, middle, lower: middle - dev } };
  },
};

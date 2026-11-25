import type { IndicatorCalc, Params } from './types';

export const stochCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

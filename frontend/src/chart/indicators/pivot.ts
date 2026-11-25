import type { IndicatorCalc, Params } from './types';

export const pivotCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

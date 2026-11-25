import type { IndicatorCalc, Params } from './types';

export const supertrendCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

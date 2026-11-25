import type { IndicatorCalc, Params } from './types';

export const atrCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

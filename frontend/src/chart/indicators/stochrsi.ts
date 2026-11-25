import type { IndicatorCalc, Params } from './types';

export const stochrsiCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

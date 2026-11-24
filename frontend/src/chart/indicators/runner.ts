import type { Candle } from '../../api/types';
import type { CalcContext, IndicatorCalc, IndicatorRun, Params } from './types';

// STUB (P3.0) — implement: fold calc.next over bars; keep the state before the last bar so
// update() can replace the last bar or append a new one without recomputing everything.
export function runIndicator(
  calc: IndicatorCalc<Params, unknown>,
  params: Params,
  ctx: CalcContext,
  bars: Candle[],
): IndicatorRun {
  void calc;
  void params;
  void ctx;
  void bars;
  throw new Error('runIndicator: not implemented');
}

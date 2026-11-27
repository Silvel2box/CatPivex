import type { Candle, Interval } from '../../api/types';

// Formulas are specified in FORMULAS.md — implementations must match it exactly.

export type IndicatorType =
  | 'sma'
  | 'ema'
  | 'bb'
  | 'vwap'
  | 'rsi'
  | 'macd'
  | 'stoch'
  | 'stochrsi'
  | 'atr'
  | 'supertrend'
  | 'pivot'
  | 'vrvp';

/** Values of one bar, keyed by line name. A missing key = that line is undefined at this bar. */
export type BarValues = Record<string, number>;

export interface CalcContext {
  /** Session-day key for a candle time (VWAP reset). See dayKeyFor() in index.ts. */
  dayKey(time: number): string;
  interval?: Interval;
  daily?: Candle[] | null;
}

/**
 * A streaming calculator: pure, immutable state. `next` must not mutate `state`.
 * `out` is null while nothing is defined yet.
 */
export interface IndicatorCalc<P, S> {
  init(params: P, ctx: CalcContext): S;
  next(state: S, candle: Candle): { state: S; out: BarValues | null };
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface IndicatorRun {
  /** One array per line; bars where the line is undefined have no point. */
  lines: Record<string, LinePoint[]>;
  /**
   * Realtime bar: same time as the last bar → replaces it, newer → appended, older → ignored
   * (returns null). Updates `lines` in place and returns that bar's values.
   */
  update(bar: Candle): { time: number; values: BarValues | null } | null;
}

/** Indicator parameters, e.g. { period: 20 }. */
export type Params = Record<string, number>;

export interface ParamField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  options?: { value: number; label: string }[];
}

export interface LineDef {
  key: string;
  label: string;
  color: string;
  kind: 'line' | 'histogram' | 'profile';
  gaps?: boolean;
  steps?: boolean;
}

export interface IndicatorDef {
  type: IndicatorType;
  label: string;
  shortLabel?: string;
  pane: 'main' | 'sub';
  defaults: Params;
  params: ParamField[];
  lines: LineDef[];
  /** Horizontal guide lines in the indicator's pane (RSI 30/70, MACD 0). */
  levels?: number[];
  /** Hidden on 1D/1W (VWAP). */
  intradayOnly?: boolean;
  needsDaily?: boolean;
  rangeOverlay?: boolean;
  // Method syntax in IndicatorCalc makes a calc with specific params/state assignable here.
  calc: IndicatorCalc<Params, unknown>;
}

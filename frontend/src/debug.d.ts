import type { Candle, Interval } from './api/types';

export interface CatpivexDebugState {
  symbol: string;
  interval: Interval;
  /** Bars currently in the candle series data. */
  barCount: number;
  /** Time of the oldest bar (unix seconds UTC), null when empty. */
  firstTime: number | null;
  /** Latest candle, including realtime updates. */
  lastBar: Candle | null;
  /** True while an initial or history request is in flight. */
  loading: boolean;
  wsConnected: boolean;
  /** Current CandlesResponse came from a non-realtime source. */
  delayed: boolean;
  /** Latest source warning from the API (shown even if the user dismissed the note). */
  warning: string | null;
}

export interface CatpivexDebugIndicator {
  id: string;
  type: string;
  params: Record<string, number>;
  /**
   * Per line: points in the current run (0 when the calc failed), the last one, and the
   * lineWidth read back from the chart series (undefined for histograms).
   */
  lines: Record<
    string,
    { count: number; last: { time: number; value: number } | null; width?: number }
  >;
}

export interface CatpivexDebug {
  state(): CatpivexDebugState;
  /** Rendered indicator instances (visible, not hidden by intradayOnly), in store order. */
  indicators(): CatpivexDebugIndicator[];
  /** x of a bar time relative to the chart container, null when off-screen / unknown. */
  xForTime(time: number): number | null;
  /** Chart panes: 1 (candles + main-pane indicators) + one per sub-pane indicator. */
  paneCount(): number;
}

declare global {
  interface Window {
    /** E2E debug hook, only defined in dev builds. */
    __catpivex?: CatpivexDebug;
  }
}

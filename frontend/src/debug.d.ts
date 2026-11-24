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

declare global {
  interface Window {
    /** E2E debug hook, only defined in dev builds. */
    __catpivex?: { state(): CatpivexDebugState };
  }
}

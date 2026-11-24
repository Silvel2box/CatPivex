import type { Interval } from '../api/types';
import type { IndicatorInstance } from '../store/indicatorStore';

/** What /api/layout stores (the backend keeps it as opaque JSON). */
export interface Layout {
  version: 1;
  symbol: string;
  interval: Interval;
  /** In panel order; ids are kept so the store's next id must go past them. */
  indicators: IndicatorInstance[];
  volumeVisible: boolean;
  magnet: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  version: 1,
  symbol: 'BINANCE:BTCUSDT',
  interval: '1m',
  indicators: [],
  volumeVisible: true,
  magnet: true,
};

/**
 * Always returns a usable layout from untrusted JSON (null, {}, other versions, hand-edited):
 * each top-level field that is missing or invalid falls back to DEFAULT_LAYOUT's; an indicator
 * is dropped if its type is unknown or its params are invalid (validParams), duplicate ids are
 * dropped, colours must be #rrggbb (else the def colour), widths must be in LINE_WIDTHS and only
 * for 'line' kind (else dropped -> default), missing params are NOT filled in (invalid -> drop).
 * Symbol must match /^[A-Z]+:[A-Z0-9.=^-]+$/.
 */
export function sanitizeLayout(raw: unknown): Layout {
  void raw;
  throw new Error('not implemented');
}

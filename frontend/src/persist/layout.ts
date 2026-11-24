import { INTERVALS, type Interval } from '../api/types';
import { INDICATORS, type IndicatorType, type Params } from '../chart/indicators';
import {
  DEFAULT_LINE_WIDTH,
  LINE_WIDTHS,
  validParams,
  type IndicatorInstance,
} from '../store/indicatorStore';

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

const SYMBOL_RE = /^[A-Z]+:[A-Z0-9.=^-]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One indicator, or null to drop it. Output holds only the def's keys (extra keys stripped). */
function indicatorOf(v: unknown): IndicatorInstance | null {
  if (!isRecord(v)) return null;
  const { id, type } = v;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof type !== 'string' || !Object.hasOwn(INDICATORS, type)) return null;
  const def = INDICATORS[type as IndicatorType];
  if (!isRecord(v.params)) return null;
  const params: Params = {};
  for (const f of def.params) {
    if (Object.hasOwn(v.params, f.key)) params[f.key] = v.params[f.key] as number;
  }
  if (!validParams(def, params)) return null; // non-numbers fail Number.isFinite in there
  const rawColors = isRecord(v.colors) ? v.colors : {};
  const rawWidths = isRecord(v.widths) ? v.widths : {};
  const colors: Record<string, string> = {};
  const widths: Record<string, number> = {};
  for (const line of def.lines) {
    const c = rawColors[line.key];
    colors[line.key] = typeof c === 'string' && HEX_COLOR.test(c) ? c : line.color;
    if (line.kind !== 'line') continue;
    const w = rawWidths[line.key];
    widths[line.key] =
      typeof w === 'number' && (LINE_WIDTHS as readonly number[]).includes(w)
        ? w
        : DEFAULT_LINE_WIDTH;
  }
  const visible = typeof v.visible === 'boolean' ? v.visible : true;
  return { id, type: def.type, params, colors, widths, visible };
}

/**
 * Always returns a usable layout from untrusted JSON (null, {}, other versions, hand-edited):
 * each top-level field that is missing or invalid falls back to DEFAULT_LAYOUT's; an indicator
 * is dropped if its type is unknown or its params are invalid (validParams), duplicate ids are
 * dropped, colours must be #rrggbb (else the def colour), widths must be in LINE_WIDTHS and only
 * for 'line' kind (else dropped -> default), missing params are NOT filled in (invalid -> drop).
 * Symbol must match /^[A-Z]+:[A-Z0-9.=^-]+$/.
 */
export function sanitizeLayout(raw: unknown): Layout {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_LAYOUT;
  const indicators: IndicatorInstance[] = [];
  if (Array.isArray(r.indicators)) {
    const seen = new Set<string>();
    for (const item of r.indicators) {
      const inst = indicatorOf(item);
      if (!inst || seen.has(inst.id)) continue;
      seen.add(inst.id);
      indicators.push(inst);
    }
  }
  return {
    version: 1,
    symbol: typeof r.symbol === 'string' && SYMBOL_RE.test(r.symbol) ? r.symbol : d.symbol,
    interval: (INTERVALS as readonly unknown[]).includes(r.interval)
      ? (r.interval as Interval)
      : d.interval,
    indicators,
    volumeVisible: typeof r.volumeVisible === 'boolean' ? r.volumeVisible : d.volumeVisible,
    magnet: typeof r.magnet === 'boolean' ? r.magnet : d.magnet,
  };
}

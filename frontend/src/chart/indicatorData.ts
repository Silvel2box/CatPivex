// Pure helpers between indicator runs and the chart / legend (no chart instance needed).
import type { Candle, Interval } from '../api/types';
import type { IndicatorInstance } from '../store/indicatorStore';
import type { IndicatorDef, LineDef, LinePoint, Params } from './indicators/types';

export const HIST_DOWN = '#ef5350';
const UP = '#26a69a';
const DOWN = '#ef5350';
const NONE = '—';

export const isDaily = (interval: Interval) => interval === '1D' || interval === '1W';

/** Instances that get series: visible, and not intraday-only on 1D/1W. Keeps store order. */
export function activeInstances(
  instances: IndicatorInstance[],
  defs: Record<string, IndicatorDef>,
  interval: Interval,
): IndicatorInstance[] {
  return instances.filter((i) => i.visible && !(defs[i.type].intradayOnly && isDaily(interval)));
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** MACD-style histogram: the line colour at/above zero, red below. */
export function histColor(value: number, upColor: string): string {
  return value >= 0 ? upColor : HIST_DOWN;
}

export interface SeriesPoint {
  time: number;
  value: number;
  color?: string;
}

export function toSeriesPoint(kind: LineDef['kind'], p: LinePoint, color: string): SeriesPoint {
  return kind === 'histogram'
    ? { time: p.time, value: p.value, color: histColor(p.value, color) }
    : { time: p.time, value: p.value };
}

export function toSeriesData(kind: LineDef['kind'], points: LinePoint[], color: string) {
  return points.map((p) => toSeriesPoint(kind, p, color));
}

export type SeriesItem = SeriesPoint | { time: number };

export const GAP_COLOR = 'transparent';

/**
 * `gaps` lines: whitespace on every bar time from the first point on where there is no point.
 * Lightweight Charts still joins a line across whitespace and colours a segment by its starting
 * point, so on a line the point before a gap gets GAP_COLOR.
 */
export function withGaps(
  kind: LineDef['kind'],
  points: SeriesPoint[],
  times: number[],
  steps = false,
) {
  const out: SeriesItem[] = [];
  if (points.length === 0) return out;
  const breakPrev = () => {
    const prev = out[out.length - 1];
    if (kind === 'line' && prev && 'value' in prev)
      out[out.length - 1] = { ...prev, color: GAP_COLOR };
  };
  const push = (p: SeriesPoint) => {
    const prev = out[out.length - 1];
    if (steps && prev && 'value' in prev && prev.value !== p.value) breakPrev();
    out.push(p);
  };
  let j = 0;
  for (const t of times) {
    while (j < points.length && points[j].time < t) push(points[j++]);
    if (points[j]?.time === t) {
      push(points[j++]);
    } else if (t > points[0].time) {
      breakPrev();
      out.push({ time: t });
    }
  }
  while (j < points.length) push(points[j++]);
  return out;
}

/** Index of the point at `time` in an ascending array, or -1. */
export function indexAt<T extends { time: number }>(points: T[], time: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = points[mid].time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** First index whose time is ≥ `time` (points.length if none). */
export function lowerBound<T extends { time: number }>(points: T[], time: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface FuturePoint {
  logical: number;
  value: number;
}

/** A line drawn `k` bars to the right (k < 0: left): `points` on bar times, `future` past the last bar. */
export interface ShiftedLine {
  points: LinePoint[];
  future: FuturePoint[];
}

/** Appends the shifted points whose source bar index is ≥ `src`; returns how many landed in data. */
function pushShifted(
  s: ShiftedLine,
  points: LinePoint[],
  bars: { time: number }[],
  k: number,
  src: number,
): number {
  const n = bars.length;
  let i = Math.max(0, src);
  if (i >= n) return 0;
  let added = 0;
  for (let j = lowerBound(points, bars[i].time); j < points.length; j++) {
    const p = points[j];
    while (i < n && bars[i].time < p.time) i++;
    if (i === n) break;
    if (bars[i].time !== p.time) continue;
    const t = i + k;
    if (t < 0) continue;
    if (t < n) {
      s.points.push({ time: bars[t].time, value: p.value });
      added++;
    } else {
      s.future.push({ logical: t, value: p.value });
    }
  }
  return added;
}

/** The point at bar `i` is drawn at bar `i + k`; before bar 0 → dropped, past the last bar → `future`. */
export function shiftLine(points: LinePoint[], bars: { time: number }[], k: number): ShiftedLine {
  const s: ShiftedLine = { points: [], future: [] };
  pushShifted(s, points, bars, k, 0);
  return s;
}

/**
 * Realtime bar (last bar replaced or one appended, `points` already updated): redoes the tail of
 * `s` in place. 'update' = the last in-data point is new or changed, 'set' = anything else changed.
 */
export function shiftUpdate(
  s: ShiftedLine,
  points: LinePoint[],
  bars: { time: number }[],
  k: number,
): 'none' | 'update' | 'set' {
  const n = bars.length;
  if (n === 0) return 'none';
  const from = Math.max(0, n - 1 + Math.min(k, 0));
  const removed: LinePoint[] = [];
  while (s.points.length && s.points[s.points.length - 1].time >= bars[from].time)
    removed.push(s.points.pop()!);
  s.future.length = 0;
  const added = pushShifted(s, points, bars, k, from - k);
  if (removed.length === 0) return added === 0 ? 'none' : added === 1 ? 'update' : 'set';
  if (removed.length > 1 || added !== 1) return 'set';
  const last = s.points[s.points.length - 1];
  if (last.time !== removed[0].time) return 'set';
  return last.value === removed[0].value ? 'none' : 'update';
}

/** `SMA 20`, `MACD 12 26 9`, `VWAP`, `Pivot Points Standard Auto`. */
export function instanceLabel(def: IndicatorDef, params: Params): string {
  const text = (f: IndicatorDef['params'][number]) =>
    f.options?.find((o) => o.value === params[f.key])?.label ?? String(params[f.key]);
  return [def.shortLabel ?? def.label, ...def.params.map(text)].join(' ');
}

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtSmall = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });
const fmtVolume = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

/** Prices / indicator values: 2 decimals from 10, 4 decimals from 1, else 4 significant digits. */
export function formatValue(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return NONE;
  const a = Math.abs(v);
  return a >= 10 ? fmt2.format(v) : a >= 1 ? fmt4.format(v) : fmtSmall.format(v);
}

export function formatVolume(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? NONE : fmtVolume.format(v);
}

export interface LegendSource {
  id: string;
  def: IndicatorDef;
  params: Params;
  colors: Record<string, string>;
  lines: Record<string, LinePoint[]>;
  fixed?: Record<string, number>;
  hidden?: boolean;
}

export function withHiddenSources(
  instances: IndicatorInstance[],
  rendered: LegendSource[],
  defs: Record<string, IndicatorDef>,
  interval: Interval,
): LegendSource[] {
  const byId = new Map(rendered.map((s) => [s.id, s]));
  return instances.flatMap((i): LegendSource[] => {
    const shown = byId.get(i.id);
    if (shown) return [shown];
    if (i.visible || activeInstances([{ ...i, visible: true }], defs, interval).length === 0)
      return [];
    return [
      { id: i.id, def: defs[i.type], params: i.params, colors: i.colors, lines: {}, hidden: true },
    ];
  });
}

export interface LegendValue {
  line: string;
  text: string;
  color: string;
}

export interface LegendModel {
  symbol: string;
  interval: Interval;
  /** Time of the shown bar, null when there are no bars. */
  time: number | null;
  bar: Candle | null;
  color: string;
  rows: { id: string; label: string; hidden: boolean; values: LegendValue[] }[];
}

/** Legend for the bar at `time` (crosshair), or the last bar when `time` is null / not a bar. */
export function buildLegend(input: {
  symbol: string;
  interval: Interval;
  bars: Candle[];
  time: number | null;
  sources: LegendSource[];
}): LegendModel {
  const { bars } = input;
  const i = input.time === null ? -1 : indexAt(bars, input.time);
  const bar = (i >= 0 ? bars[i] : bars[bars.length - 1]) ?? null;
  return {
    symbol: input.symbol,
    interval: input.interval,
    time: bar?.time ?? null,
    bar,
    color: bar && bar.close < bar.open ? DOWN : UP,
    rows: input.sources.map((s) => ({
      id: s.id,
      label: instanceLabel(s.def, s.params),
      hidden: s.hidden === true,
      values: (s.hidden ? [] : s.def.lines).flatMap((l) => {
        if (s.fixed) {
          const f = s.fixed[l.key];
          if (f === undefined) return [];
          return [{ line: l.key, text: formatValue(f), color: s.colors[l.key] ?? l.color }];
        }
        const points = s.lines[l.key] ?? [];
        const j = bar ? indexAt(points, bar.time) : -1;
        const v = j >= 0 ? points[j].value : undefined;
        if (v === undefined && l.gaps) return [];
        const color = s.colors[l.key] ?? l.color;
        return [
          {
            line: l.key,
            text: formatValue(v),
            color: l.kind === 'histogram' && v !== undefined ? histColor(v, color) : color,
          },
        ];
      }),
    })),
  };
}

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

/** `SMA 20`, `MACD 12 26 9`, `VWAP`, `Pivot Points Standard Auto`. */
export function instanceLabel(def: IndicatorDef, params: Params): string {
  const text = (f: IndicatorDef['params'][number]) =>
    f.options?.find((o) => o.value === params[f.key])?.label ?? String(params[f.key]);
  return [def.label, ...def.params.map(text)].join(' ');
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
      values: (s.hidden ? [] : s.def.lines).map((l) => {
        const points = s.lines[l.key] ?? [];
        const j = bar ? indexAt(points, bar.time) : -1;
        const v = j >= 0 ? points[j].value : undefined;
        const color = s.colors[l.key] ?? l.color;
        return {
          line: l.key,
          text: formatValue(v),
          color: l.kind === 'histogram' && v !== undefined ? histColor(v, color) : color,
        };
      }),
    })),
  };
}

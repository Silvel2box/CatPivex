import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { lowerBound, withAlpha, type FuturePoint } from './indicatorData';
import type { LinePoint } from './indicators';

export const CLOUD_ALPHA = 0.25;

export interface CloudLine {
  points: LinePoint[];
  future: FuturePoint[];
  color: string;
  width: number;
}

export interface CloudSource {
  bars: { time: number }[];
  a: CloudLine;
  b: CloudLine;
}

export interface CloudSample {
  logical: number;
  a: number;
  b: number;
}

export interface CloudSegment {
  up: boolean;
  pts: CloudSample[];
}

export interface CloudDebug {
  from: number | null;
  to: number | null;
  futureBars: number;
  segments: { from: number; to: number; up: boolean; fill: string }[];
  last: CloudSample | null;
  future: CloudSample[];
  futureLines: { a: number; b: number };
}

/** Bars (logical index) in `[from, to]` where both lines have a value, in-data then future. */
export function cloudSamples(src: CloudSource, from = -Infinity, to = Infinity): CloudSample[] {
  const { bars, a, b } = src;
  const out: CloudSample[] = [];
  const n = bars.length;
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(n - 1, Math.ceil(to));
  if (lo <= hi) {
    let ja = lowerBound(a.points, bars[lo].time);
    let jb = lowerBound(b.points, bars[lo].time);
    for (let i = lo; i <= hi; i++) {
      const t = bars[i].time;
      while (ja < a.points.length && a.points[ja].time < t) ja++;
      while (jb < b.points.length && b.points[jb].time < t) jb++;
      if (a.points[ja]?.time === t && b.points[jb]?.time === t)
        out.push({ logical: i, a: a.points[ja].value, b: b.points[jb].value });
    }
  }
  const bFuture = new Map(b.future.map((p) => [p.logical, p.value]));
  for (const p of a.future) {
    const v = bFuture.get(p.logical);
    if (v !== undefined && p.logical >= from && p.logical <= to)
      out.push({ logical: p.logical, a: p.value, b: v });
  }
  return out;
}

/** Runs of consecutive bars with the same side (a ≥ b = up), split where a − b changes sign. */
export function cloudSegments(samples: CloudSample[]): CloudSegment[] {
  const out: CloudSegment[] = [];
  let cur: CloudSegment | null = null;
  for (let j = 0; j < samples.length; j++) {
    const s = samples[j];
    const prev = samples[j - 1];
    const up = s.a >= s.b;
    if (!cur || !prev || s.logical !== prev.logical + 1) {
      cur = { up, pts: [s] };
      out.push(cur);
    } else if (up !== cur.up) {
      const d0 = prev.a - prev.b;
      const t = d0 / (d0 - (s.a - s.b));
      const v = prev.a + t * (s.a - prev.a);
      const cross = { logical: prev.logical + t, a: v, b: v };
      cur.pts.push(cross);
      cur = { up, pts: [cross, s] };
      out.push(cur);
    } else {
      cur.pts.push(s);
    }
  }
  return out;
}

/** A line's part past the last bar, starting at its last in-data point when that is the last bar. */
export function futurePath(line: CloudLine, bars: { time: number }[]): FuturePoint[] {
  if (line.future.length === 0) return [];
  const last = line.points[line.points.length - 1];
  const n = bars.length;
  const head =
    last && n > 0 && last.time === bars[n - 1].time ? [{ logical: n - 1, value: last.value }] : [];
  return [...head, ...line.future];
}

export function futureRange(src: CloudSource, from: number, to: number): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const line of [src.a, src.b]) {
    for (const p of line.future) {
      if (p.logical < from || p.logical > to) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  return min <= max ? [min, max] : null;
}

const fillOf = (src: CloudSource, up: boolean) =>
  withAlpha(up ? src.a.color : src.b.color, CLOUD_ALPHA);

export function cloudDebug(src: CloudSource): CloudDebug {
  const samples = cloudSamples(src);
  const n = src.bars.length;
  const first = samples[0];
  const last = samples[samples.length - 1] ?? null;
  return {
    from: first?.logical ?? null,
    to: last?.logical ?? null,
    futureBars: last ? Math.max(0, last.logical - (n - 1)) : 0,
    segments: cloudSegments(samples)
      .filter((s) => s.pts.length > 1)
      .map((s) => ({
        from: s.pts[0].logical,
        to: s.pts[s.pts.length - 1].logical,
        up: s.up,
        fill: fillOf(src, s.up),
      })),
    last,
    future: samples.filter((s) => s.logical > n - 1),
    futureLines: {
      a: futurePath(src.a, src.bars).length,
      b: futurePath(src.b, src.bars).length,
    },
  };
}

type Pt = { x: number; y: number };

interface Projected {
  polygons: { fill: string; pts: Pt[] }[];
  lines: { color: string; width: number; pts: Pt[] }[];
}

/** Fill between two lines plus their future part, on the pane of the series it is attached to. */
export class CloudPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private projected: Projected = { polygons: [], lines: [] };
  private readonly views: IPrimitivePaneView[];
  private readonly source: () => CloudSource | null;

  constructor(source: () => CloudSource | null) {
    this.source = source;
    this.views = [
      { renderer: () => this.renderer('fill'), zOrder: () => 'bottom' },
      { renderer: () => this.renderer('lines'), zOrder: () => 'normal' },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  update(): void {
    this.requestUpdate?.();
  }

  debug(): CloudDebug | null {
    const src = this.source();
    return src ? cloudDebug(src) : null;
  }

  updateAllViews(): void {
    this.projected = this.project();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  autoscaleInfo(from: Logical, to: Logical): AutoscaleInfo | null {
    const src = this.source();
    const r = src ? futureRange(src, from, to) : null;
    return r ? { priceRange: { minValue: r[0], maxValue: r[1] } } : null;
  }

  private project(): Projected {
    const src = this.source();
    const series = this.series;
    const ts = this.chart?.timeScale();
    const range = ts?.getVisibleLogicalRange();
    if (!src || !series || !ts || !range) return { polygons: [], lines: [] };
    const x0 = ts.logicalToCoordinate(0 as Logical);
    const x1 = ts.logicalToCoordinate(1 as Logical);
    if (x0 === null || x1 === null) return { polygons: [], lines: [] };
    const x = (l: number) => x0 + l * (x1 - x0);
    const y = (v: number) => series.priceToCoordinate(v);
    const point = (l: number, v: number): Pt | null => {
      const py = y(v);
      return py === null ? null : { x: x(l), y: py };
    };
    const polygons: Projected['polygons'] = [];
    for (const seg of cloudSegments(cloudSamples(src, range.from - 1, range.to + 1))) {
      if (seg.pts.length < 2) continue;
      const top = seg.pts.map((s) => point(s.logical, s.a));
      const bottom = seg.pts.map((s) => point(s.logical, s.b)).reverse();
      const pts = [...top, ...bottom].filter((p): p is Pt => p !== null);
      polygons.push({ fill: fillOf(src, seg.up), pts });
    }
    const lines: Projected['lines'] = [];
    for (const line of [src.a, src.b]) {
      const pts = futurePath(line, src.bars).flatMap((p) => point(p.logical, p.value) ?? []);
      if (pts.length > 1) lines.push({ color: line.color, width: line.width, pts });
    }
    return { polygons, lines };
  }

  private renderer(part: 'fill' | 'lines'): IPrimitivePaneRenderer {
    const { polygons, lines } = this.projected;
    return {
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          if (part === 'fill') {
            for (const poly of polygons) {
              ctx.fillStyle = poly.fill;
              ctx.beginPath();
              poly.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
              ctx.closePath();
              ctx.fill();
            }
            return;
          }
          ctx.lineJoin = 'round';
          for (const line of lines) {
            ctx.strokeStyle = line.color;
            ctx.lineWidth = line.width;
            ctx.beginPath();
            line.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
          }
        });
      },
    };
  }
}

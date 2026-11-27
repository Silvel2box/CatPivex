import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { Candle } from '../../api/types';
import { logicalToTime, logicalToX, timeToLogical, xToLogical, type ScaleLike } from './coords';
import { fibBands, fibLevelsOf, fibPrices, hitTestAll } from './geometry';
import { MEASURE_FILL_ALPHA, measureColor, measureLines, measureStats } from './measure';
import {
  FIB_FILL_ALPHA,
  HANDLE_TOLERANCE,
  HIT_TOLERANCE,
  RECT_FILL_ALPHA,
  type Anchor,
  type Drawing,
  type PixelShape,
  type Point,
} from './types';

export interface Projected {
  id: string;
  drawing: Drawing;
  shape: PixelShape;
}

const HANDLE_RADIUS = 5;

/** A label on the price or time axis. */
interface AxisLabel {
  coord: number;
  text: string;
  color: string;
}
const LABEL_FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Draws every drawing of the current symbol on the candle pane, plus the one being drawn
 * (preview). Anchors are (time, price); pixels are recomputed on every chart update, so zoom,
 * scroll and timeframe changes need nothing special.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawings: Drawing[] = [];
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private preview: Drawing | null = null;
  /** Where the next click would place a point (tool active, nothing clicked yet). */
  private ghost: { anchor: Anchor; color: string } | null = null;
  private measureAB: { a: Anchor; b: Anchor } | null = null;
  /** hlines / rays with an enabled price alert (bell mark). */
  private alertLines: ReadonlySet<string> = new Set();
  private projected: Projected[] = [];
  private readonly views: IPrimitivePaneView[];
  private priceLabels: AxisLabel[] = [];
  private timeLabels: AxisLabel[] = [];
  private priceViews: ISeriesPrimitiveAxisView[] = [];
  private timeViews: ISeriesPrimitiveAxisView[] = [];
  private timesCache: { bars: Candle[]; length: number; times: number[] } | null = null;
  private readonly getBars: () => Candle[];
  private readonly getIntervalSec: () => number;

  constructor(getBars: () => Candle[], getIntervalSec: () => number) {
    this.getBars = getBars;
    this.getIntervalSec = getIntervalSec;
    this.views = [{ renderer: () => this.renderer(), zOrder: () => 'top' }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setState(s: {
    drawings: Drawing[];
    selectedId: string | null;
    preview: Drawing | null;
    hoveredId: string | null;
    ghost: { anchor: Anchor; color: string } | null;
    measure: { a: Anchor; b: Anchor } | null;
  }): void {
    this.drawings = s.drawings;
    this.selectedId = s.selectedId;
    this.preview = s.preview;
    this.hoveredId = s.hoveredId;
    this.ghost = s.ghost;
    this.measureAB = s.measure;
    this.requestUpdate?.();
  }

  setAlertLines(ids: ReadonlySet<string>): void {
    const same =
      ids.size === this.alertLines.size && [...ids].every((id) => this.alertLines.has(id));
    if (same) return;
    this.alertLines = ids;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.projected = this.project();
    this.updateAxisLabels();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceViews;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeViews;
  }

  /** Cursor over a drawing (the controller does the actual selecting / dragging). */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = hitTestAll(this.shapes(), x, y, HIT_TOLERANCE, HANDLE_TOLERANCE);
    if (!hit) return null;
    return {
      externalId: hit.id,
      zOrder: 'top',
      cursorStyle: hit.part === 'body' ? 'move' : 'pointer',
    };
  }

  /** Current pixel shapes of the saved drawings (not the preview), in draw order. */
  shapes(): { id: string; shape: PixelShape }[] {
    return this.project().filter((p) => p.drawing !== this.preview);
  }

  /** (x, y) in pane px -> anchor; null when the chart has no data. */
  toAnchor(x: number, y: number): Anchor | null {
    const logical = this.chart ? xToLogical(this.scale(), x) : null;
    const time =
      logical === null ? null : logicalToTime(logical, this.times(), this.getIntervalSec());
    const price = this.series?.coordinateToPrice(y) ?? null;
    return time === null || price === null ? null : { time, price };
  }

  timeToX(time: number): number | null {
    const logical = timeToLogical(time, this.times(), this.getIntervalSec());
    return logical === null || !this.chart ? null : logicalToX(this.scale(), logical);
  }

  // ---- internals ------------------------------------------------------------------------------

  private scale(): ScaleLike {
    const ts = this.chart!.timeScale();
    return { logicalToCoordinate: (l) => ts.logicalToCoordinate(l as never) };
  }

  private times(): number[] {
    const bars = this.getBars();
    const c = this.timesCache;
    if (c && c.bars === bars && c.length === bars.length && c.times.at(-1) === bars.at(-1)?.time) {
      return c.times;
    }
    const times = bars.map((b) => b.time);
    this.timesCache = { bars, length: bars.length, times };
    return times;
  }

  /** Dev hook: what is highlighted and which axis labels are showing. */
  debug(): {
    hoveredId: string | null;
    ghost: Anchor | null;
    priceLabels: string[];
    timeLabels: string[];
    alertLines: string[];
  } {
    return {
      alertLines: [...this.alertLines],
      hoveredId: this.hoveredId,
      ghost: this.ghost?.anchor ?? null,
      priceLabels: this.priceLabels.map((l) => l.text),
      timeLabels: this.timeLabels.map((l) => l.text),
    };
  }

  /** The ruler: its anchors and the two label lines exactly as drawn. */
  measure(): { a: Anchor; b: Anchor; lines: string[] } | null {
    if (!this.measureAB) return null;
    const { a, b } = this.measureAB;
    const stats = measureStats(a, b, this.times(), this.getIntervalSec());
    const format = (p: number) => this.series?.priceFormatter().format(p) ?? String(p);
    return { a, b, lines: measureLines(stats, format) };
  }

  /** y of a price on the candle pane; null without data. */
  priceToY(price: number): number | null {
    return this.y(price);
  }

  private y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private point(a: Anchor): Point | null {
    const x = this.timeToX(a.time);
    const y = this.y(a.price);
    return x === null || y === null ? null : { x, y };
  }

  private project(): Projected[] {
    if (!this.chart || !this.series) return [];
    const all = this.preview ? [...this.drawings, this.preview] : this.drawings;
    const out: Projected[] = [];
    for (const d of all) {
      let shape: PixelShape | null = null;
      if (d.type === 'hline') {
        const y = this.y(d.price);
        shape = y === null ? null : { type: 'hline', y };
      } else if (d.type === 'hray') {
        const a = this.point(d.a);
        shape = a && { type: 'hray', a };
      } else if (d.type === 'vline') {
        const x = this.timeToX(d.time);
        shape = x === null ? null : { type: 'vline', x };
      } else if (!('b' in d)) {
        shape = null;
      } else {
        const a = this.point(d.a);
        const b = this.point(d.b);
        if (a && b) {
          if (d.type === 'fib') {
            const levels = fibLevelsOf(d).map(({ level }) => level);
            const ys = fibPrices(d.a, d.b, levels).map((p) => this.y(p));
            if (ys.every((v) => v !== null)) {
              shape = { type: 'fib', a, b, levelYs: ys as number[] };
              if (d.extend) shape.extendTo = this.chart.timeScale().width();
            }
          } else {
            shape = { type: d.type, a, b };
          }
        }
      }
      if (shape) out.push({ id: d.id, drawing: d, shape });
    }
    return out;
  }

  /**
   * Price-axis labels for every hline and ray, plus price and time labels at the anchors of the
   * drawing being drawn or the selected one, so you can place a point at an exact price/time.
   */
  private updateAxisLabels(): void {
    const price = (p: number) => this.series?.priceFormatter().format(p) ?? String(p);
    const timeFmt = this.chart?.options().localization.timeFormatter;
    const time = (t: number) => (timeFmt ? timeFmt(t as Time) : String(t));
    const prices: AxisLabel[] = [];
    const times: AxisLabel[] = [];
    const active = this.preview?.id ?? this.selectedId;
    for (const { drawing: d, shape } of this.projected) {
      if (shape.type === 'hline' && d.type === 'hline') {
        prices.push({ coord: shape.y, text: price(d.price), color: d.color });
      }
      if (shape.type === 'hray' && d.type === 'hray') {
        prices.push({ coord: shape.a.y, text: price(d.a.price), color: d.color });
        if (d.id === active) times.push({ coord: shape.a.x, text: time(d.a.time), color: d.color });
      }
      if (d.id !== active) continue;
      if (shape.type === 'vline' && d.type === 'vline') {
        times.push({ coord: shape.x, text: time(d.time), color: d.color });
      }
      if ('b' in shape && 'b' in d) {
        for (const [p, anchor] of [
          [shape.a, d.a],
          [shape.b, d.b],
        ] as const) {
          prices.push({ coord: p.y, text: price(anchor.price), color: d.color });
          times.push({ coord: p.x, text: time(anchor.time), color: d.color });
        }
      }
    }
    const g = this.ghostPoint();
    if (g && this.ghost) {
      prices.push({ coord: g.y, text: price(this.ghost.anchor.price), color: this.ghost.color });
      times.push({ coord: g.x, text: time(this.ghost.anchor.time), color: this.ghost.color });
    }
    this.priceLabels = prices;
    this.timeLabels = times;
    // Same view objects while the count is unchanged (the library caches by array identity).
    if (this.priceViews.length !== prices.length) {
      this.priceViews = prices.map((_, i) => this.axisView(() => this.priceLabels[i]));
    }
    if (this.timeViews.length !== times.length) {
      this.timeViews = times.map((_, i) => this.axisView(() => this.timeLabels[i]));
    }
  }

  private ghostPoint(): Point | null {
    return this.ghost ? this.point(this.ghost.anchor) : null;
  }

  private axisView(get: () => AxisLabel | undefined): ISeriesPrimitiveAxisView {
    return {
      coordinate: () => get()?.coord ?? -100,
      text: () => get()?.text ?? '',
      textColor: () => '#ffffff',
      backColor: () => get()?.color ?? '#2962ff',
      visible: () => get() !== undefined,
    };
  }

  private renderer(): IPrimitivePaneRenderer {
    const items = this.projected;
    const selectedId = this.selectedId;
    const hoveredId = this.hoveredId;
    const ghost = this.ghostPoint();
    const ghostColor = this.ghost?.color ?? '#2962ff';
    const alertLines = this.alertLines;
    const measure = this.measure();
    const ma = measure && this.point(measure.a);
    const mb = measure && this.point(measure.b);
    const format = (p: number) => this.series?.priceFormatter().format(p) ?? String(p);
    return {
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          for (const { drawing: d, shape } of items) {
            ctx.save();
            ctx.strokeStyle = d.color;
            ctx.lineWidth = d.width;
            switch (shape.type) {
              case 'hline':
                line(ctx, 0, shape.y, mediaSize.width, shape.y);
                break;
              case 'vline':
                line(ctx, shape.x, 0, shape.x, mediaSize.height);
                break;
              case 'hray':
                line(ctx, shape.a.x, shape.a.y, mediaSize.width, shape.a.y);
                break;
              case 'trendline':
                line(ctx, shape.a.x, shape.a.y, shape.b.x, shape.b.y);
                break;
              case 'rect': {
                const x = Math.min(shape.a.x, shape.b.x);
                const y = Math.min(shape.a.y, shape.b.y);
                const w = Math.abs(shape.a.x - shape.b.x);
                const h = Math.abs(shape.a.y - shape.b.y);
                ctx.fillStyle = withAlpha(d.color, RECT_FILL_ALPHA);
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
                break;
              }
              case 'fib': {
                if (d.type !== 'fib') break;
                const x0 = Math.min(shape.a.x, shape.b.x);
                const x1 = shape.extendTo ?? Math.max(shape.a.x, shape.b.x);
                const levels = fibLevelsOf(d);
                const prices = fibPrices(
                  d.a,
                  d.b,
                  levels.map(({ level }) => level),
                );
                // Filled bands between levels (each in the colour of its upper level).
                for (const band of fibBands(levels, shape.levelYs)) {
                  ctx.fillStyle = withAlpha(band.color, d.fill ?? FIB_FILL_ALPHA);
                  ctx.fillRect(x0, band.y, x1 - x0, band.h);
                }
                ctx.font = LABEL_FONT;
                ctx.textBaseline = 'bottom';
                levels.forEach(({ level, color }, i) => {
                  const y = shape.levelYs[i];
                  ctx.strokeStyle = color;
                  ctx.lineWidth = d.width;
                  line(ctx, x0, y, x1, y);
                  ctx.fillStyle = color;
                  ctx.fillText(`${level} (${format(prices[i])})`, x0 + 4, y - 2);
                });
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                line(ctx, shape.a.x, shape.a.y, shape.b.x, shape.b.y);
                ctx.setLineDash([]);
                break;
              }
            }
            // Handles on the selected drawing and on the one under the mouse.
            const marked = d.id === selectedId || d.id === hoveredId;
            const handles =
              'b' in shape ? [shape.a, shape.b] : shape.type === 'hray' ? [shape.a] : null;
            if (marked && handles) {
              ctx.lineWidth = 2;
              ctx.strokeStyle = d.color;
              ctx.fillStyle = d.id === selectedId ? '#ffffff' : '#131722';
              for (const p of handles) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            } else if (marked) {
              // hline / vline: a translucent halo (stronger when selected).
              ctx.strokeStyle = withAlpha(d.color, d.id === selectedId ? 0.35 : 0.2);
              ctx.lineWidth = d.width + 6;
              if (shape.type === 'hline') line(ctx, 0, shape.y, mediaSize.width, shape.y);
              if (shape.type === 'vline') line(ctx, shape.x, 0, shape.x, mediaSize.height);
            }
            const alertY =
              shape.type === 'hline' ? shape.y : shape.type === 'hray' ? shape.a.y : null;
            if (alertY !== null && alertLines.has(d.id)) {
              bell(ctx, mediaSize.width - BELL_INSET, alertY - 9, d.color);
            }
            ctx.restore();
          }
          if (measure && ma && mb) {
            drawMeasure(ctx, ma, mb, measureColor(measure.a, measure.b), measure.lines, mediaSize);
          }
          if (ghost) {
            ctx.beginPath();
            ctx.arc(ghost.x, ghost.y, HANDLE_RADIUS - 1, 0, Math.PI * 2);
            ctx.fillStyle = ghostColor;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
          }
        });
      },
    };
  }
}

const BELL_INSET = 14;
const MEASURE_ARROW = 8;
const MEASURE_PAD_X = 6;
const MEASURE_PAD_Y = 4;
const MEASURE_LINE_H = 15;
const MEASURE_GAP = 6;

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  color: string,
  lines: string[],
  pane: { width: number; height: number },
) {
  ctx.save();
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  ctx.fillStyle = withAlpha(color, MEASURE_FILL_ALPHA);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  line(ctx, a.x, a.y, b.x, b.y);
  if (w > 0 || h > 0) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    for (const side of [-1, 1]) {
      const t = angle + Math.PI + (side * Math.PI) / 7;
      ctx.lineTo(b.x + MEASURE_ARROW * Math.cos(t), b.y + MEASURE_ARROW * Math.sin(t));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = LABEL_FONT;
  const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * MEASURE_PAD_X;
  const lh = lines.length * MEASURE_LINE_H + 2 * MEASURE_PAD_Y;
  const ly = b.y <= a.y ? y - MEASURE_GAP - lh : y + h + MEASURE_GAP;
  const lx = x + w / 2 - lw / 2;
  const cx = Math.max(0, Math.min(lx, pane.width - lw));
  const cy = Math.max(0, Math.min(ly, pane.height - lh));
  ctx.beginPath();
  ctx.roundRect(cx, cy, lw, lh, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillText(l, cx + lw / 2, cy + MEASURE_PAD_Y + MEASURE_LINE_H * (i + 0.5));
  });
  ctx.restore();
}

function bell(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(cx - 5.5, cy + 4);
  ctx.lineTo(cx + 5.5, cy + 4);
  ctx.lineTo(cx + 4, cy + 2);
  ctx.lineTo(cx + 4, cy - 1);
  ctx.arc(cx, cy - 1, 4, 0, Math.PI, true);
  ctx.lineTo(cx - 4, cy + 2);
  ctx.closePath();
  ctx.moveTo(cx + 1.5, cy + 5.5);
  ctx.arc(cx, cy + 5.5, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#131722';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

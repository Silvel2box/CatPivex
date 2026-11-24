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
import { fibPrices, hitTestAll } from './geometry';
import {
  FIB_LEVELS,
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

const HANDLE_RADIUS = 4;
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
  private preview: Drawing | null = null;
  private projected: Projected[] = [];
  private readonly views: IPrimitivePaneView[];
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private axisViewIds: string[] = [];
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

  setDrawings(drawings: Drawing[], selectedId: string | null, preview: Drawing | null): void {
    this.drawings = drawings;
    this.selectedId = selectedId;
    this.preview = preview;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.projected = this.project();
    const lines = this.projected.filter((p) => p.drawing.type === 'hline');
    if (
      lines.length !== this.axisViews.length ||
      lines.some((p, i) => this.axisViewIds[i] !== p.id)
    ) {
      this.axisViewIds = lines.map((p) => p.id);
      this.axisViews = lines.map((p) => this.priceLabel(p.id));
    }
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  /** Cursor over a drawing (the controller does the actual selecting / dragging). */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = hitTestAll(this.shapes(), x, y, HIT_TOLERANCE);
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
      } else if (d.type === 'vline') {
        const x = this.timeToX(d.time);
        shape = x === null ? null : { type: 'vline', x };
      } else {
        const a = this.point(d.a);
        const b = this.point(d.b);
        if (a && b) {
          if (d.type === 'fib') {
            const ys = fibPrices(d.a, d.b).map((p) => this.y(p));
            if (ys.every((v) => v !== null)) shape = { type: 'fib', a, b, levelYs: ys as number[] };
          } else {
            shape = { type: d.type, a, b };
          }
        }
      }
      if (shape) out.push({ id: d.id, drawing: d, shape });
    }
    return out;
  }

  private priceLabel(id: string): ISeriesPrimitiveAxisView {
    const current = () => this.projected.find((p) => p.id === id);
    return {
      coordinate: () => {
        const s = current()?.shape;
        return s?.type === 'hline' ? s.y : -100;
      },
      text: () => {
        const d = current()?.drawing;
        return d?.type === 'hline' ? (this.series?.priceFormatter().format(d.price) ?? '') : '';
      },
      textColor: () => '#ffffff',
      backColor: () => current()?.drawing.color ?? '#2962ff',
      visible: () => current() !== undefined,
    };
  }

  private renderer(): IPrimitivePaneRenderer {
    const items = this.projected;
    const selectedId = this.selectedId;
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
                const x1 = Math.max(shape.a.x, shape.b.x);
                const prices = fibPrices(d.a, d.b);
                ctx.font = LABEL_FONT;
                ctx.textBaseline = 'bottom';
                FIB_LEVELS.forEach(({ level, color }, i) => {
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
            if (d.id === selectedId && 'a' in shape) {
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = d.color;
              ctx.fillStyle = '#131722';
              for (const p of [shape.a, shape.b]) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            } else if (d.id === selectedId) {
              // hline / vline: a thicker translucent halo marks the selection.
              ctx.strokeStyle = withAlpha(d.color, 0.35);
              ctx.lineWidth = d.width + 6;
              if (shape.type === 'hline') line(ctx, 0, shape.y, mediaSize.width, shape.y);
              if (shape.type === 'vline') line(ctx, shape.x, 0, shape.x, mediaSize.height);
            }
            ctx.restore();
          }
        });
      },
    };
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

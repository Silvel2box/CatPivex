import type { Candle } from '../../api/types';
import {
  FIB_LEVELS,
  type Anchor,
  type Drawing,
  type DrawingWidth,
  type Hit,
  type PixelShape,
  type Point,
} from './types';

/**
 * Magnet (T4.2): snap to the bar nearest in time (ties -> the earlier bar), and to whichever of
 * its open/high/low/close is nearest to `anchor.price` (`only: 'hl'` -> high/low only, for fib
 * wick snapping). Returns `anchor` unchanged when `enabled` is false or there are no bars.
 */
export function magnetSnap(
  anchor: Anchor,
  bars: Candle[],
  enabled: boolean,
  only: 'ohlc' | 'hl' = 'ohlc',
): Anchor {
  if (!enabled || bars.length === 0) return anchor;
  // First bar with time >= anchor.time (bars are ascending); its predecessor is the other candidate.
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < anchor.time) lo = mid + 1;
    else hi = mid;
  }
  let bar: Candle;
  if (lo === 0) bar = bars[0];
  else if (lo === bars.length) bar = bars[bars.length - 1];
  else {
    const before = bars[lo - 1];
    const after = bars[lo];
    bar = anchor.time - before.time <= after.time - anchor.time ? before : after;
  }
  const prices = only === 'hl' ? [bar.high, bar.low] : [bar.open, bar.high, bar.low, bar.close];
  let price = prices[0];
  for (const p of prices) {
    if (Math.abs(p - anchor.price) < Math.abs(price - anchor.price)) price = p;
  }
  return { time: bar.time, price };
}

function dist(p: Point, x: number, y: number): number {
  return Math.hypot(x - p.x, y - p.y);
}

/** Distance from (x, y) to the segment a–b (a point when a === b). */
function distToSegment(a: Point, b: Point, x: number, y: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** Distance from (x, y) to the filled box with corners (x0, y0), (x1, y1): 0 inside. */
function distToBox(x0: number, y0: number, x1: number, y1: number, x: number, y: number): number {
  const dx = Math.max(Math.min(x0, x1) - x, 0, x - Math.max(x0, x1));
  const dy = Math.max(Math.min(y0, y1) - y, 0, y - Math.max(y0, y1));
  return Math.hypot(dx, dy);
}

/**
 * Hit-test one shape (T4.3). Anchor handles (a/b, within `tol` px of the point) win over the
 * body. Body: within `tol` px of an hline/vline, of a ray right of its anchor, of the trendline
 * segment, of a rect edge or anywhere inside the rect, anywhere in the fib's filled area (x span
 * × level-0..level-1, plus `tol`) or within `tol` of the fib a–b diagonal.
 */
export function hitTestShape(
  shape: PixelShape,
  x: number,
  y: number,
  tol: number,
  handleTol = tol,
): Hit['part'] | null {
  switch (shape.type) {
    case 'hline':
      return Math.abs(y - shape.y) <= tol ? 'body' : null;
    case 'vline':
      return Math.abs(x - shape.x) <= tol ? 'body' : null;
    case 'hray':
      if (dist(shape.a, x, y) <= handleTol) return 'a';
      return Math.abs(y - shape.a.y) <= tol && x >= shape.a.x - tol ? 'body' : null;
    case 'long':
    case 'short':
    case 'text':
      return null;
  }
  const { a, b } = shape;
  if (dist(a, x, y) <= handleTol) return 'a';
  if (dist(b, x, y) <= handleTol) return 'b';
  switch (shape.type) {
    case 'trendline':
      return distToSegment(a, b, x, y) <= tol ? 'body' : null;
    case 'rect':
      return distToBox(a.x, a.y, b.x, b.y, x, y) <= tol ? 'body' : null;
    case 'fib': {
      // The bands between levels are filled, so the whole area grabs the fib (like TradingView).
      if (distToSegment(a, b, x, y) <= tol) return 'body';
      const ys = shape.levelYs;
      if (ys.length === 0) return null;
      const right = Math.max(a.x, b.x, shape.extendTo ?? -Infinity);
      return distToBox(Math.min(a.x, b.x), Math.min(...ys), right, Math.max(...ys), x, y) <= tol
        ? 'body'
        : null;
    }
  }
}

/** Topmost hit: shapes are in draw order, so the last one that hits wins. */
export function hitTestAll(
  shapes: readonly { id: string; shape: PixelShape }[],
  x: number,
  y: number,
  tol: number,
  handleTol = tol,
): Hit | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const part = hitTestShape(shapes[i].shape, x, y, tol, handleTol);
    if (part) return { id: shapes[i].id, part };
  }
  return null;
}

/**
 * Shift-drawing: keeps `to` on the nearest multiple of 45° from `from` (horizontal, vertical or
 * diagonal on screen), projected so the distance along that direction is kept.
 */
export function constrainAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { ...to };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const cos = Math.round(Math.cos(angle) * 1e12) / 1e12; // exact 0 / ±1 / ±√½
  const sin = Math.round(Math.sin(angle) * 1e12) / 1e12;
  const len = dx * cos + dy * sin;
  return { x: from.x + len * cos, y: from.y + len * sin };
}

/** Fib level prices, in FIB_LEVELS order (see FIB_LEVELS for the formula). */
export function fibPrices(a: Anchor, b: Anchor): number[] {
  // b + (a - b) * level, written as a lerp so level 0 / 1 give exactly b / a (no float drift).
  return FIB_LEVELS.map(({ level }) => b.price * (1 - level) + a.price * level);
}

/**
 * Moves a whole drawing by (dTime seconds, dPrice), or one anchor to `to` (part 'a' / 'b').
 * hline ignores time, vline ignores price. Returns a new object.
 */
export function moveDrawing(
  d: Drawing,
  part: Hit['part'],
  delta: { dTime: number; dPrice: number },
  to: Anchor,
): Drawing {
  const body = part === 'body';
  switch (d.type) {
    case 'hline':
      return { ...d, price: body ? d.price + delta.dPrice : to.price };
    case 'vline':
      return { ...d, time: Math.round(body ? d.time + delta.dTime : to.time) };
    case 'hray':
      return body
        ? { ...d, a: { time: Math.round(d.a.time + delta.dTime), price: d.a.price + delta.dPrice } }
        : { ...d, a: { time: Math.round(to.time), price: to.price } };
    case 'long':
    case 'short':
    case 'text':
      return d;
    default: {
      const shift = (p: Anchor): Anchor => ({
        time: Math.round(p.time + delta.dTime),
        price: p.price + delta.dPrice,
      });
      const at: Anchor = { time: Math.round(to.time), price: to.price };
      if (body) return { ...d, a: shift(d.a), b: shift(d.b) };
      return part === 'a' ? { ...d, a: at, b: { ...d.b } } : { ...d, a: { ...d.a }, b: at };
    }
  }
}

/** Price an alert on this drawing follows; null = the drawing cannot carry an alert. */
export function alertLevel(d: Drawing): number | null {
  if (d.type === 'hline') return d.price;
  return d.type === 'hray' ? d.a.price : null;
}

// ---- Sanitize ----------------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const WIDTHS: readonly number[] = [1, 2, 3, 4];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Time is stored as whole seconds; a finite non-integer is rounded rather than dropped. */
function anchorOf(v: unknown): Anchor | null {
  if (!isRecord(v) || !finite(v.time) || !finite(v.price)) return null;
  return { time: Math.round(v.time), price: v.price };
}

function drawingOf(v: unknown): Drawing | null {
  if (!isRecord(v)) return null;
  const { id, color, width, type } = v;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null;
  if (typeof width !== 'number' || !WIDTHS.includes(width)) return null;
  const base = { id, color, width: width as DrawingWidth };
  switch (type) {
    case 'hline':
      return finite(v.price) ? { ...base, type, price: v.price } : null;
    case 'vline':
      return finite(v.time) ? { ...base, type, time: Math.round(v.time) } : null;
    case 'hray': {
      const a = anchorOf(v.a);
      return a ? { ...base, type, a } : null;
    }
    case 'trendline':
    case 'rect': {
      const a = anchorOf(v.a);
      const b = anchorOf(v.b);
      return a && b ? { ...base, type, a, b } : null;
    }
    case 'fib': {
      const a = anchorOf(v.a);
      const b = anchorOf(v.b);
      if (!a || !b) return null;
      // An invalid fill/extend only loses that field (-> default), not the whole drawing.
      const fib: Drawing = { ...base, type, a, b };
      if (typeof v.fill === 'number' && v.fill >= 0 && v.fill <= 1) fib.fill = v.fill;
      if (v.extend === true) fib.extend = true;
      return fib;
    }
    default:
      return null;
  }
}

/** Valid drawings from untrusted JSON (server / old versions); invalid entries are dropped. */
export function sanitizeDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const d = drawingOf(item);
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

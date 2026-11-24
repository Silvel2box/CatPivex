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
 * its open/high/low/close is nearest to `anchor.price`. Returns `anchor` unchanged when
 * `enabled` is false or there are no bars.
 */
export function magnetSnap(anchor: Anchor, bars: Candle[], enabled: boolean): Anchor {
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
  let price = bar.open;
  for (const p of [bar.high, bar.low, bar.close]) {
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

/**
 * Hit-test one shape (T4.3). Anchor handles (a/b, within `tol` px of the point) win over the
 * body. Body: within `tol` px of an hline/vline, of the trendline segment, of a rect edge or
 * anywhere inside the rect, of a fib level line (within its x span) or of the fib a–b diagonal.
 */
export function hitTestShape(
  shape: PixelShape,
  x: number,
  y: number,
  tol: number,
): Hit['part'] | null {
  switch (shape.type) {
    case 'hline':
      return Math.abs(y - shape.y) <= tol ? 'body' : null;
    case 'vline':
      return Math.abs(x - shape.x) <= tol ? 'body' : null;
  }
  const { a, b } = shape;
  if (dist(a, x, y) <= tol) return 'a';
  if (dist(b, x, y) <= tol) return 'b';
  switch (shape.type) {
    case 'trendline':
      return distToSegment(a, b, x, y) <= tol ? 'body' : null;
    case 'rect': {
      // Distance to the filled rectangle: 0 inside, else to the nearest edge.
      const dx = Math.max(Math.min(a.x, b.x) - x, 0, x - Math.max(a.x, b.x));
      const dy = Math.max(Math.min(a.y, b.y) - y, 0, y - Math.max(a.y, b.y));
      return Math.hypot(dx, dy) <= tol ? 'body' : null;
    }
    case 'fib': {
      if (distToSegment(a, b, x, y) <= tol) return 'body';
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      for (const ly of shape.levelYs) {
        if (distToSegment({ x: x0, y: ly }, { x: x1, y: ly }, x, y) <= tol) return 'body';
      }
      return null;
    }
  }
}

/** Topmost hit: shapes are in draw order, so the last one that hits wins. */
export function hitTestAll(
  shapes: readonly { id: string; shape: PixelShape }[],
  x: number,
  y: number,
  tol: number,
): Hit | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const part = hitTestShape(shapes[i].shape, x, y, tol);
    if (part) return { id: shapes[i].id, part };
  }
  return null;
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
    case 'trendline':
    case 'rect':
    case 'fib': {
      const a = anchorOf(v.a);
      const b = anchorOf(v.b);
      return a && b ? { ...base, type, a, b } : null;
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

import type { Candle } from '../../api/types';
import type { Anchor, Drawing, Hit, PixelShape } from './types';

/**
 * Magnet (T4.2): snap to the bar nearest in time (ties -> the earlier bar), and to whichever of
 * its open/high/low/close is nearest to `anchor.price`. Returns `anchor` unchanged when
 * `enabled` is false or there are no bars.
 */
export function magnetSnap(anchor: Anchor, bars: Candle[], enabled: boolean): Anchor {
  void anchor;
  void bars;
  void enabled;
  throw new Error('not implemented');
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
  void shape;
  void x;
  void y;
  void tol;
  throw new Error('not implemented');
}

/** Topmost hit: shapes are in draw order, so the last one that hits wins. */
export function hitTestAll(
  shapes: readonly { id: string; shape: PixelShape }[],
  x: number,
  y: number,
  tol: number,
): Hit | null {
  void shapes;
  void x;
  void y;
  void tol;
  throw new Error('not implemented');
}

/** Fib level prices, in FIB_LEVELS order (see FIB_LEVELS for the formula). */
export function fibPrices(a: Anchor, b: Anchor): number[] {
  void a;
  void b;
  throw new Error('not implemented');
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
  void d;
  void part;
  void delta;
  void to;
  throw new Error('not implemented');
}

/** Valid drawings from untrusted JSON (server / old versions); invalid entries are dropped. */
export function sanitizeDrawings(raw: unknown): Drawing[] {
  void raw;
  throw new Error('not implemented');
}

// Phase 4 drawing contract. Anchors are (time, price), never pixels, so a drawing stays put
// across zoom, scroll and timeframe changes. Stored per symbol via /api/drawings/{symbol}.

export type DrawingType =
  'hline' | 'hray' | 'vline' | 'trendline' | 'rect' | 'fib' | 'long' | 'short' | 'text';

export type PositionSide = 'long' | 'short';

/** time = unix seconds UTC, integer, may fall between bars (or outside the loaded data). */
export interface Anchor {
  time: number;
  price: number;
}

export type DrawingWidth = 1 | 2 | 3 | 4;

interface Base {
  /** Unique within the symbol, e.g. "d-<random>". */
  id: string;
  /** #rrggbb */
  color: string;
  width: DrawingWidth;
}

export type Drawing =
  | (Base & { type: 'hline'; price: number })
  | (Base & { type: 'hray'; a: Anchor })
  | (Base & { type: 'vline'; time: number })
  | (Base & { type: 'trendline' | 'rect'; a: Anchor; b: Anchor })
  /**
   * fill = opacity (0..1) of the bands between levels; missing -> FIB_FILL_ALPHA.
   * extend = level lines run to the right edge of the chart instead of stopping at the anchors.
   */
  | (Base & {
      type: 'fib';
      a: Anchor;
      b: Anchor;
      fill?: number;
      extend?: boolean;
      levels?: number[];
    })
  | (Base & { type: PositionSide; a: Anchor; end: number; stop: number; target: number })
  | (Base & { type: 'text'; a: Anchor; text: string; size: TextSize });

/** Anchor count per tool: 1 = one click, 2 = click start, click end. */
export const ANCHOR_COUNT: Record<DrawingType, 1 | 2> = {
  hline: 1,
  hray: 1,
  vline: 1,
  trendline: 2,
  rect: 2,
  fib: 2,
  long: 1,
  short: 1,
  text: 1,
};

export const DEFAULT_COLOR: Record<DrawingType, string> = {
  hline: '#2962ff',
  hray: '#2962ff',
  vline: '#2962ff',
  trendline: '#2962ff',
  rect: '#9c27b0', // fill = this colour at RECT_FILL_ALPHA
  fib: '#787b86', // the a–b diagonal; level lines use FIB_LEVELS colours
  long: '#2962ff',
  short: '#2962ff',
  text: '#2962ff',
};
export const RECT_FILL_ALPHA = 0.2;
export const FIB_FILL_ALPHA = 0.15;
/** Choices for a fib's band opacity in the toolbar. */
export const FIB_FILL_OPTIONS = [0, 0.05, 0.1, 0.15, 0.25, 0.35, 0.5] as const;
/**
 * Fib anchors snap to the nearest bar's high or low within this many px, even with the magnet
 * off: a retracement is drawn from a swing high/low, i.e. a wick tip.
 */
export const FIB_WICK_SNAP_PX = 15;

/**
 * Fibonacci retracement (TradingView convention): level 1 at anchor a (start of the drag),
 * level 0 at anchor b (end). price(level) = b.price + (a.price - b.price) * level.
 * Level lines span from min(a.time, b.time) to max(a.time, b.time).
 */
export const FIB_LEVELS: readonly { level: number; color: string }[] = [
  { level: 0, color: '#787b86' },
  { level: 0.236, color: '#f23645' },
  { level: 0.382, color: '#ff9800' },
  { level: 0.5, color: '#4caf50' },
  { level: 0.618, color: '#089981' },
  { level: 0.786, color: '#00bcd4' },
  { level: 1, color: '#787b86' },
];

export const FIB_EXTRA_LEVELS: readonly { level: number; color: string }[] = [
  { level: 1.272, color: '#81c784' },
  { level: 1.618, color: '#2962ff' },
  { level: 2, color: '#673ab7' },
  { level: 2.618, color: '#f23645' },
  { level: 3.618, color: '#9c27b0' },
  { level: 4.236, color: '#e91e63' },
];
export const FIB_CUSTOM_COLOR = '#787b86';
export const FIB_LEVEL_MIN = -5;
export const FIB_LEVEL_MAX = 10;
export const FIB_MAX_LEVELS = 24;

export const POSITION_TARGET_COLOR = '#089981';
export const POSITION_STOP_COLOR = '#f23645';
export const POSITION_FILL_ALPHA = 0.2;
export const POSITION_RISK_PX = 40;
export const POSITION_REWARD_RATIO = 2;
export const POSITION_BARS = 20;

export const TEXT_SIZES = [12, 14, 16, 20, 24, 28] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = 14;
export const TEXT_MAX_LENGTH = 500;

// ---- Pixel space (what hit-testing works on) ------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/**
 * A drawing projected to pixels (pane coordinates, CSS px). Built by the renderer from the
 * anchors with coords.ts + the series' priceToCoordinate.
 */
export type PixelShape =
  | { type: 'hline'; y: number }
  | { type: 'hray'; a: Point }
  | { type: 'vline'; x: number }
  | { type: 'trendline'; a: Point; b: Point }
  | { type: 'rect'; a: Point; b: Point }
  /**
   * levelYs[i] is the y of fibLevelsOf(d)[i]; lines span min(a.x,b.x)..max(a.x,b.x), or to
   * `extendTo` (the pane's right edge) when the fib is extended.
   */
  | { type: 'fib'; a: Point; b: Point; levelYs: number[]; extendTo?: number }
  | { type: PositionSide; a: Point; x1: number; stopY: number; targetY: number }
  | { type: 'text'; a: Point; w: number; h: number };

/** Which part was hit: an anchor handle (drag that anchor) or the body (move the whole drawing). */
export type HitPart = 'a' | 'b' | 'body' | 'stop' | 'target' | 'end';

export interface Hit {
  id: string;
  part: HitPart;
}

/** Hit tolerance in CSS px for lines and areas. */
export const HIT_TOLERANCE = 6;
/** Hit tolerance in CSS px for anchor handles (bigger: they are small targets you aim for). */
export const HANDLE_TOLERANCE = 10;

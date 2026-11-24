// Time <-> x for times that need not match a bar (T4.1).
//
// Why not the library: in lightweight-charts 5.3, timeScale().timeToCoordinate() returns null
// for a time with no bar, logicalToCoordinate() returns 0 for a non-integer logical index, and
// coordinateToLogical() rounds up to an integer. So we map time -> fractional logical index
// ourselves, and logical -> x linearly from the x of logical 0 and 1 (which are integers).

/** The two library calls we use (both with integer logical indexes only). */
export interface ScaleLike {
  logicalToCoordinate(logical: number): number | null;
}

/**
 * Fractional logical index of `time` given ascending bar times.
 * - exactly a bar time -> its index
 * - between bars i and i+1 -> i + (time - t[i]) / (t[i+1] - t[i])
 * - before the first / after the last bar -> extrapolated with `intervalSec` per bar
 * - no bars -> null
 */
export function timeToLogical(time: number, times: number[], intervalSec: number): number | null {
  void time;
  void times;
  void intervalSec;
  throw new Error('not implemented');
}

/** Inverse of timeToLogical; result rounded to whole seconds. null when there are no bars. */
export function logicalToTime(
  logical: number,
  times: number[],
  intervalSec: number,
): number | null {
  void logical;
  void times;
  void intervalSec;
  throw new Error('not implemented');
}

/** x of a fractional logical index; null when the scale has no data. */
export function logicalToX(scale: ScaleLike, logical: number): number | null {
  void scale;
  void logical;
  throw new Error('not implemented');
}

/** Fractional logical index at x; null when the scale has no data. */
export function xToLogical(scale: ScaleLike, x: number): number | null {
  void scale;
  void x;
  throw new Error('not implemented');
}

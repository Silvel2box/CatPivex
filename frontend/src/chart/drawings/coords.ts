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
  const n = times.length;
  if (n === 0) return null;
  const first = times[0];
  const lastIdx = n - 1;
  const last = times[lastIdx];
  if (time <= first) return (time - first) / intervalSec;
  if (time >= last) return lastIdx + (time - last) / intervalSec;
  // Largest i with times[i] <= time (exists and is < lastIdx because first < time < last).
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - times[lo]) / (times[lo + 1] - times[lo]);
}

/** Inverse of timeToLogical; result rounded to whole seconds. null when there are no bars. */
export function logicalToTime(
  logical: number,
  times: number[],
  intervalSec: number,
): number | null {
  const n = times.length;
  if (n === 0) return null;
  const lastIdx = n - 1;
  if (logical <= 0) return Math.round(times[0] + logical * intervalSec);
  if (logical >= lastIdx) return Math.round(times[lastIdx] + (logical - lastIdx) * intervalSec);
  const i = Math.floor(logical);
  return Math.round(times[i] + (logical - i) * (times[i + 1] - times[i]));
}

/** x of logical 0 and the px per bar, from two integer calls; null when the scale has no data. */
function frame(scale: ScaleLike): { x0: number; spacing: number } | null {
  const x0 = scale.logicalToCoordinate(0);
  const x1 = scale.logicalToCoordinate(1);
  if (x0 === null || x1 === null || x1 === x0) return null;
  return { x0, spacing: x1 - x0 };
}

/** x of a fractional logical index; null when the scale has no data. */
export function logicalToX(scale: ScaleLike, logical: number): number | null {
  const f = frame(scale);
  return f && f.x0 + logical * f.spacing;
}

/** Fractional logical index at x; null when the scale has no data. */
export function xToLogical(scale: ScaleLike, x: number): number | null {
  const f = frame(scale);
  return f && (x - f.x0) / f.spacing;
}

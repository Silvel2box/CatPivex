import { describe, expect, it } from 'vitest';
import { INTERVAL_SECONDS } from '../../api/types';
import { logicalToTime, logicalToX, timeToLogical, xToLogical, type ScaleLike } from './coords';

const DAY = INTERVAL_SECONDS['1D'];
const HOUR = 3600;
// Mon 2026-11-02 00:00 UTC.
const MON = Date.UTC(2026, 10, 2) / 1000;
/** Mon..Fri, then Mon..Fri of the next week (weekend gap between index 4 and 5). */
const STOCK_DAYS = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((d) => MON + d * DAY);
/** 10 contiguous daily bars. */
const DAILY = Array.from({ length: 10 }, (_, i) => MON + i * DAY);

/**
 * Like lightweight-charts 5.3's timeScale(): x = x0 + logical * spacing, but only for integer
 * logicals — a non-integer returns 0, exactly as _internal_indexToCoordinate does.
 */
function fakeScale(x0: number, spacing: number): ScaleLike & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    logicalToCoordinate(logical: number) {
      calls.push(logical);
      return Number.isInteger(logical) ? x0 + logical * spacing : 0;
    },
  };
}

const nullScale: ScaleLike = { logicalToCoordinate: () => null };

describe('T4.1 coords: timeToLogical / logicalToTime', () => {
  it('maps exact bar times to their index', () => {
    STOCK_DAYS.forEach((t, i) => {
      expect(timeToLogical(t, STOCK_DAYS, DAY)).toBe(i);
      expect(logicalToTime(i, STOCK_DAYS, DAY)).toBe(t);
    });
  });

  it('13:00 UTC on 1D bars -> i + 13/24', () => {
    for (let i = 0; i < DAILY.length - 1; i++) {
      expect(timeToLogical(DAILY[i] + 13 * HOUR, DAILY, DAY)).toBeCloseTo(i + 13 / 24, 12);
    }
  });

  it('interpolates across a weekend gap by the real neighbours, not intervalSec', () => {
    // Fri (idx 4) 00:00 -> Mon (idx 5) 00:00 is 3 days; Sat 12:00 is 1.5 days in = half way.
    const sat12 = MON + 5 * DAY + 12 * HOUR;
    expect(timeToLogical(sat12, STOCK_DAYS, DAY)).toBeCloseTo(4.5, 12);
    // Fri 12:00 = 0.5 day of 3 -> 4 + 1/6.
    expect(timeToLogical(MON + 4 * DAY + 12 * HOUR, STOCK_DAYS, DAY)).toBeCloseTo(4 + 1 / 6, 12);
    expect(logicalToTime(4.5, STOCK_DAYS, DAY)).toBe(sat12);
  });

  it('extrapolates with intervalSec before the first and after the last bar', () => {
    const first = STOCK_DAYS[0];
    const last = STOCK_DAYS[STOCK_DAYS.length - 1];
    const lastIdx = STOCK_DAYS.length - 1;
    expect(timeToLogical(first - 2 * DAY, STOCK_DAYS, DAY)).toBe(-2);
    expect(timeToLogical(first - 6 * HOUR, STOCK_DAYS, DAY)).toBeCloseTo(-0.25, 12);
    expect(timeToLogical(last + 3 * DAY, STOCK_DAYS, DAY)).toBe(lastIdx + 3);
    expect(timeToLogical(last + 13 * HOUR, STOCK_DAYS, DAY)).toBeCloseTo(lastIdx + 13 / 24, 12);
    expect(logicalToTime(-2, STOCK_DAYS, DAY)).toBe(first - 2 * DAY);
    expect(logicalToTime(lastIdx + 3.5, STOCK_DAYS, DAY)).toBe(last + 3.5 * DAY);
    // A single bar: everything is extrapolation.
    expect(timeToLogical(MON + 90, [MON], 60)).toBe(1.5);
    expect(logicalToTime(1.5, [MON], 60)).toBe(MON + 90);
  });

  it('round-trips logicalToTime(timeToLogical(t)) === t for many times', () => {
    const series: [number[], number][] = [
      [STOCK_DAYS, DAY],
      [DAILY, DAY],
      [Array.from({ length: 50 }, (_, i) => 1_700_000_000 + i * 60), 60],
      [[MON], INTERVAL_SECONDS['1W']],
    ];
    for (const [times, sec] of series) {
      const from = times[0] - 5 * sec;
      const to = times[times.length - 1] + 5 * sec;
      const step = Math.max(1, Math.floor((to - from) / 997)); // odd step hits non-bar times
      for (let t = from; t <= to; t += step) {
        const l = timeToLogical(t, times, sec);
        expect(l).not.toBeNull();
        expect(logicalToTime(l as number, times, sec)).toBe(t);
      }
    }
  });

  it('logicalToTime rounds to whole seconds', () => {
    expect(logicalToTime(0.3, [0, 10], 10)).toBe(3);
    expect(logicalToTime(1 / 3, [0, 10], 10)).toBe(3);
  });

  it('returns null with no bars', () => {
    expect(timeToLogical(MON, [], DAY)).toBeNull();
    expect(logicalToTime(0, [], DAY)).toBeNull();
  });
});

describe('T4.1 coords: logicalToX / xToLogical', () => {
  it('interpolates fractional logicals using integer-only library calls', () => {
    const scale = fakeScale(100, 8);
    expect(logicalToX(scale, 0)).toBe(100);
    expect(logicalToX(scale, 3)).toBe(124);
    expect(logicalToX(scale, 3.5)).toBe(128);
    expect(logicalToX(scale, 4 + 13 / 24)).toBeCloseTo(100 + (4 + 13 / 24) * 8, 9);
    expect(logicalToX(scale, -2.25)).toBe(82);
    expect(scale.calls.every((l) => Number.isInteger(l))).toBe(true);
  });

  it('xToLogical is the inverse, fractional (not rounded up)', () => {
    const scale = fakeScale(100, 8);
    expect(xToLogical(scale, 128)).toBe(3.5);
    expect(xToLogical(scale, 101)).toBe(0.125);
    expect(xToLogical(scale, 82)).toBe(-2.25);
    for (const l of [-7.3, -0.5, 0, 0.01, 2.75, 999.999]) {
      expect(xToLogical(scale, logicalToX(scale, l) as number)).toBeCloseTo(l, 9);
    }
    expect(scale.calls.every((l) => Number.isInteger(l))).toBe(true);
  });

  it('works with a negative x of logical 0 (scrolled far right)', () => {
    const scale = fakeScale(-5000, 2.5);
    expect(logicalToX(scale, 2000.4)).toBeCloseTo(1, 9);
    expect(xToLogical(scale, 1)).toBeCloseTo(2000.4, 9);
  });

  it('returns null when the scale has no data', () => {
    expect(logicalToX(nullScale, 1.5)).toBeNull();
    expect(xToLogical(nullScale, 10)).toBeNull();
  });
});

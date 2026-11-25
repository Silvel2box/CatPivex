import { describe, expect, it } from 'vitest';
import {
  MEASURE_DOWN_COLOR,
  MEASURE_UP_COLOR,
  formatDuration,
  measureColor,
  measureLines,
  measureStats,
} from './measure';

const H = 3600;
const T0 = Date.UTC(2026, 10, 2) / 1000;
/** Hourly bars with a 3 h gap between index 4 and 5 (like a market break). */
const TIMES = [0, 1, 2, 3, 4, 8, 9, 10].map((i) => T0 + i * H);
const fmt = (p: number) => p.toLocaleString('en-US', { minimumFractionDigits: 2 });

describe('T6.2 measureStats', () => {
  it('up: positive diff and percent; bars and seconds between two bars', () => {
    const s = measureStats(
      { time: TIMES[1], price: 100 },
      { time: TIMES[3], price: 125 },
      TIMES,
      H,
    );
    expect(s).toEqual({ diff: 25, percent: 25, bars: 2, seconds: 2 * H });
  });

  it('down: negative diff and percent', () => {
    const s = measureStats(
      { time: TIMES[0], price: 200 },
      { time: TIMES[1], price: 150 },
      TIMES,
      H,
    );
    expect(s.diff).toBe(-50);
    expect(s.percent).toBe(-25);
  });

  it('start price 0: no percent', () => {
    const s = measureStats({ time: TIMES[0], price: 0 }, { time: TIMES[1], price: 5 }, TIMES, H);
    expect(s.percent).toBeNull();
  });

  it('bars count logical indexes, not hours: a market gap is one bar', () => {
    const s = measureStats({ time: TIMES[4], price: 1 }, { time: TIMES[5], price: 1 }, TIMES, H);
    expect(s.bars).toBe(1);
    expect(s.seconds).toBe(4 * H);
  });

  it('points between bars round to the nearest whole bar count', () => {
    const s = measureStats(
      { time: TIMES[0] + H / 4, price: 1 },
      { time: TIMES[3] - H / 4, price: 1 },
      TIMES,
      H,
    );
    expect(s.bars).toBe(3);
  });

  it('beyond the loaded data: extrapolated with the interval', () => {
    const s = measureStats(
      { time: TIMES[0] - 5 * H, price: 1 },
      { time: TIMES.at(-1)! + 3 * H, price: 1 },
      TIMES,
      H,
    );
    expect(s.bars).toBe(5 + 7 + 3);
  });

  it('leftwards: negative bars, positive duration', () => {
    const s = measureStats({ time: TIMES[6], price: 1 }, { time: TIMES[2], price: 1 }, TIMES, H);
    expect(s.bars).toBe(-4);
    expect(s.seconds).toBe(7 * H);
  });

  it('no bars: 0 bars', () => {
    expect(measureStats({ time: 0, price: 1 }, { time: H, price: 1 }, [], H).bars).toBe(0);
  });
});

describe('T6.2 formatDuration', () => {
  it.each([
    [0, '0m'],
    [59 * 60, '59m'],
    [60 * 60, '1h'],
    [3 * H + 45 * 60, '3h 45m'],
    [23 * H + 59 * 60, '23h 59m'],
    [24 * H, '1d'],
    [24 * H + 30 * 60, '1d'],
    [2 * 24 * H + 4 * H + 15 * 60, '2d 4h'],
    [45 * 24 * H, '45d'],
    [89, '1m'],
  ])('%i s -> %s', (sec, text) => {
    expect(formatDuration(sec)).toBe(text);
  });
});

describe('T6.2 measureLines / measureColor', () => {
  it('up: explicit + signs, price via the formatter, plural bars', () => {
    const lines = measureLines(
      { diff: 1234.5, percent: 1.234, bars: 15, seconds: 3 * H + 45 * 60 },
      fmt,
    );
    expect(lines).toEqual(['+1,234.50 (+1.23%)', '15 bars, 3h 45m']);
  });

  it('down: minus signs on both numbers; one bar; leftwards bars keep their sign', () => {
    expect(measureLines({ diff: -0.0042, percent: -3.1, bars: 1, seconds: 60 }, String)).toEqual([
      '-0.0042 (-3.10%)',
      '1 bar, 1m',
    ]);
    expect(measureLines({ diff: 5, percent: 0.5, bars: -3, seconds: 3 * H }, String)[1]).toBe(
      '-3 bars, 3h',
    );
  });

  it('no percent when the start price is 0; zero change counts as up', () => {
    expect(measureLines({ diff: 5, percent: null, bars: 0, seconds: 0 }, String)[0]).toBe('+5');
    expect(measureLines({ diff: 0, percent: 0, bars: 0, seconds: 0 }, String)).toEqual([
      '+0 (+0.00%)',
      '0 bars, 0m',
    ]);
  });

  it('blue when the end price is not lower, red when it is', () => {
    const a = { time: 0, price: 10 };
    expect(measureColor(a, { time: 1, price: 11 })).toBe(MEASURE_UP_COLOR);
    expect(measureColor(a, { time: 1, price: 10 })).toBe(MEASURE_UP_COLOR);
    expect(measureColor(a, { time: 1, price: 9 })).toBe(MEASURE_DOWN_COLOR);
    expect(MEASURE_UP_COLOR).toBe('#2962ff');
    expect(MEASURE_DOWN_COLOR).toBe('#f23645');
  });
});

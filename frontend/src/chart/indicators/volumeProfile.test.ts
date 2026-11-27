import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import { candlesOf, FIXTURES } from './fixtures/load';
import { visibleBarRange, volumeProfile, type VolumeProfile } from './volumeProfile';

let t = 0;
const bar = (low: number, high: number, volume: number, up = true): Candle => ({
  time: ++t,
  open: up ? low : high,
  close: up ? high : low,
  low,
  high,
  volume,
});
const flat = (price: number, volume: number): Candle => ({
  time: ++t,
  open: price,
  close: price,
  low: price,
  high: price,
  volume,
});
const totals = (p: VolumeProfile) => p.rows.map((r) => r.up + r.down);

describe('volumeProfile: hand-checked cases', () => {
  it('empty input → null', () => {
    expect(volumeProfile([], 24, 70)).toBeNull();
  });

  it('single bar: volume spread evenly over the rows it spans', () => {
    const p = volumeProfile([bar(0, 10, 100)], 10, 70)!;
    expect(p.rows.map((r) => [r.low, r.high])).toEqual(
      Array.from({ length: 10 }, (_, j) => [j, j + 1]),
    );
    expect(p.rows.map((r) => r.up)).toEqual(Array(10).fill(10));
    expect(p.rows.map((r) => r.down)).toEqual(Array(10).fill(0));
  });

  it('POC tie → lowest row; VA grows upward when below is exhausted', () => {
    const p = volumeProfile([bar(0, 10, 100)], 10, 70)!;
    expect(p.poc).toBe(0);
    expect([p.vaLow, p.vaHigh]).toEqual([0, 6]);
  });

  it('partial overlap is split by the overlapping share of the bar range', () => {
    const p = volumeProfile([bar(0, 4, 40), bar(0.5, 1.5, 8, false), bar(2.25, 3.25, 4)], 4, 70)!;
    expect(p.rows.map((r) => r.up)).toEqual([10, 10, 13, 11]);
    expect(p.rows.map((r) => r.down)).toEqual([4, 4, 0, 0]);
  });

  it('up = close >= open (a doji counts as up), down = close < open', () => {
    const doji: Candle = { time: ++t, open: 5, close: 5, low: 0, high: 10, volume: 10 };
    const down: Candle = { time: ++t, open: 9, close: 1, low: 0, high: 10, volume: 20 };
    const p = volumeProfile([doji, down], 2, 70)!;
    expect(p.rows.map((r) => [r.up, r.down])).toEqual([
      [5, 10],
      [5, 10],
    ]);
  });

  it('flat bar: all volume in the row containing the price; the top row includes the max', () => {
    const p = volumeProfile([bar(0, 10, 10, false), flat(10, 5), flat(3, 7), flat(0, 2)], 10, 70)!;
    expect(p.rows.map((r) => r.down)).toEqual(Array(10).fill(1));
    expect(p.rows.map((r) => r.up)).toEqual([2, 0, 0, 7, 0, 0, 0, 0, 0, 5]);
  });

  it('every bar flat at one price → everything in the top row', () => {
    const p = volumeProfile([flat(7, 3), flat(7, 4)], 5, 70)!;
    expect(totals(p)).toEqual([0, 0, 0, 0, 7]);
    expect(p.rows.every((r) => r.low === 7 && r.high === 7)).toBe(true);
    expect([p.poc, p.vaLow, p.vaHigh]).toEqual([4, 4, 4]);
  });

  const ladder = (volumes: number[]) =>
    volumes.map((v, j) =>
      flat(j === 0 ? 0 : j === volumes.length - 1 ? volumes.length : j + 0.5, v),
    );

  it('POC = the max row; a tie goes to the lower row', () => {
    expect(volumeProfile(ladder([1, 3, 9, 2]), 4, 70)!.poc).toBe(2);
    expect(volumeProfile(ladder([5, 1, 5]), 3, 70)!.poc).toBe(0);
    expect(volumeProfile(ladder([1, 5, 2, 5]), 4, 70)!.poc).toBe(1);
  });

  it('VA adds the larger neighbour first; a tie goes above', () => {
    const tie = volumeProfile(ladder([1, 3, 5, 3, 1]), 5, 50)!;
    expect(totals(tie)).toEqual([1, 3, 5, 3, 1]);
    expect([tie.vaLow, tie.vaHigh]).toEqual([2, 3]);
    const larger = volumeProfile(ladder([1, 4, 5, 3, 1]), 5, 70)!;
    expect([larger.vaLow, larger.vaHigh]).toEqual([1, 3]);
  });

  it('VA takes the other side once one side is exhausted', () => {
    const top = volumeProfile(ladder([1, 2, 3, 4, 10]), 5, 90)!;
    expect(top.poc).toBe(4);
    expect([top.vaLow, top.vaHigh]).toEqual([1, 4]);
    const bottom = volumeProfile(ladder([10, 1, 4, 2, 3]), 5, 80)!;
    expect(bottom.poc).toBe(0);
    expect([bottom.vaLow, bottom.vaHigh]).toEqual([0, 3]);
  });

  it('VA stops as soon as it reaches the target (>=)', () => {
    const p = volumeProfile(ladder([2, 6, 2]), 3, 60)!;
    expect([p.vaLow, p.vaHigh]).toEqual([1, 1]);
  });
});

describe('visibleBarRange', () => {
  it('bars whose index lies in the logical range, clamped to the data', () => {
    expect(visibleBarRange({ from: -5.3, to: 3.7 }, 10)).toEqual({ from: 0, to: 3 });
    expect(visibleBarRange({ from: 2.2, to: 50 }, 10)).toEqual({ from: 3, to: 9 });
    expect(visibleBarRange({ from: 4, to: 6 }, 10)).toEqual({ from: 4, to: 6 });
    expect(visibleBarRange({ from: 12, to: 20 }, 10)).toBeNull();
    expect(visibleBarRange({ from: -8, to: -1 }, 10)).toBeNull();
    expect(visibleBarRange(null, 10)).toBeNull();
    expect(visibleBarRange({ from: 0, to: 5 }, 0)).toBeNull();
  });
});

describe('volumeProfile vs numpy fixtures', () => {
  const cases = FIXTURES.flatMap((f) => (f.volumeProfiles ?? []).map((c) => ({ f, c })));

  it('has the fixture cases, some with flat bars', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases.some(({ c }) => c.expected.flatBars > 0)).toBe(true);
  });

  for (const { f, c } of cases) {
    it(`${f.name} bars ${c.start}..${c.end}, ${c.rows} rows, VA ${c.valueAreaPct}% (${c.library})`, () => {
      const bars = candlesOf(f).slice(c.start, c.end + 1);
      const p = volumeProfile(bars, c.rows, c.valueAreaPct)!;
      const e = c.expected;
      expect(p.rows).toHaveLength(c.rows);
      const scale = Math.max(...e.up.map((u, j) => u + e.down[j]));
      const price = Math.max(...e.high);
      p.rows.forEach((r, j) => {
        expect(Math.abs(r.low - e.low[j]) / price).toBeLessThan(1e-12);
        expect(Math.abs(r.high - e.high[j]) / price).toBeLessThan(1e-12);
        expect(Math.abs(r.up - e.up[j]) / scale, `up ${j}`).toBeLessThan(1e-9);
        expect(Math.abs(r.down - e.down[j]) / scale, `down ${j}`).toBeLessThan(1e-9);
      });
      expect([p.poc, p.vaLow, p.vaHigh]).toEqual([e.poc, e.vaLow, e.vaHigh]);
      const volume = bars.reduce((s, b) => s + b.volume, 0);
      const sum = p.rows.reduce((s, r) => s + r.up + r.down, 0);
      expect(Math.abs(sum - volume) / volume).toBeLessThan(1e-9);
    });
  }
});

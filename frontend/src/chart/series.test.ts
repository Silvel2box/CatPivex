import { describe, expect, it } from 'vitest';
import type { Candle } from '../api/types';
import { applyRealtimeBar, prependBars } from './series';

const bar = (time: number, close = 1): Candle => ({
  time,
  open: 1,
  high: 1,
  low: 1,
  close,
  volume: 1,
});

describe('prependBars', () => {
  it('prepends only strictly older bars, deduped and sorted', () => {
    const result = prependBars([bar(300), bar(360)], [bar(180), bar(240), bar(240), bar(300)]);
    expect(result.added).toBe(2);
    expect(result.bars.map((b) => b.time)).toEqual([180, 240, 300, 360]);
  });

  it('reports 0 added when nothing is older', () => {
    expect(prependBars([bar(300)], [bar(300)]).added).toBe(0);
  });
});

describe('applyRealtimeBar', () => {
  it('replaces the last bar, appends newer, ignores older', () => {
    const bars = [bar(60), bar(120)];
    expect(applyRealtimeBar(bars, bar(120, 5))).toBe(true);
    expect(bars[1].close).toBe(5);
    expect(applyRealtimeBar(bars, bar(180))).toBe(true);
    expect(bars).toHaveLength(3);
    expect(applyRealtimeBar(bars, bar(60))).toBe(false);
    expect(bars).toHaveLength(3);
  });
});

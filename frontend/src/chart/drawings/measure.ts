import { timeToLogical } from './coords';
import type { Anchor } from './types';

export const MEASURE_UP_COLOR = '#2962ff';
export const MEASURE_DOWN_COLOR = '#f23645';
export const MEASURE_FILL_ALPHA = 0.2;

export const measureColor = (a: Anchor, b: Anchor) =>
  b.price >= a.price ? MEASURE_UP_COLOR : MEASURE_DOWN_COLOR;

export interface MeasureStats {
  diff: number;
  /** null when the start price is 0. */
  percent: number | null;
  /** Negative when measuring leftwards. */
  bars: number;
  seconds: number;
}

export function measureStats(
  a: Anchor,
  b: Anchor,
  times: number[],
  intervalSec: number,
): MeasureStats {
  const la = timeToLogical(a.time, times, intervalSec);
  const lb = timeToLogical(b.time, times, intervalSec);
  const diff = b.price - a.price;
  return {
    diff,
    percent: a.price === 0 ? null : (diff / Math.abs(a.price)) * 100,
    bars: la === null || lb === null ? 0 : Math.round(lb - la),
    seconds: Math.abs(b.time - a.time),
  };
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const signed = (v: number, text: string) => `${v < 0 ? '-' : '+'}${text}`;

export function measureLines(s: MeasureStats, formatPrice: (p: number) => string): string[] {
  const pct = s.percent === null ? '' : ` (${signed(s.percent, Math.abs(s.percent).toFixed(2))}%)`;
  const bars = `${s.bars} ${Math.abs(s.bars) === 1 ? 'bar' : 'bars'}`;
  return [
    `${signed(s.diff, formatPrice(Math.abs(s.diff)))}${pct}`,
    `${bars}, ${formatDuration(s.seconds)}`,
  ];
}

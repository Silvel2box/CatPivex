import type { Candle } from '../../api/types';
import type { IndicatorCalc, Params } from './types';

export interface ProfileRow {
  low: number;
  high: number;
  up: number;
  down: number;
}

export interface VolumeProfile {
  rows: ProfileRow[];
  poc: number;
  vaLow: number;
  vaHigh: number;
}

export const noCalc: IndicatorCalc<Params, null> = {
  init: () => null,
  next: (state) => ({ state, out: null }),
};

export function visibleBarRange(
  range: { from: number; to: number } | null,
  length: number,
): { from: number; to: number } | null {
  if (!range || length === 0) return null;
  const from = Math.max(0, Math.ceil(range.from));
  const to = Math.min(length - 1, Math.floor(range.to));
  return from <= to ? { from, to } : null;
}

export function volumeProfile(
  bars: readonly Candle[],
  rowCount: number,
  valueAreaPct: number,
): VolumeProfile | null {
  if (bars.length === 0 || rowCount < 1) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    if (b.low < min) min = b.low;
    if (b.high > max) max = b.high;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const step = (max - min) / rowCount;
  const rows: ProfileRow[] = [];
  for (let j = 0; j < rowCount; j++) {
    rows.push({
      low: min + j * step,
      high: j === rowCount - 1 ? max : min + (j + 1) * step,
      up: 0,
      down: 0,
    });
  }
  const rowOf = (price: number) =>
    step > 0 ? Math.min(rowCount - 1, Math.floor((price - min) / step)) : rowCount - 1;

  for (const b of bars) {
    const volume = Number.isFinite(b.volume) ? b.volume : 0;
    if (volume === 0) continue;
    const key = b.close >= b.open ? 'up' : 'down';
    const span = b.high - b.low;
    if (span === 0) {
      rows[rowOf(b.low)][key] += volume;
      continue;
    }
    const j0 = Math.max(0, rowOf(b.low) - 1);
    const j1 = Math.min(rowCount - 1, rowOf(b.high) + 1);
    for (let j = j0; j <= j1; j++) {
      const r = rows[j];
      const overlap = Math.min(b.high, r.high) - Math.max(b.low, r.low);
      if (overlap > 0) r[key] += (volume * overlap) / span;
    }
  }

  const totals = rows.map((r) => r.up + r.down);
  let poc = 0;
  for (let j = 1; j < rowCount; j++) if (totals[j] > totals[poc]) poc = j;

  let total = 0;
  for (const t of totals) total += t;
  const target = (total * valueAreaPct) / 100;
  let vaLow = poc;
  let vaHigh = poc;
  let sum = totals[poc];
  while (sum < target) {
    const canUp = vaHigh + 1 < rowCount;
    const canDown = vaLow > 0;
    if (!canUp && !canDown) break;
    if (canUp && (!canDown || totals[vaHigh + 1] >= totals[vaLow - 1])) {
      vaHigh++;
      sum += totals[vaHigh];
    } else {
      vaLow--;
      sum += totals[vaLow];
    }
  }
  return { rows, poc, vaLow, vaHigh };
}

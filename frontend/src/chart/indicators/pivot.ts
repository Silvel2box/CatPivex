import type { Interval } from '../../api/types';
import type { BarValues, IndicatorCalc, Params } from './types';

export type PivotTimeframe = 'day' | 'week' | 'month';

interface Hlc {
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface PivotState {
  readonly kind: number;
  readonly timeframe: PivotTimeframe;
  readonly barDate: (time: number) => string;
  readonly keys: readonly string[];
  readonly hlc: readonly Hlc[];
}

const DAY_MS = 86_400_000;
const TIMEFRAMES: Record<number, PivotTimeframe> = { 1: 'day', 2: 'week', 3: 'month' };

export function autoTimeframe(interval: Interval | undefined): PivotTimeframe {
  if (interval === '1h' || interval === '4h') return 'week';
  if (interval === '1D' || interval === '1W') return 'month';
  return 'day';
}

const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);

/** `yyyy-mm-dd` → day `yyyy-mm-dd`, ISO week `yyyy-Www`, or month `yyyy-mm` (all sort as strings). */
export function periodKey(date: string, timeframe: PivotTimeframe): string {
  if (timeframe === 'day') return date;
  if (timeframe === 'month') return date.slice(0, 7);
  const d = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function previousIndex(keys: readonly string[], key: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function pivotLevels(kind: number, { high: H, low: L, close: C }: Hlc): BarValues {
  const P = (H + L + C) / 3;
  const r = H - L;
  if (kind === 1) {
    return {
      P,
      R1: P + 0.382 * r,
      S1: P - 0.382 * r,
      R2: P + 0.618 * r,
      S2: P - 0.618 * r,
      R3: P + r,
      S3: P - r,
    };
  }
  if (kind === 2) {
    const k = 1.1 * r;
    return {
      P,
      R1: C + k / 12,
      S1: C - k / 12,
      R2: C + k / 6,
      S2: C - k / 6,
      R3: C + k / 4,
      S3: C - k / 4,
      R4: C + k / 2,
      S4: C - k / 2,
    };
  }
  return {
    P,
    R1: 2 * P - L,
    S1: 2 * P - H,
    R2: P + r,
    S2: P - r,
    R3: H + 2 * (P - L),
    S3: L - 2 * (H - P),
  };
}

export const pivotCalc: IndicatorCalc<Params, PivotState> = {
  init(params, ctx) {
    const timeframe = TIMEFRAMES[params.timeframe] ?? autoTimeframe(ctx.interval);
    const daily = ctx.interval === '1D' || ctx.interval === '1W';
    const groups = new Map<string, Hlc>();
    for (const c of ctx.daily ?? []) {
      const key = periodKey(utcDate(c.time), timeframe);
      const g = groups.get(key);
      groups.set(
        key,
        g
          ? { high: Math.max(g.high, c.high), low: Math.min(g.low, c.low), close: c.close }
          : { high: c.high, low: c.low, close: c.close },
      );
    }
    const keys = [...groups.keys()].sort();
    return {
      kind: params.kind,
      timeframe,
      barDate: daily ? utcDate : (time) => ctx.dayKey(time),
      keys,
      hlc: keys.map((k) => groups.get(k)!),
    };
  },
  next(state, candle) {
    const i = previousIndex(state.keys, periodKey(state.barDate(candle.time), state.timeframe));
    return { state, out: i < 0 ? null : pivotLevels(state.kind, state.hlc[i]) };
  },
};

import {
  POSITION_BARS,
  POSITION_REWARD_RATIO,
  POSITION_RISK_PX,
  type Anchor,
  type Drawing,
  type HitPart,
  type PositionSide,
} from './types';

export type PositionDrawing = Extract<Drawing, { type: PositionSide }>;

export const POSITION_GAP_RATIO = 1e-4;
export const POSITION_MIN_SECONDS = 1;

export function positionGap(price: number): number {
  return Math.max(Math.abs(price) * POSITION_GAP_RATIO, 1e-9);
}

export function positionDefaults(
  side: PositionSide,
  entry: Anchor,
  pricePerPx: number,
  intervalSec: number,
): { end: number; stop: number; target: number } {
  const perPx =
    Number.isFinite(pricePerPx) && pricePerPx > 0
      ? pricePerPx
      : (Math.abs(entry.price) * 0.01 || 1) / POSITION_RISK_PX;
  const risk = POSITION_RISK_PX * perPx;
  const dir = side === 'long' ? 1 : -1;
  const bar = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 60;
  return {
    end: Math.round(entry.time + POSITION_BARS * bar),
    stop: entry.price - dir * risk,
    target: entry.price + dir * POSITION_REWARD_RATIO * risk,
  };
}

export function positionValid(d: PositionDrawing): boolean {
  const { a, end, stop, target } = d;
  if (![a.time, a.price, end, stop, target].every(Number.isFinite)) return false;
  if (!(end > a.time)) return false;
  return d.type === 'long'
    ? stop < a.price && a.price < target
    : target < a.price && a.price < stop;
}

export interface PositionStats {
  risk: number;
  reward: number;
  rr: number;
  targetPct: number;
  stopPct: number;
}

export function positionStats(d: PositionDrawing): PositionStats {
  const entry = d.a.price;
  const dir = d.type === 'long' ? 1 : -1;
  const risk = Math.abs(entry - d.stop);
  const reward = Math.abs(d.target - entry);
  const pct = (p: number) => (entry === 0 ? 0 : ((dir * (p - entry)) / Math.abs(entry)) * 100);
  return {
    risk,
    reward,
    rr: risk === 0 ? 0 : reward / risk,
    targetPct: pct(d.target),
    stopPct: pct(d.stop),
  };
}

export interface PositionLabels {
  target: string;
  stop: string;
  rr: string;
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export function positionLabels(d: PositionDrawing, format: (p: number) => string): PositionLabels {
  const s = positionStats(d);
  return {
    target: `Target: ${format(d.target)} (${signed(s.targetPct)})`,
    stop: `Stop: ${format(d.stop)} (${signed(s.stopPct)})`,
    rr: `R:R ${s.rr.toFixed(2)}`,
  };
}

export function movePosition(
  d: PositionDrawing,
  part: HitPart,
  delta: { dTime: number; dPrice: number },
  to: Anchor,
): PositionDrawing {
  const long = d.type === 'long';
  const entry = d.a.price;
  let next: PositionDrawing;
  switch (part) {
    case 'body': {
      const time = Math.round(d.a.time + delta.dTime);
      next = {
        ...d,
        a: { time, price: entry + delta.dPrice },
        end: d.end + (time - d.a.time),
        stop: d.stop + delta.dPrice,
        target: d.target + delta.dPrice,
      };
      break;
    }
    case 'a': {
      const time = Math.round(to.time);
      const low = long ? d.stop : d.target;
      const high = long ? d.target : d.stop;
      const lo = low + positionGap(low);
      const hi = high - positionGap(high);
      const price = lo <= hi ? Math.min(Math.max(to.price, lo), hi) : entry;
      next = { ...d, a: { time, price }, end: d.end + (time - d.a.time) };
      break;
    }
    case 'stop': {
      const g = positionGap(entry);
      next = {
        ...d,
        a: { ...d.a },
        stop: long ? Math.min(to.price, entry - g) : Math.max(to.price, entry + g),
      };
      break;
    }
    case 'target': {
      const g = positionGap(entry);
      next = {
        ...d,
        a: { ...d.a },
        target: long ? Math.max(to.price, entry + g) : Math.min(to.price, entry - g),
      };
      break;
    }
    case 'end':
      next = {
        ...d,
        a: { ...d.a },
        end: Math.max(Math.round(to.time), d.a.time + POSITION_MIN_SECONDS),
      };
      break;
    default:
      return { ...d, a: { ...d.a } };
  }
  return positionValid(next) ? next : { ...d, a: { ...d.a } };
}

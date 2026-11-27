import { describe, expect, it } from 'vitest';
import { alertLevel, hitTestAll, hitTestShape, moveDrawing, sanitizeDrawings } from './geometry';
import {
  movePosition,
  positionDefaults,
  positionGap,
  positionLabels,
  positionStats,
  positionValid,
  type PositionDrawing,
} from './position';
import {
  HANDLE_TOLERANCE,
  HIT_TOLERANCE,
  POSITION_BARS,
  POSITION_REWARD_RATIO,
  POSITION_RISK_PX,
  type Drawing,
  type PixelShape,
} from './types';

const TOL = HIT_TOLERANCE;
const fmt = (p: number) => p.toFixed(2);

const long: PositionDrawing = {
  id: 'p',
  type: 'long',
  color: '#787b86',
  width: 1,
  a: { time: 1000, price: 100 },
  end: 2200,
  stop: 95,
  target: 110,
};
const short: PositionDrawing = { ...long, id: 's', type: 'short', stop: 104, target: 92 };

const at = (time: number, price: number) => ({ time, price });
const none = { dTime: 0, dPrice: 0 };

describe('T8.A positionDefaults', () => {
  it('long: stop RISK_PX below, target REWARD_RATIO x risk above, end BARS bars right', () => {
    const d = positionDefaults('long', at(1000, 100), 0.25, 60);
    const risk = POSITION_RISK_PX * 0.25;
    expect(d.stop).toBeCloseTo(100 - risk, 10);
    expect(d.target).toBeCloseTo(100 + POSITION_REWARD_RATIO * risk, 10);
    expect(d.end).toBe(1000 + POSITION_BARS * 60);
  });

  it('short: stop above, target below', () => {
    const d = positionDefaults('short', at(1000, 100), 0.25, 300);
    expect(d.stop).toBeCloseTo(110, 10);
    expect(d.target).toBeCloseTo(80, 10);
    expect(d.end).toBe(1000 + POSITION_BARS * 300);
  });

  it('falls back to a valid position without a usable scale or interval', () => {
    for (const side of ['long', 'short'] as const) {
      for (const [ppx, iv] of [
        [0, 0],
        [NaN, -5],
        [Infinity, NaN],
      ]) {
        const d = { ...long, type: side, ...positionDefaults(side, at(1000, 100), ppx, iv) };
        expect(positionValid(d)).toBe(true);
        expect(Math.abs(d.target - 100)).toBeCloseTo(
          POSITION_REWARD_RATIO * Math.abs(100 - d.stop),
          10,
        );
        expect(d.end).toBeGreaterThan(1000);
      }
    }
  });
});

describe('T8.A positionStats / labels', () => {
  it('long: risk, reward, R:R and % from entry', () => {
    const s = positionStats(long);
    expect(s.risk).toBe(5);
    expect(s.reward).toBe(10);
    expect(s.rr).toBe(2);
    expect(s.targetPct).toBeCloseTo(10, 10);
    expect(s.stopPct).toBeCloseTo(-5, 10);
  });

  it('short: target % positive, stop % negative (trader view)', () => {
    const s = positionStats(short);
    expect(s.risk).toBe(4);
    expect(s.reward).toBe(8);
    expect(s.rr).toBe(2);
    expect(s.targetPct).toBeCloseTo(8, 10);
    expect(s.stopPct).toBeCloseTo(-4, 10);
  });

  it('label strings use the formatter and 2 decimals', () => {
    expect(positionLabels(long, fmt)).toEqual({
      target: 'Target: 110.00 (+10.00%)',
      stop: 'Stop: 95.00 (-5.00%)',
      rr: 'R:R 2.00',
    });
    expect(positionLabels({ ...short, target: 90 }, fmt)).toEqual({
      target: 'Target: 90.00 (+10.00%)',
      stop: 'Stop: 104.00 (-4.00%)',
      rr: 'R:R 2.50',
    });
  });
});

describe('T8.A position hit-test', () => {
  const shape: PixelShape = {
    type: 'long',
    a: { x: 100, y: 200 },
    x1: 300,
    stopY: 240,
    targetY: 120,
  };
  const hit = (x: number, y: number) => hitTestShape(shape, x, y, TOL, HANDLE_TOLERANCE);

  it('handles: entry, target, stop at the left edge; end at the right edge on the entry line', () => {
    expect(hit(102, 201)).toBe('a');
    expect(hit(100, 122)).toBe('target');
    expect(hit(98, 238)).toBe('stop');
    expect(hit(297, 200)).toBe('end');
  });

  it('body: anywhere in the box plus tolerance, nothing outside', () => {
    expect(hit(200, 150)).toBe('body');
    expect(hit(200, 230)).toBe('body');
    expect(hit(300 + TOL, 130)).toBe('body');
    expect(hit(200, 120 - TOL)).toBe('body');
    expect(hit(300 + TOL + 1, 130)).toBeNull();
    expect(hit(200, 240 + TOL + 1)).toBeNull();
    expect(hit(100 - TOL - 1, 160)).toBeNull();
  });

  it('short shape (target below) hits the same way', () => {
    const s: PixelShape = {
      type: 'short',
      a: { x: 100, y: 200 },
      x1: 300,
      stopY: 160,
      targetY: 280,
    };
    expect(hitTestShape(s, 100, 282, TOL, HANDLE_TOLERANCE)).toBe('target');
    expect(hitTestShape(s, 100, 158, TOL, HANDLE_TOLERANCE)).toBe('stop');
    expect(hitTestShape(s, 250, 270, TOL, HANDLE_TOLERANCE)).toBe('body');
    expect(hitTestShape(s, 250, 300, TOL, HANDLE_TOLERANCE)).toBeNull();
  });

  it('a collapsed edge handle wins over the entry handle so it can be pulled out again', () => {
    const c: PixelShape = {
      type: 'long',
      a: { x: 100, y: 200 },
      x1: 100,
      stopY: 200,
      targetY: 120,
    };
    expect(hitTestShape(c, 100, 200, TOL, HANDLE_TOLERANCE)).toBe('end');
    const c2: PixelShape = { ...c, x1: 300 };
    expect(hitTestShape(c2, 100, 200, TOL, HANDLE_TOLERANCE)).toBe('stop');
  });

  it('hitTestAll reports the position id and part', () => {
    expect(hitTestAll([{ id: 'p', shape }], 100, 120, TOL, HANDLE_TOLERANCE)).toEqual({
      id: 'p',
      part: 'target',
    });
  });
});

describe('T8.A moveDrawing on a position', () => {
  it('body moves times and all prices, keeping the width', () => {
    const m = moveDrawing(long, 'body', { dTime: 300.4, dPrice: 5 }, at(0, 0));
    expect(m).toEqual({ ...long, a: at(1300, 105), end: 2500, stop: 100, target: 115 });
  });

  it("'a' moves entry price and time, end shifts by the same dTime, stop/target stay", () => {
    const m = moveDrawing(long, 'a', none, at(1500.6, 102));
    expect(m).toEqual({ ...long, a: at(1501, 102), end: 2701 });
  });

  it("'stop' / 'target' / 'end' set only that value", () => {
    expect(moveDrawing(long, 'stop', none, at(9, 90))).toEqual({ ...long, stop: 90 });
    expect(moveDrawing(long, 'target', none, at(9, 130))).toEqual({ ...long, target: 130 });
    expect(moveDrawing(long, 'end', none, at(3000.4, 1))).toEqual({ ...long, end: 3000 });
    expect(moveDrawing(short, 'stop', none, at(9, 120))).toEqual({ ...short, stop: 120 });
    expect(moveDrawing(short, 'target', none, at(9, 50))).toEqual({ ...short, target: 50 });
  });

  it('long: stop / target dragged past the entry stop just short of it', () => {
    const g = positionGap(100);
    expect(moveDrawing(long, 'stop', none, at(0, 120))).toEqual({ ...long, stop: 100 - g });
    expect(moveDrawing(long, 'target', none, at(0, 50))).toEqual({ ...long, target: 100 + g });
  });

  it('short: stop / target dragged past the entry stop just short of it', () => {
    const g = positionGap(100);
    expect(moveDrawing(short, 'stop', none, at(0, 50))).toEqual({ ...short, stop: 100 + g });
    expect(moveDrawing(short, 'target', none, at(0, 150))).toEqual({ ...short, target: 100 - g });
  });

  it("'a' clamps the entry between stop and target", () => {
    const up = moveDrawing(long, 'a', none, at(1000, 500)) as PositionDrawing;
    expect(up.a.price).toBe(110 - positionGap(110));
    const down = moveDrawing(long, 'a', none, at(1000, 1)) as PositionDrawing;
    expect(down.a.price).toBe(95 + positionGap(95));
    const s = moveDrawing(short, 'a', none, at(1000, 500)) as PositionDrawing;
    expect(s.a.price).toBe(104 - positionGap(104));
    expect(positionValid(up) && positionValid(down) && positionValid(s)).toBe(true);
  });

  it("'end' dragged left of the entry stops one second right of it", () => {
    expect(moveDrawing(long, 'end', none, at(10, 0))).toEqual({ ...long, end: 1001 });
  });

  it('every result keeps the invariant and never mutates the input', () => {
    const before = JSON.stringify([long, short]);
    for (const d of [long, short]) {
      for (const part of ['a', 'b', 'body', 'stop', 'target', 'end'] as const) {
        for (const to of [at(-1e9, -1e9), at(1e9, 1e9), at(1000, 100), at(1500, 97)]) {
          const m = movePosition(d, part, { dTime: -500, dPrice: 3 }, to);
          expect(positionValid(m)).toBe(true);
          expect(m.a).not.toBe(d.a);
        }
      }
    }
    expect(JSON.stringify([long, short])).toBe(before);
  });

  it('carries no alert', () => {
    expect(alertLevel(long, long.a.time)).toBeNull();
    expect(alertLevel(short, short.a.time)).toBeNull();
  });
});

describe('T8.A sanitizeDrawings for positions', () => {
  it('keeps valid long / short, rounding times and stripping unknown fields', () => {
    const raw = [
      { ...long, a: { time: 1000.4, price: 100 }, end: 2199.6, extra: 1 },
      { ...short, b: { time: 1, price: 1 } },
    ];
    expect(sanitizeDrawings(raw)).toEqual([long, short]);
  });

  it('drops a position with a missing / non-finite number or a broken invariant', () => {
    const bad: unknown[] = [
      { ...long, stop: undefined },
      { ...long, target: 'x' },
      { ...long, end: Infinity },
      { ...long, a: { time: 1000, price: NaN } },
      { ...long, a: undefined },
      { ...long, stop: 100 },
      { ...long, stop: 105 },
      { ...long, target: 99 },
      { ...long, end: 1000 },
      { ...long, end: 900 },
      { ...short, stop: 95 },
      { ...short, target: 100 },
      { ...short, target: 101 },
      { ...long, color: 'red' },
    ];
    for (const b of bad) expect(sanitizeDrawings([b])).toEqual([]);
  });

  it('a long with short-shaped prices is dropped, not reinterpreted', () => {
    const asLong = { ...short, type: 'long' } as Drawing;
    expect(sanitizeDrawings([asLong])).toEqual([]);
  });
});

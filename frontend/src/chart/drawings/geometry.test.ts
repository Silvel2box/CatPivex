import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import {
  fibPrices,
  hitTestAll,
  hitTestShape,
  magnetSnap,
  moveDrawing,
  sanitizeDrawings,
} from './geometry';
import { FIB_LEVELS, HIT_TOLERANCE, type Drawing, type PixelShape } from './types';

const TOL = HIT_TOLERANCE;

const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe('T4.2 magnet', () => {
  const bars = [
    candle(100, 10, 15, 5, 12),
    candle(160, 20, 25, 18, 22),
    candle(220, 30, 40, 28, 35),
  ];

  it('snaps to the bar nearest in time', () => {
    expect(magnetSnap({ time: 125, price: 10 }, bars, true).time).toBe(100);
    expect(magnetSnap({ time: 135, price: 20 }, bars, true).time).toBe(160);
    expect(magnetSnap({ time: 160, price: 20 }, bars, true).time).toBe(160);
    expect(magnetSnap({ time: -999, price: 10 }, bars, true).time).toBe(100);
    expect(magnetSnap({ time: 9999, price: 30 }, bars, true).time).toBe(220);
  });

  it('on a time tie picks the earlier bar', () => {
    expect(magnetSnap({ time: 130, price: 0 }, bars, true).time).toBe(100);
    expect(magnetSnap({ time: 190, price: 0 }, bars, true).time).toBe(160);
  });

  it('snaps to the nearest of open/high/low/close', () => {
    // bar 160: O20 H25 L18 C22
    expect(magnetSnap({ time: 160, price: 19.9 }, bars, true)).toEqual({ time: 160, price: 20 });
    expect(magnetSnap({ time: 160, price: 30 }, bars, true)).toEqual({ time: 160, price: 25 });
    expect(magnetSnap({ time: 160, price: 0 }, bars, true)).toEqual({ time: 160, price: 18 });
    expect(magnetSnap({ time: 160, price: 22.4 }, bars, true)).toEqual({ time: 160, price: 22 });
  });

  it('returns the input unchanged when disabled or with no bars', () => {
    const a = { time: 125, price: 13.3 };
    expect(magnetSnap(a, bars, false)).toBe(a);
    expect(magnetSnap(a, [], true)).toBe(a);
  });
});

/** A point `d` px from (x, y) in direction (ux, uy) (unit vector). */
const along = (x: number, y: number, ux: number, uy: number, d: number) =>
  [x + ux * d, y + uy * d] as const;

describe('T4.3 hit-test', () => {
  it('hline: within tol hits, just beyond misses (any x)', () => {
    const s: PixelShape = { type: 'hline', y: 100 };
    expect(hitTestShape(s, -5000, 100 + TOL, TOL)).toBe('body');
    expect(hitTestShape(s, 300, 100 - TOL, TOL)).toBe('body');
    expect(hitTestShape(s, 300, 100 + TOL + 0.5, TOL)).toBeNull();
  });

  it('vline: within tol hits, just beyond misses (any y)', () => {
    const s: PixelShape = { type: 'vline', x: 50 };
    expect(hitTestShape(s, 50 - TOL, 9999, TOL)).toBe('body');
    expect(hitTestShape(s, 50 + TOL + 0.5, 10, TOL)).toBeNull();
  });

  describe('trendline', () => {
    // 45° segment (0,0) -> (100,100); unit normal (1,-1)/√2.
    const s: PixelShape = { type: 'trendline', a: { x: 0, y: 0 }, b: { x: 100, y: 100 } };
    const n = Math.SQRT1_2;

    it('perpendicular distance: within tol hits, just beyond misses', () => {
      expect(hitTestShape(s, ...along(50, 50, n, -n, TOL - 0.1), TOL)).toBe('body');
      expect(hitTestShape(s, ...along(50, 50, n, -n, TOL + 0.1), TOL)).toBeNull();
    });

    it('is a segment, not an infinite line', () => {
      // On the extended line but past b.
      expect(hitTestShape(s, 130, 130, TOL)).toBeNull();
      expect(hitTestShape(s, -30, -30, TOL)).toBeNull();
    });

    it('anchors: within tol hits a / b, and beat the body', () => {
      expect(hitTestShape(s, 2, 1, TOL)).toBe('a'); // also on the body
      expect(hitTestShape(s, 100 + TOL, 100, TOL)).toBe('b');
      expect(hitTestShape(s, ...along(100, 100, n, n, TOL + 0.1), TOL)).toBeNull();
    });
  });

  describe('rect', () => {
    // b is top-left of a on purpose: order must not matter.
    const s: PixelShape = { type: 'rect', a: { x: 200, y: 150 }, b: { x: 100, y: 50 } };

    it('inside counts as body', () => {
      expect(hitTestShape(s, 150, 100, TOL)).toBe('body');
    });

    it('edges: within tol hits, just beyond misses', () => {
      expect(hitTestShape(s, 100 - TOL, 100, TOL)).toBe('body'); // left
      expect(hitTestShape(s, 100 - TOL - 0.5, 100, TOL)).toBeNull();
      expect(hitTestShape(s, 150, 150 + TOL, TOL)).toBe('body'); // bottom
      expect(hitTestShape(s, 150, 150 + TOL + 0.5, TOL)).toBeNull();
      // Outside a corner that is not an anchor (100,150): Euclidean distance.
      expect(hitTestShape(s, ...along(100, 150, -Math.SQRT1_2, Math.SQRT1_2, TOL - 0.1), TOL)).toBe(
        'body',
      );
      expect(
        hitTestShape(s, ...along(100, 150, -Math.SQRT1_2, Math.SQRT1_2, TOL + 0.1), TOL),
      ).toBeNull();
    });

    it('anchors beat the body', () => {
      expect(hitTestShape(s, 198, 148, TOL)).toBe('a'); // inside, near a
      expect(hitTestShape(s, 102, 52, TOL)).toBe('b');
      expect(hitTestShape(s, 200 + TOL + 0.5, 150, TOL)).toBeNull();
    });

    it('a and b at the same point: behaves as anchor a', () => {
      const p: PixelShape = { type: 'rect', a: { x: 10, y: 10 }, b: { x: 10, y: 10 } };
      expect(hitTestShape(p, 10 + TOL, 10, TOL)).toBe('a');
      expect(hitTestShape(p, 10 + TOL + 0.5, 10, TOL)).toBeNull();
    });
  });

  describe('fib', () => {
    // a (level 1) at y=0, b (level 0) at y=100, x span 100..300.
    const levelYs = FIB_LEVELS.map(({ level }) => 100 - 100 * level);
    const s: PixelShape = { type: 'fib', a: { x: 100, y: 0 }, b: { x: 300, y: 100 }, levelYs };

    it('the filled area between level 0 and level 1 is body, not just the lines', () => {
      // Between levels 0.236 (y 76.4) and 0 (y 100), far from any line and from the diagonal.
      expect(hitTestShape(s, 250, 88, TOL)).toBe('body');
      // Above level 1 (y 0) / below level 0 (y 100): within tol hits, beyond misses.
      expect(hitTestShape(s, 250, -TOL, TOL)).toBe('body');
      expect(hitTestShape(s, 250, -TOL - 0.5, TOL)).toBeNull();
      expect(hitTestShape(s, 150, 100 + TOL + 0.5, TOL)).toBeNull();
    });

    it('a level line only hits within its x span', () => {
      const y236 = levelYs[1];
      expect(hitTestShape(s, 120, y236, TOL)).toBe('body');
      expect(hitTestShape(s, 300 + TOL + 0.5, y236, TOL)).toBeNull();
      expect(hitTestShape(s, 100 - 40, y236, TOL)).toBeNull();
      expect(hitTestShape(s, 600, y236, TOL)).toBeNull();
    });

    it('the a–b diagonal is body', () => {
      // Diagonal y = (x - 100) / 2. At x = 130 it is y = 15; the nearest level lines are y = 21.4
      // and y = 0, both beyond tol, so these hits can only come from the diagonal.
      const len = Math.hypot(200, 100);
      const nx = -100 / len;
      const ny = 200 / len; // unit normal of the diagonal
      expect(hitTestShape(s, 130, 15, TOL)).toBe('body');
      expect(hitTestShape(s, ...along(130, 15, -nx, -ny, 2), TOL)).toBe('body');
      // With no level lines: within tol of the diagonal hits, just beyond misses.
      const bare: PixelShape = { ...s, levelYs: [] };
      expect(hitTestShape(bare, ...along(200, 50, nx, ny, TOL - 0.1), TOL)).toBe('body');
      expect(hitTestShape(bare, ...along(200, 50, nx, ny, TOL + 0.1), TOL)).toBeNull();
    });

    it('anchors beat the body', () => {
      expect(hitTestShape(s, 101, 1, TOL)).toBe('a'); // also on level 1 and the diagonal
      expect(hitTestShape(s, 299, 99, TOL)).toBe('b');
    });
  });

  it('hitTestAll returns the last shape that hits, or null', () => {
    const shapes = [
      { id: 'under', shape: { type: 'hline', y: 100 } as PixelShape },
      { id: 'over', shape: { type: 'vline', x: 50 } as PixelShape },
      { id: 'elsewhere', shape: { type: 'hline', y: 500 } as PixelShape },
    ];
    expect(hitTestAll(shapes, 50, 100, TOL)).toEqual({ id: 'over', part: 'body' });
    expect(hitTestAll(shapes, 400, 100, TOL)).toEqual({ id: 'under', part: 'body' });
    expect(hitTestAll(shapes, 400, 300, TOL)).toBeNull();
    expect(hitTestAll([], 0, 0, TOL)).toBeNull();
  });
});

describe('fibPrices', () => {
  it('level 1 = a.price, level 0 = b.price, 0.5 = midpoint, formula for the rest', () => {
    const a = { time: 0, price: 0.3 };
    const b = { time: 100, price: 0.1 };
    const prices = fibPrices(a, b);
    expect(prices).toHaveLength(FIB_LEVELS.length);
    FIB_LEVELS.forEach(({ level }, i) => {
      if (level === 1) expect(prices[i]).toBe(a.price);
      else if (level === 0) expect(prices[i]).toBe(b.price);
      else expect(prices[i]).toBeCloseTo(b.price + (a.price - b.price) * level, 12);
    });
    expect(prices[FIB_LEVELS.findIndex((l) => l.level === 0.5)]).toBeCloseTo(0.2, 12);
  });

  it('works for a downward drag and for a flat a == b', () => {
    const down = fibPrices({ time: 0, price: 100 }, { time: 1, price: 200 });
    expect(down[0]).toBe(200);
    expect(down[down.length - 1]).toBe(100);
    expect(fibPrices({ time: 0, price: 42 }, { time: 1, price: 42 })).toEqual(
      FIB_LEVELS.map(() => 42),
    );
  });
});

describe('moveDrawing', () => {
  const base = { id: 'd-1', color: '#2962ff', width: 1 as const };
  const trend: Drawing = {
    ...base,
    type: 'trendline',
    a: { time: 1000, price: 10 },
    b: { time: 2000, price: 20 },
  };
  const delta = { dTime: 300, dPrice: 5 };
  const to = { time: 5000, price: 99 };

  it('moving the body shifts both anchors', () => {
    expect(moveDrawing(trend, 'body', delta, to)).toEqual({
      ...trend,
      a: { time: 1300, price: 15 },
      b: { time: 2300, price: 25 },
    });
  });

  it('dragging an anchor moves only that anchor, to `to`', () => {
    expect(moveDrawing(trend, 'a', delta, to)).toEqual({ ...trend, a: to });
    expect(moveDrawing(trend, 'b', delta, to)).toEqual({ ...trend, b: to });
  });

  it('hline ignores time, vline ignores price', () => {
    const h: Drawing = { ...base, type: 'hline', price: 10 };
    expect(moveDrawing(h, 'body', delta, to)).toEqual({ ...h, price: 15 });
    expect(moveDrawing(h, 'a', delta, to)).toEqual({ ...h, price: 99 });
    const v: Drawing = { ...base, type: 'vline', time: 1000 };
    expect(moveDrawing(v, 'body', delta, to)).toEqual({ ...v, time: 1300 });
    expect(moveDrawing(v, 'a', delta, to)).toEqual({ ...v, time: 5000 });
  });

  it('keeps times whole seconds', () => {
    const moved = moveDrawing(trend, 'body', { dTime: 0.6, dPrice: 0 }, to);
    expect(moved.type === 'trendline' && [moved.a.time, moved.b.time]).toEqual([1001, 2001]);
  });

  it('does not mutate the input or share anchors with it', () => {
    const snapshot = structuredClone(trend);
    for (const part of ['a', 'b', 'body'] as const) {
      const out = moveDrawing(trend, part, delta, to);
      expect(out).not.toBe(trend);
      if (out.type === 'trendline' && trend.type === 'trendline') {
        expect(out.a).not.toBe(trend.a);
        expect(out.b).not.toBe(trend.b);
        expect(out.a).not.toBe(to);
      }
    }
    expect(trend).toEqual(snapshot);
  });
});

describe('T4.8 sanitizeDrawings', () => {
  const ok = {
    hline: { id: 'h', type: 'hline', color: '#2962ff', width: 1, price: 101.5 },
    vline: { id: 'v', type: 'vline', color: '#2962FF', width: 2, time: 1_700_000_000 },
    trendline: {
      id: 't',
      type: 'trendline',
      color: '#000000',
      width: 3,
      a: { time: 1, price: 2 },
      b: { time: 3, price: -4 },
    },
    rect: {
      id: 'r',
      type: 'rect',
      color: '#9c27b0',
      width: 4,
      a: { time: 1, price: 2 },
      b: { time: 3, price: 4 },
    },
    fib: {
      id: 'f',
      type: 'fib',
      color: '#787b86',
      width: 1,
      a: { time: 1, price: 2 },
      b: { time: 3, price: 4 },
    },
  };

  it('keeps valid entries of each type, in order', () => {
    const all = Object.values(ok);
    expect(sanitizeDrawings(all)).toEqual(all);
  });

  it('strips unknown fields', () => {
    expect(sanitizeDrawings([{ ...ok.hline, extra: 1, a: { time: 1, price: 1 } }])).toEqual([
      ok.hline,
    ]);
    expect(sanitizeDrawings([{ ...ok.rect, a: { ...ok.rect.a, junk: true } }])).toEqual([ok.rect]);
  });

  it('drops invalid entries', () => {
    const bad: unknown[] = [
      { ...ok.hline, type: 'circle' },
      { ...ok.hline, type: undefined },
      { ...ok.hline, price: NaN },
      { ...ok.hline, price: Infinity },
      { ...ok.hline, price: '101' },
      { ...ok.vline, time: -Infinity },
      { ...ok.trendline, a: { time: NaN, price: 1 } },
      { ...ok.rect, b: { time: 1, price: Infinity } },
      { ...ok.fib, b: undefined },
      { ...ok.trendline, a: null },
      { ...ok.rect, color: 'red' },
      { ...ok.rect, color: '#12345' },
      { ...ok.rect, color: '#1234567' },
      { ...ok.hline, width: 5 },
      { ...ok.hline, width: 0 },
      { ...ok.hline, width: '1' },
      { ...ok.hline, id: '' },
      { ...ok.hline, id: 7 },
      null,
      42,
      'hline',
      [ok.hline],
    ];
    for (const b of bad) expect(sanitizeDrawings([b])).toEqual([]);
  });

  it('drops duplicate ids (first valid one wins)', () => {
    const dup = { ...ok.vline, id: 'h' };
    expect(sanitizeDrawings([ok.hline, dup])).toEqual([ok.hline]);
    // An invalid first entry does not claim the id.
    expect(sanitizeDrawings([{ ...ok.hline, price: NaN }, dup])).toEqual([dup]);
  });

  it('rounds a fractional time to whole seconds', () => {
    expect(sanitizeDrawings([{ ...ok.vline, time: 10.6 }])).toEqual([{ ...ok.vline, time: 11 }]);
  });

  it('non-array input -> []', () => {
    for (const raw of [null, undefined, {}, 'x', 1, { drawings: [ok.hline] }]) {
      expect(sanitizeDrawings(raw)).toEqual([]);
    }
  });
});

describe('T4.13 fib aiming + fill', () => {
  const c = (time: number, open: number, high: number, low: number, close: number): Candle => ({
    time,
    open,
    high,
    low,
    close,
    volume: 1,
  });
  const bars = [c(0, 10, 20, 5, 12), c(60, 12, 30, 11, 25)];

  it("magnetSnap 'hl' picks only high/low, even when open/close is nearer", () => {
    // Price 11.5 is nearest the bar-0 close (12), but 'hl' must choose between 20 and 5.
    expect(magnetSnap({ time: 10, price: 11.5 }, bars, true, 'hl')).toEqual({ time: 0, price: 5 });
    expect(magnetSnap({ time: 10, price: 17 }, bars, true, 'hl')).toEqual({ time: 0, price: 20 });
    expect(magnetSnap({ time: 10, price: 11.5 }, bars, true)).toEqual({ time: 0, price: 12 });
  });

  it('handles use their own (bigger) tolerance; the body keeps the line tolerance', () => {
    const s: PixelShape = { type: 'trendline', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };
    expect(hitTestShape(s, 9, 0, 6, 10)).toBe('a'); // 9 px from a: a handle with tol 10
    expect(hitTestShape(s, 9, 0, 6)).toBe('body'); // same point, handles at 6: the line
    expect(hitTestShape(s, 0, 9, 6, 10)).toBe('a'); // off the line, within the handle radius
    expect(hitTestShape(s, 0, 9, 6)).toBeNull();
    expect(hitTestAll([{ id: 'x', shape: s }], 200, 9, 6, 10)).toEqual({ id: 'x', part: 'b' });
  });

  it('sanitizeDrawings keeps a valid fib fill and drops only an invalid one', () => {
    const fib = {
      id: 'f',
      type: 'fib',
      color: '#787b86',
      width: 1,
      a: { time: 0, price: 1 },
      b: { time: 60, price: 2 },
    };
    expect(sanitizeDrawings([{ ...fib, fill: 0.35 }])[0]).toMatchObject({ fill: 0.35 });
    expect(sanitizeDrawings([{ ...fib, fill: 0 }])[0]).toMatchObject({ fill: 0 });
    for (const bad of [-0.1, 1.5, NaN, '0.3', null]) {
      const [d] = sanitizeDrawings([{ ...fib, fill: bad }]);
      expect(d).toBeDefined();
      expect(d).not.toHaveProperty('fill');
    }
    // Only fibs carry a fill.
    const [t] = sanitizeDrawings([{ ...fib, type: 'trendline', fill: 0.3 }]);
    expect(t).not.toHaveProperty('fill');
  });
});

import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/types';
import {
  alertLevel,
  canCarryAlert,
  constrainAngle,
  fibBands,
  fibLevelColor,
  fibLevelsOf,
  fibLevelValue,
  fibPrices,
  hitTestAll,
  hitTestShape,
  isDefaultFibLevels,
  magnetSnap,
  moveDrawing,
  normalizeFibLevels,
  sanitizeDrawings,
} from './geometry';
import {
  FIB_CUSTOM_COLOR,
  FIB_EXTRA_LEVELS,
  FIB_LEVEL_MAX,
  FIB_LEVEL_MIN,
  FIB_LEVELS,
  FIB_MAX_LEVELS,
  HANDLE_TOLERANCE,
  HIT_TOLERANCE,
  type Drawing,
  type PixelShape,
} from './types';

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

describe('T4.15 shift angle lock + fib extend', () => {
  it('constrainAngle snaps to 0/45/90° keeping the distance along that direction', () => {
    const o = { x: 100, y: 100 };
    expect(constrainAngle(o, { x: 200, y: 108 })).toEqual({ x: 200, y: 100 }); // ~horizontal
    expect(constrainAngle(o, { x: 93, y: 20 })).toEqual({ x: 100, y: 20 }); // ~vertical
    const d = constrainAngle(o, { x: 160, y: 50 }); // ~-45°
    expect(d.x - o.x).toBeCloseTo(-(d.y - o.y), 9);
    expect(constrainAngle(o, o)).toEqual(o);
  });

  it('an extended fib hits up to the pane edge, a normal one only within its anchors', () => {
    const levelYs = FIB_LEVELS.map(({ level }) => 100 - 100 * level);
    const s: PixelShape = { type: 'fib', a: { x: 100, y: 0 }, b: { x: 300, y: 100 }, levelYs };
    expect(hitTestShape(s, 500, 50, 6)).toBeNull();
    expect(hitTestShape({ ...s, extendTo: 800 }, 500, 50, 6)).toBe('body');
    expect(hitTestShape({ ...s, extendTo: 800 }, 900, 50, 6)).toBeNull();
  });

  it('sanitizeDrawings keeps extend: true on a fib only', () => {
    const f = {
      id: 'f',
      type: 'fib',
      color: '#787b86',
      width: 1,
      a: { time: 0, price: 1 },
      b: { time: 60, price: 2 },
    };
    expect(sanitizeDrawings([{ ...f, extend: true }])[0]).toMatchObject({ extend: true });
    expect(sanitizeDrawings([{ ...f, extend: 'yes' }])[0]).not.toHaveProperty('extend');
  });
});

describe('T6.1 horizontal ray', () => {
  const shape: PixelShape = { type: 'hray', a: { x: 200, y: 100 } };
  const ray: Drawing = {
    id: 'r',
    type: 'hray',
    color: '#2962ff',
    width: 1,
    a: { time: 1000, price: 50 },
  };

  it('hits on the line right of the anchor, misses left of it, handle wins', () => {
    const hit = (x: number, y: number) => hitTestShape(shape, x, y, TOL, HANDLE_TOLERANCE);
    expect(hit(600, 103)).toBe('body');
    expect(hit(600, 100 + TOL + 1)).toBeNull();
    expect(hit(200 - HANDLE_TOLERANCE - 1, 100)).toBeNull();
    expect(hit(50, 100)).toBeNull();
    expect(hit(205, 100)).toBe('a');
    expect(hit(193, 100)).toBe('a');
    const body = (x: number, y: number) => hitTestShape(shape, x, y, TOL, 0);
    expect(body(200 - TOL, 102)).toBe('body');
    expect(body(200 - TOL - 1, 100)).toBeNull();
  });

  it('moving the body shifts the anchor, the handle puts it at `to`', () => {
    const delta = { dTime: 300.4, dPrice: 5 };
    const to = { time: 5000.6, price: 99 };
    expect(moveDrawing(ray, 'body', delta, to)).toEqual({ ...ray, a: { time: 1300, price: 55 } });
    expect(moveDrawing(ray, 'a', delta, to)).toEqual({ ...ray, a: { time: 5001, price: 99 } });
    expect(ray.a).toEqual({ time: 1000, price: 50 });
  });

  it('carries an alert at its anchor price', () => {
    for (const t of [0, 1000, 9e9]) {
      expect(alertLevel(ray, t)).toBe(50);
      expect(alertLevel({ ...ray, type: 'hline', price: 7 } as Drawing, t)).toBe(7);
      expect(alertLevel({ ...ray, type: 'hline', price: -3 } as Drawing, t)).toBe(-3);
      expect(alertLevel({ ...ray, type: 'trendline', b: ray.a } as Drawing, t)).toBeNull();
    }
    expect(canCarryAlert(ray)).toBe(true);
    expect(canCarryAlert({ ...ray, type: 'hline', price: 7 } as Drawing)).toBe(true);
    expect(canCarryAlert({ ...ray, type: 'trendline', b: ray.a } as Drawing)).toBe(false);
    expect(canCarryAlert({ ...ray, type: 'vline', time: 5 } as Drawing)).toBe(false);
  });

  it('a trend line carries an alert at its level, extended both ways', () => {
    const t = {
      id: 't1',
      type: 'trendline',
      color: '#2962ff',
      width: 1,
      a: { time: 1000, price: 100 },
      b: { time: 2000, price: 200 },
    } as Drawing;
    const flipped = { ...t, a: { time: 2000, price: 200 }, b: { time: 1000, price: 100 } };
    const falling = { ...t, a: { time: 1000, price: 200 }, b: { time: 2000, price: 100 } };
    expect(canCarryAlert(t)).toBe(true);
    expect(alertLevel(t, 1000)).toBe(100);
    expect(alertLevel(t, 1500)).toBe(150);
    expect(alertLevel(t, 2000)).toBe(200);
    expect(alertLevel(t, 3500)).toBe(350);
    expect(alertLevel(flipped as Drawing, 3500)).toBe(350);
    expect(alertLevel(t, 500)).toBe(50);
    expect(alertLevel(t, 0)).toBeNull();
    expect(alertLevel(falling as Drawing, 2500)).toBe(50);
    expect(alertLevel(falling as Drawing, 500)).toBe(250);
    expect(alertLevel(falling as Drawing, 3000)).toBeNull();
    expect(alertLevel({ ...t, b: { time: 1001, price: -Number.MAX_VALUE } } as Drawing, 5000)).toBe(
      null,
    );
  });

  it('sanitizeDrawings keeps a valid ray and drops invalid ones', () => {
    expect(sanitizeDrawings([{ ...ray, a: { time: 1000.4, price: 50 }, b: 1 }])).toEqual([ray]);
    const bad = [
      { ...ray, a: undefined },
      { ...ray, a: { time: 1, price: 'x' } },
      { ...ray, a: { time: Infinity, price: 1 } },
      { ...ray, a: { price: 1 } },
      { ...ray, id: 'r2', a: [1000, 50] },
      { id: 'r3', type: 'hray', color: '#2962ff', width: 1, price: 50 },
      { ...ray, color: 'blue' },
    ];
    expect(sanitizeDrawings(bad)).toEqual([]);
  });
});

describe('Phase 8 fib levels', () => {
  const DEFAULTS = FIB_LEVELS.map(({ level }) => level);
  const fib = {
    id: 'f',
    type: 'fib',
    color: '#787b86',
    width: 1,
    a: { time: 0, price: 300 },
    b: { time: 60, price: 100 },
  } as const;

  it('fibLevelValue: finite, rounded to 4 decimals, within the range', () => {
    expect(fibLevelValue(0.61800004)).toBe(0.618);
    expect(fibLevelValue(1.23456)).toBe(1.2346);
    expect(Object.is(fibLevelValue(-0.00001), 0)).toBe(true);
    expect(fibLevelValue(FIB_LEVEL_MIN)).toBe(FIB_LEVEL_MIN);
    expect(fibLevelValue(FIB_LEVEL_MAX)).toBe(FIB_LEVEL_MAX);
    for (const bad of [FIB_LEVEL_MIN - 0.01, FIB_LEVEL_MAX + 0.01, NaN, Infinity, '0.5', null]) {
      expect(fibLevelValue(bad)).toBeNull();
    }
  });

  it('normalizeFibLevels: drops invalid entries, rounds, dedupes, sorts, caps the count', () => {
    expect(normalizeFibLevels([1.618, 0.5, 0.5, -0.5, 0.50001, 'x', NaN, 99, -6])).toEqual([
      -0.5, 0.5, 1.618,
    ]);
    expect(normalizeFibLevels([0.618, 0.61800001, 0.6180000001])).toEqual([0.618]);
    const many = Array.from({ length: FIB_MAX_LEVELS + 6 }, (_, i) => 9 - i * 0.25);
    const capped = normalizeFibLevels(many)!;
    expect(capped).toHaveLength(FIB_MAX_LEVELS);
    expect(capped).toEqual([...capped].sort((x, y) => x - y));
    expect(capped[0]).toBe(9 - (FIB_MAX_LEVELS + 5) * 0.25);
    for (const bad of [[], [NaN, 'a', 11], 'x', null, undefined, { 0: 0.5 }]) {
      expect(normalizeFibLevels(bad)).toBeNull();
    }
  });

  it('isDefaultFibLevels matches exactly the FIB_LEVELS set', () => {
    expect(isDefaultFibLevels(DEFAULTS)).toBe(true);
    expect(isDefaultFibLevels(DEFAULTS.slice(1))).toBe(false);
    expect(isDefaultFibLevels([...DEFAULTS.slice(0, -1), 1.618])).toBe(false);
  });

  it('fibLevelsOf: defaults when absent, else ascending with preset or custom colours', () => {
    expect(fibLevelsOf({})).toEqual(FIB_LEVELS);
    expect(fibLevelsOf({ levels: [1.618, 0.65, 0.5, -0.5] })).toEqual([
      { level: -0.5, color: FIB_CUSTOM_COLOR },
      { level: 0.5, color: '#4caf50' },
      { level: 0.65, color: FIB_CUSTOM_COLOR },
      { level: 1.618, color: '#2962ff' },
    ]);
    for (const { level, color } of [...FIB_LEVELS, ...FIB_EXTRA_LEVELS]) {
      expect(fibLevelColor(level)).toBe(color);
    }
    expect(fibLevelColor(0.7)).toBe(FIB_CUSTOM_COLOR);
  });

  it('fibPrices follows the given levels, including extensions and negatives', () => {
    const prices = fibPrices(fib.a, fib.b, [-0.5, 0, 1, 1.618]);
    expect(prices[0]).toBeCloseTo(0, 9);
    expect(prices[1]).toBe(100);
    expect(prices[2]).toBe(300);
    expect(prices[3]).toBeCloseTo(423.6, 9);
    expect(fibPrices(fib.a, fib.b, [])).toEqual([]);
  });

  it('fibBands: one band between each pair of neighbouring levels, in the upper level colour', () => {
    const levels = fibLevelsOf({ levels: [0, 0.618, 1.618] });
    expect(fibBands(levels, [100, 38.2, -61.8])).toEqual([
      { y: 38.2, h: 61.8, color: '#089981' },
      { y: -61.8, h: 100, color: '#2962ff' },
    ]);
    expect(fibBands(fibLevelsOf({ levels: [0.5] }), [50])).toEqual([]);
    expect(
      fibBands(
        fibLevelsOf({}),
        FIB_LEVELS.map((_, i) => i * 10),
      ),
    ).toHaveLength(FIB_LEVELS.length - 1);
  });

  it('the hit area spans the lowest to the highest shown level', () => {
    const levelYs = [-0.5, 0, 1, 1.618].map((level) => 100 - 100 * level);
    const s: PixelShape = { type: 'fib', a: { x: 100, y: 0 }, b: { x: 300, y: 100 }, levelYs };
    expect(hitTestShape(s, 200, -50, TOL)).toBe('body');
    expect(hitTestShape(s, 200, 140, TOL)).toBe('body');
    expect(hitTestShape(s, 200, -61.8 - TOL - 1, TOL)).toBeNull();
    expect(hitTestShape(s, 200, 150 + TOL + 1, TOL)).toBeNull();
  });

  it('sanitizeDrawings keeps valid levels normalised and drops only an invalid field', () => {
    expect(sanitizeDrawings([{ ...fib, levels: [1.618, 0.5, 0.5, 0.65] }])).toEqual([
      { ...fib, levels: [0.5, 0.65, 1.618] },
    ]);
    expect(sanitizeDrawings([{ ...fib, levels: [0.5, 'x', 42] }])).toEqual([
      { ...fib, levels: [0.5] },
    ]);
    expect(sanitizeDrawings([{ ...fib, levels: [...DEFAULTS].reverse() }])).toEqual([fib]);
    for (const bad of [[], [NaN], 'all', { a: 1 }, null, [11, -6]]) {
      expect(sanitizeDrawings([{ ...fib, levels: bad }])).toEqual([fib]);
    }
    const [t] = sanitizeDrawings([{ ...fib, type: 'trendline', levels: [0.5] }]);
    expect(t).not.toHaveProperty('levels');
  });
});

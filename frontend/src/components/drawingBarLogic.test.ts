import { describe, expect, it } from 'vitest';
import { BAR_TOP, barPosition } from './drawingBarLogic';

const bar = { w: 200, h: 36 };
const area = { w: 1000, h: 600 };

describe('T6.3 barPosition', () => {
  it('defaults to the top centre', () => {
    expect(barPosition(null, bar, area)).toEqual({ x: 400, y: BAR_TOP });
  });

  it('keeps a saved position that fits', () => {
    expect(barPosition({ x: 120, y: 300 }, bar, area)).toEqual({ x: 120, y: 300 });
    expect(barPosition({ x: 800, y: 564 }, bar, area)).toEqual({ x: 800, y: 564 });
  });

  it('clamps so the whole bar stays inside the area (e.g. after a resize)', () => {
    expect(barPosition({ x: 950, y: 590 }, bar, area)).toEqual({ x: 800, y: 564 });
    expect(barPosition({ x: -40, y: -5 }, bar, area)).toEqual({ x: 0, y: 0 });
    expect(barPosition({ x: 900, y: 10 }, bar, { w: 700, h: 600 })).toEqual({ x: 500, y: 10 });
  });

  it('an area smaller than the bar pins it to the top-left', () => {
    expect(barPosition({ x: 50, y: 50 }, bar, { w: 100, h: 20 })).toEqual({ x: 0, y: 0 });
    expect(barPosition(null, bar, { w: 100, h: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('rounds to whole pixels', () => {
    expect(barPosition(null, { w: 201, h: 36 }, area)).toEqual({ x: 400, y: BAR_TOP });
    expect(barPosition({ x: 10.6, y: 20.2 }, bar, area)).toEqual({ x: 11, y: 20 });
  });
});

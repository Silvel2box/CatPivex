import type { Logical, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import {
  CloudPrimitive,
  cloudDebug,
  cloudSamples,
  cloudSegments,
  futurePath,
  futureRange,
  type CloudSource,
} from './CloudPrimitive';

const bars = Array.from({ length: 5 }, (_, i) => ({ time: 100 + i }));
const at = (i: number, value: number) => ({ time: bars[i].time, value });

/** a − b: +2, +1, −1, −2 in data (cross at 2.5), then +1, +3 in the future (cross at 4 + 2/3). */
const src = (): CloudSource => ({
  bars,
  a: {
    points: [at(1, 12), at(2, 11), at(3, 9), at(4, 8)],
    future: [
      { logical: 5, value: 11 },
      { logical: 6, value: 12 },
    ],
    color: '#00ff00',
    width: 2,
  },
  b: {
    points: [at(0, 7), at(1, 10), at(2, 10), at(3, 10), at(4, 10)],
    future: [
      { logical: 5, value: 10 },
      { logical: 6, value: 9 },
    ],
    color: '#ff0000',
    width: 1,
  },
});

describe('cloud geometry', () => {
  it('samples: bars where both lines exist, then the future; clipped to a range', () => {
    expect(cloudSamples(src()).map((s) => [s.logical, s.a, s.b])).toEqual([
      [1, 12, 10],
      [2, 11, 10],
      [3, 9, 10],
      [4, 8, 10],
      [5, 11, 10],
      [6, 12, 9],
    ]);
    expect(cloudSamples(src(), 2.4, 5).map((s) => s.logical)).toEqual([2, 3, 4, 5]);
    expect(cloudSamples(src(), 6, 9).map((s) => s.logical)).toEqual([6]);
  });

  it('segments split at the crossing; each side keeps its colour', () => {
    const segs = cloudSegments(cloudSamples(src()));
    expect(segs.map((s) => s.up)).toEqual([true, false, true]);
    expect(segs[0].pts.map((p) => p.logical)).toEqual([1, 2, 2.5]);
    expect(segs[0].pts[2]).toEqual({ logical: 2.5, a: 10, b: 10 });
    expect(segs[1].pts[0]).toBe(segs[0].pts[2]);
    expect(segs[1].pts.map((p) => p.logical)).toEqual([2.5, 3, 4, 4 + 2 / 3]);
    expect(segs[1].pts[3].a).toBeCloseTo(10, 12);
    expect(segs[2].pts.map((p) => p.logical)).toEqual([4 + 2 / 3, 5, 6]);
  });

  it('a touch (a = b) counts as up; a hole in the bars starts a new segment', () => {
    const segs = cloudSegments([
      { logical: 0, a: 1, b: 1 },
      { logical: 1, a: 2, b: 1 },
      { logical: 3, a: 0, b: 1 },
      { logical: 4, a: 0, b: 2 },
    ]);
    expect(segs.map((s) => [s.up, s.pts.map((p) => p.logical)])).toEqual([
      [true, [0, 1]],
      [false, [3, 4]],
    ]);
  });

  it('future path starts at the last bar when the line has a point there', () => {
    expect(futurePath(src().a, bars)).toEqual([
      { logical: 4, value: 8 },
      { logical: 5, value: 11 },
      { logical: 6, value: 12 },
    ]);
    const short = { ...src().a, points: [at(1, 12)] };
    expect(futurePath(short, bars).map((p) => p.logical)).toEqual([5, 6]);
    expect(futurePath({ ...src().a, future: [] }, bars)).toEqual([]);
  });

  it('autoscale range: the future values inside the visible logicals', () => {
    expect(futureRange(src(), 0, 4)).toBeNull();
    expect(futureRange(src(), 0, 5.5)).toEqual([10, 11]);
    expect(futureRange(src(), 0, 100)).toEqual([9, 12]);
  });

  it('debug: extent, future bars, coloured segments', () => {
    const d = cloudDebug(src());
    expect(d).toMatchObject({ from: 1, to: 6, futureBars: 2, futureLines: { a: 3, b: 3 } });
    expect(d.segments).toEqual([
      { from: 1, to: 2.5, up: true, fill: 'rgba(0, 255, 0, 0.25)' },
      { from: 2.5, to: 4 + 2 / 3, up: false, fill: 'rgba(255, 0, 0, 0.25)' },
      { from: 4 + 2 / 3, to: 6, up: true, fill: 'rgba(0, 255, 0, 0.25)' },
    ]);
    expect(d.last).toEqual({ logical: 6, a: 12, b: 9 });
    expect(d.future.map((s) => s.logical)).toEqual([5, 6]);
  });
});

function fakeCtx() {
  const ops: (string | number)[][] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    beginPath: () => ops.push(['begin']),
    moveTo: (x: number, y: number) => ops.push(['M', x, y]),
    lineTo: (x: number, y: number) => ops.push(['L', x, y]),
    closePath: () => ops.push(['close']),
    fill: () => ops.push(['fill', ctx.fillStyle]),
    stroke: () => ops.push(['stroke', ctx.strokeStyle, ctx.lineWidth]),
  };
  return { ctx, ops };
}

describe('CloudPrimitive', () => {
  const setup = (range: { from: number; to: number }) => {
    const p = new CloudPrimitive(src);
    const chart = {
      timeScale: () => ({
        getVisibleLogicalRange: () => range,
        logicalToCoordinate: (l: Logical) => 10 + l * 20,
      }),
    };
    const series = { priceToCoordinate: (v: number) => 200 - v * 10 };
    p.attached({
      chart,
      series,
      requestUpdate: () => {},
    } as unknown as SeriesAttachedParameter<Time>);
    p.updateAllViews();
    const draw = (i: number) => {
      const { ctx, ops } = fakeCtx();
      const target = {
        useMediaCoordinateSpace: (f: (s: { context: typeof ctx }) => void) => f({ context: ctx }),
      };
      const view = p.paneViews()[i];
      view.renderer()!.draw(target as never);
      return ops;
    };
    return { p, draw };
  };

  it('fill below the series, polygons in pixels with the crossing; future lines on top', () => {
    const { p, draw } = setup({ from: 0, to: 10 });
    expect(p.paneViews().map((v) => v.zOrder?.())).toEqual(['bottom', 'normal']);
    const fill = draw(0);
    const fills = fill.filter((o) => o[0] === 'fill').map((o) => o[1]);
    expect(fills).toEqual([
      'rgba(0, 255, 0, 0.25)',
      'rgba(255, 0, 0, 0.25)',
      'rgba(0, 255, 0, 0.25)',
    ]);
    const first = fill.slice(
      0,
      fill.findIndex((o) => o[0] === 'close'),
    );
    expect(first).toEqual([
      ['begin'],
      ['M', 30, 80],
      ['L', 50, 90],
      ['L', 60, 100],
      ['L', 60, 100],
      ['L', 50, 100],
      ['L', 30, 100],
    ]);
    const lines = draw(1);
    expect(lines.filter((o) => o[0] === 'stroke')).toEqual([
      ['stroke', '#00ff00', 2],
      ['stroke', '#ff0000', 1],
    ]);
    expect(lines.slice(0, 4)).toEqual([['begin'], ['M', 90, 120], ['L', 110, 90], ['L', 130, 80]]);
  });

  it('only the visible part (± one bar) is projected; autoscale adds the visible future', () => {
    const { p, draw } = setup({ from: 6, to: 8 });
    const fills = draw(0).filter((o) => o[0] === 'fill');
    expect(fills).toHaveLength(1);
    expect(p.autoscaleInfo(6 as Logical, 8 as Logical)).toEqual({
      priceRange: { minValue: 9, maxValue: 12 },
    });
    expect(p.autoscaleInfo(0 as Logical, 4 as Logical)).toBeNull();
  });

  it('detached / no source → draws nothing', () => {
    const { p, draw } = setup({ from: 0, to: 10 });
    p.detached();
    p.updateAllViews();
    expect(draw(0)).toEqual([]);
    expect(draw(1)).toEqual([]);
    const empty = new CloudPrimitive(() => null);
    expect(empty.debug()).toBeNull();
    expect(empty.autoscaleInfo(0 as Logical, 9 as Logical)).toBeNull();
  });
});

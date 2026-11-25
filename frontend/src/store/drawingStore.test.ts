import { beforeEach, describe, expect, it } from 'vitest';
import type { Drawing } from '../chart/drawings/types';
import { UNDO_LIMIT, useDrawingStore } from './drawingStore';

const st = () => useDrawingStore.getState();
const hline = (id: string, price: number): Drawing => ({
  id,
  type: 'hline',
  color: '#2962ff',
  width: 1,
  price,
});
const fib = (id: string): Drawing => ({
  id,
  type: 'fib',
  color: '#787b86',
  width: 1,
  a: { time: 0, price: 10 },
  b: { time: 60, price: 20 },
});

beforeEach(() => {
  st().setStayInTool(false);
  st().startLoading('BINANCE:BTCUSDT');
  st().load('BINANCE:BTCUSDT', []);
});

describe('T4.14 undo / redo', () => {
  it('add, style and remove each undo in one step; redo replays them', () => {
    st().add(hline('h', 1));
    st().setStyle('h', { color: '#ffffff' });
    st().remove('h');
    expect(st().drawings).toEqual([]);
    st().undo();
    expect(st().drawings).toEqual([{ ...hline('h', 1), color: '#ffffff' }]);
    st().undo();
    expect(st().drawings).toEqual([hline('h', 1)]);
    st().undo();
    expect(st().drawings).toEqual([]);
    st().undo(); // nothing left: no-op
    expect(st().drawings).toEqual([]);
    st().redo();
    st().redo();
    expect(st().drawings).toEqual([{ ...hline('h', 1), color: '#ffffff' }]);
  });

  it('a drag (checkpoint + many updates) undoes in one step', () => {
    st().add(hline('h', 1));
    st().checkpoint();
    for (let p = 2; p <= 10; p++) st().update(hline('h', p));
    st().undo();
    expect(st().drawings).toEqual([hline('h', 1)]);
  });

  it('a new change drops the redo steps', () => {
    st().add(hline('a', 1));
    st().undo();
    st().add(hline('b', 2));
    st().redo();
    expect(st().drawings.map((d) => d.id)).toEqual(['b']);
  });

  it('undo/redo bump rev (so they are saved) and clear a selection that no longer exists', () => {
    st().add(hline('h', 1)); // selected
    const rev = st().rev;
    st().undo();
    expect(st().rev).toBe(rev + 1);
    expect(st().selectedId).toBeNull();
  });

  it('switching symbol clears the history', () => {
    st().add(hline('h', 1));
    st().startLoading('BINANCE:ETHUSDT');
    st().load('BINANCE:ETHUSDT', []);
    st().undo();
    expect(st().drawings).toEqual([]);
    expect(st().past).toEqual([]);
  });

  it(`keeps at most ${UNDO_LIMIT} steps`, () => {
    for (let i = 0; i < UNDO_LIMIT + 20; i++) st().add(hline(`h${i}`, i));
    expect(st().past).toHaveLength(UNDO_LIMIT);
  });

  it('fib: reverse swaps the anchors; extend is a fib-only style; both undo', () => {
    st().add(fib('f'));
    st().add(hline('h', 1));
    st().reverse('f');
    expect(st().drawings[0]).toMatchObject({
      a: { time: 60, price: 20 },
      b: { time: 0, price: 10 },
    });
    st().setStyle('f', { extend: true });
    st().setStyle('h', { extend: true, fill: 0.3 });
    expect(st().drawings[0]).toMatchObject({ extend: true });
    expect(st().drawings[1]).not.toHaveProperty('extend');
    expect(st().drawings[1]).not.toHaveProperty('fill');
    st().undo();
    st().undo();
    st().undo();
    expect(st().drawings[0]).toEqual(fib('f'));
  });
});

describe('T6.2 ruler arm flag', () => {
  it('arming the ruler drops the tool; choosing a tool disarms it; neither touches drawings', () => {
    st().add(hline('h', 1));
    const before = { drawings: st().drawings, past: st().past.length, rev: st().rev };
    st().setTool('trendline');
    st().setMeasuring(true);
    expect(st()).toMatchObject({ measuring: true, tool: null });
    st().setTool('rect');
    expect(st()).toMatchObject({ measuring: false, tool: 'rect' });
    st().setMeasuring(true);
    st().setTool(null);
    expect(st().measuring).toBe(false);
    st().setMeasuring(true);
    st().setMeasuring(false);
    expect(st()).toMatchObject({ measuring: false, tool: null });
    expect({ drawings: st().drawings, past: st().past.length, rev: st().rev }).toEqual(before);
  });

  it('a symbol switch disarms it', () => {
    st().setMeasuring(true);
    st().startLoading('BINANCE:ETHUSDT');
    expect(st().measuring).toBe(false);
  });
});

describe('T6.4 stay in drawing mode', () => {
  it('off: add drops the tool and selects the new drawing', () => {
    st().setTool('hline');
    st().add(hline('h', 1));
    expect(st().tool).toBeNull();
    expect(st().selectedId).toBe('h');
  });

  it('on: add keeps the tool and selects nothing; still one undo step per drawing', () => {
    st().setStayInTool(true);
    st().setTool('fib');
    st().add(fib('f1'));
    st().add(fib('f2'));
    expect(st().tool).toBe('fib');
    expect(st().selectedId).toBeNull();
    expect(st().drawings.map((d) => d.id)).toEqual(['f1', 'f2']);
    st().undo();
    expect(st().drawings.map((d) => d.id)).toEqual(['f1']);
  });

  it('on: leaving the tool (setTool(null)) still works', () => {
    st().setStayInTool(true);
    st().setTool('hline');
    st().add(hline('h', 1));
    st().setTool(null);
    expect(st().tool).toBeNull();
  });
});

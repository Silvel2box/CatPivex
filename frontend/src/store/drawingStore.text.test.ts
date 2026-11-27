import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR,
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_LENGTH,
  type Drawing,
} from '../chart/drawings/types';
import { useDrawingStore } from './drawingStore';

const st = () => useDrawingStore.getState();
const A = { time: 600, price: 100 };
const SYM = 'BINANCE:BTCUSDT';

const texts = () =>
  st().drawings.filter((d): d is Extract<Drawing, { type: 'text' }> => d.type === 'text');

function createText(value: string) {
  st().setTool('text');
  st().startText(null, A);
  st().commitText(value);
}

beforeEach(() => {
  st().setStayInTool(false);
  st().startLoading(SYM);
  st().load(SYM, []);
});

describe('P8 text editing state', () => {
  it('start (create) adds nothing yet; commit adds one text, selects it, drops the tool', () => {
    st().setTool('text');
    st().startText(null, A);
    expect(st().editingText).toEqual({ id: null, a: A });
    expect(st().drawings).toEqual([]);
    const rev = st().rev;
    st().commitText('line 1\nline 2');
    expect(st().editingText).toBeNull();
    const [d] = texts();
    expect(d).toMatchObject({
      type: 'text',
      a: A,
      text: 'line 1\nline 2',
      size: DEFAULT_TEXT_SIZE,
      color: DEFAULT_COLOR.text,
      width: 1,
    });
    expect(d.id).toMatch(/^d-/);
    expect(st().selectedId).toBe(d.id);
    expect(st().tool).toBeNull();
    expect(st().rev).toBe(rev + 1);
    expect(st().past).toHaveLength(1);
  });

  it('creating is one undo step', () => {
    createText('hi');
    st().undo();
    expect(st().drawings).toEqual([]);
    st().redo();
    expect(texts().map((d) => d.text)).toEqual(['hi']);
  });

  it('empty or whitespace-only create adds nothing and no undo step', () => {
    for (const v of ['', '   ', '\n \n']) {
      createText(v);
      expect(st().drawings).toEqual([]);
      expect(st().past).toEqual([]);
      expect(st().editingText).toBeNull();
    }
  });

  it('stayInTool: after a commit the tool stays and nothing is selected', () => {
    st().setStayInTool(true);
    createText('a');
    expect(st().tool).toBe('text');
    expect(st().selectedId).toBeNull();
    expect(texts()).toHaveLength(1);
  });

  it('cancel drops the editor without a change', () => {
    st().setTool('text');
    st().startText(null, A);
    st().cancelText();
    expect(st().editingText).toBeNull();
    expect(st().drawings).toEqual([]);
    expect(st().past).toEqual([]);
    st().commitText('late');
    expect(st().drawings).toEqual([]);
  });

  it('text is clamped to TEXT_MAX_LENGTH', () => {
    createText('x'.repeat(TEXT_MAX_LENGTH + 20));
    expect(texts()[0].text).toHaveLength(TEXT_MAX_LENGTH);
  });

  it('edit: commit changes the text in one undo step and keeps it selected', () => {
    createText('old');
    const id = texts()[0].id;
    st().startText(id, A);
    expect(st().editingText).toEqual({ id, a: A });
    expect(st().selectedId).toBe(id);
    st().commitText('new');
    expect(texts()[0]).toMatchObject({ id, text: 'new', a: A });
    expect(st().selectedId).toBe(id);
    expect(st().past).toHaveLength(2);
    st().undo();
    expect(texts()[0].text).toBe('old');
  });

  it('edit: unchanged text adds no undo step and no save', () => {
    createText('same');
    const id = texts()[0].id;
    const rev = st().rev;
    st().startText(id, A);
    st().commitText('same');
    expect(st().past).toHaveLength(1);
    expect(st().rev).toBe(rev);
    expect(st().editingText).toBeNull();
  });

  it('edit: committing empty removes the drawing in one undo step', () => {
    createText('bye');
    const id = texts()[0].id;
    st().startText(id, A);
    st().commitText('  ');
    expect(st().drawings).toEqual([]);
    expect(st().selectedId).toBeNull();
    expect(st().past).toHaveLength(2);
    st().undo();
    expect(texts().map((d) => d.id)).toEqual([id]);
  });

  it('edit of a drawing that is gone just closes the editor', () => {
    createText('x');
    const id = texts()[0].id;
    st().startText(id, A);
    st().remove(id);
    const past = st().past.length;
    st().commitText('y');
    expect(st().drawings).toEqual([]);
    expect(st().past).toHaveLength(past);
    expect(st().editingText).toBeNull();
  });

  it('switching tool or symbol cancels editing', () => {
    st().setTool('text');
    st().startText(null, A);
    st().setTool('hline');
    expect(st().editingText).toBeNull();
    st().setTool('text');
    st().startText(null, A);
    st().startLoading('BINANCE:ETHUSDT');
    expect(st().editingText).toBeNull();
  });

  it('setStyle size applies to text only', () => {
    createText('s');
    const id = texts()[0].id;
    st().setStyle(id, { size: 24 });
    expect(texts()[0].size).toBe(24);
    st().undo();
    expect(texts()[0].size).toBe(DEFAULT_TEXT_SIZE);
    st().add({ id: 'h', type: 'hline', color: '#2962ff', width: 1, price: 1 });
    st().setStyle('h', { size: 24 });
    expect(st().drawings.find((d) => d.id === 'h')).not.toHaveProperty('size');
  });
});

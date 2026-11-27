import { describe, expect, it } from 'vitest';
import { hitTestAll, hitTestShape, moveDrawing, sanitizeDrawings } from './geometry';
import { TEXT_LINE_HEIGHT, textBox, textLines } from './text';
import { HIT_TOLERANCE, TEXT_MAX_LENGTH, TEXT_SIZES, type Drawing, type PixelShape } from './types';

const TOL = HIT_TOLERANCE;
const perChar = (px: number) => (line: string) => line.length * px;

const text = (over: Partial<Extract<Drawing, { type: 'text' }>> = {}): Drawing => ({
  id: 't',
  type: 'text',
  color: '#2962ff',
  width: 1,
  a: { time: 600, price: 100 },
  text: 'hello',
  size: 14,
  ...over,
});

describe('P8 text box', () => {
  it('one line: width from the measure, height = size × line height', () => {
    const b = textBox('hello', 20, perChar(10));
    expect(b.lines).toEqual(['hello']);
    expect(b.w).toBe(50);
    expect(b.h).toBe(20 * TEXT_LINE_HEIGHT);
    expect(TEXT_LINE_HEIGHT).toBe(1.25);
  });

  it('several lines: widest line wins, height grows per line (empty lines count)', () => {
    const b = textBox('ab\nabcdef\n\nabc', 16, perChar(7));
    expect(b.lines).toEqual(['ab', 'abcdef', '', 'abc']);
    expect(b.w).toBe(42);
    expect(b.h).toBe(4 * 16 * TEXT_LINE_HEIGHT);
  });

  it('trailing newline is an extra (empty) line; CRLF splits like LF', () => {
    expect(textLines('a\n')).toEqual(['a', '']);
    expect(textLines('a\r\nb')).toEqual(['a', 'b']);
    expect(textBox('a\n', 12, perChar(5)).h).toBe(2 * 12 * TEXT_LINE_HEIGHT);
  });

  it('empty text: zero width, one line high, measure not called for empty lines', () => {
    let calls = 0;
    const b = textBox('', 14, (l) => {
      calls++;
      return l.length;
    });
    expect(b.w).toBe(0);
    expect(b.h).toBe(14 * TEXT_LINE_HEIGHT);
    expect(calls).toBe(0);
  });
});

describe('P8 text hit-test', () => {
  const s: PixelShape = { type: 'text', a: { x: 100, y: 50 }, w: 80, h: 40 };

  it('anywhere in the box is the body', () => {
    expect(hitTestShape(s, 100, 50, TOL)).toBe('body');
    expect(hitTestShape(s, 140, 70, TOL)).toBe('body');
    expect(hitTestShape(s, 180, 90, TOL)).toBe('body');
  });

  it('within tol of the box hits, just beyond misses', () => {
    expect(hitTestShape(s, 100 - TOL, 70, TOL)).toBe('body');
    expect(hitTestShape(s, 180 + TOL, 70, TOL)).toBe('body');
    expect(hitTestShape(s, 140, 50 - TOL, TOL)).toBe('body');
    expect(hitTestShape(s, 140, 90 + TOL, TOL)).toBe('body');
    expect(hitTestShape(s, 100 - TOL - 0.5, 70, TOL)).toBeNull();
    expect(hitTestShape(s, 180 + TOL + 0.5, 70, TOL)).toBeNull();
    expect(hitTestShape(s, 140, 50 - TOL - 0.5, TOL)).toBeNull();
    expect(hitTestShape(s, 140, 90 + TOL + 0.5, TOL)).toBeNull();
  });

  it('never an anchor handle, even right on the anchor', () => {
    expect(hitTestShape(s, 100, 50, TOL, 10)).toBe('body');
  });

  it('topmost text wins in hitTestAll', () => {
    const shapes = [
      { id: 'under', shape: s },
      { id: 'over', shape: { ...s, a: { x: 120, y: 60 } } as PixelShape },
    ];
    expect(hitTestAll(shapes, 130, 70, TOL)).toEqual({ id: 'over', part: 'body' });
    expect(hitTestAll(shapes, 102, 52, TOL)).toEqual({ id: 'under', part: 'body' });
  });
});

describe('P8 text moveDrawing', () => {
  it('body shifts the anchor by the delta (time rounded), keeps text/size/colour', () => {
    const d = text();
    const m = moveDrawing(d, 'body', { dTime: 59.6, dPrice: -2.5 }, { time: 0, price: 0 });
    expect(m).toEqual({ ...d, a: { time: 660, price: 97.5 } });
    expect(d.type === 'text' && d.a).toEqual({ time: 600, price: 100 });
  });

  it("'a' puts the anchor at `to`", () => {
    const m = moveDrawing(text(), 'a', { dTime: 0, dPrice: 0 }, { time: 1234.4, price: 7 });
    expect(m).toEqual({ ...text(), a: { time: 1234, price: 7 } });
  });
});

describe('P8 text sanitize', () => {
  it('keeps a valid text drawing, every allowed size, multiline and max length', () => {
    for (const size of TEXT_SIZES) {
      expect(sanitizeDrawings([text({ size })])).toEqual([text({ size })]);
    }
    const long = text({ text: 'x'.repeat(TEXT_MAX_LENGTH) });
    expect(sanitizeDrawings([long])).toEqual([long]);
    const multi = text({ text: ' a\n\nb ' });
    expect(sanitizeDrawings([multi])).toEqual([multi]);
  });

  it('drops empty, whitespace-only, too long, non-string text and bad sizes or anchors', () => {
    const bad: unknown[] = [
      { ...text(), text: '' },
      { ...text(), text: '  \n\t ' },
      { ...text(), text: 'x'.repeat(TEXT_MAX_LENGTH + 1) },
      { ...text(), text: 5 },
      { ...text(), text: undefined },
      { ...text(), size: 13 },
      { ...text(), size: '14' },
      { ...text(), size: undefined },
      { ...text(), a: { time: 1, price: NaN } },
      { ...text(), a: undefined },
    ];
    for (const b of bad) expect(sanitizeDrawings([b])).toEqual([]);
  });

  it('drops extra fields and rounds the anchor time', () => {
    const raw = { ...text(), junk: 1, a: { time: 600.7, price: 100 } };
    expect(sanitizeDrawings([raw])).toEqual([{ ...text(), a: { time: 601, price: 100 } }]);
  });
});

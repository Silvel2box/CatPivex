import { useEffect, useRef, useState, type RefObject } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import type { DrawingsPrimitive } from './drawings/DrawingsPrimitive';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, canvasMeasure, textBox } from './drawings/text';
import { DEFAULT_COLOR, DEFAULT_TEXT_SIZE, TEXT_MAX_LENGTH, type Anchor } from './drawings/types';

interface Props {
  primitiveRef: RefObject<DrawingsPrimitive | null>;
  chartRef: RefObject<HTMLElement | null>;
}

export function TextEditor(props: Props) {
  const editing = useDrawingStore((s) => s.editingText);
  if (!editing) return null;
  return (
    <Editor
      key={`${editing.id ?? 'new'}:${editing.a.time}:${editing.a.price}`}
      id={editing.id}
      a={editing.a}
      {...props}
    />
  );
}

function Editor({ id, a, primitiveRef, chartRef }: Props & { id: string | null; a: Anchor }) {
  const drawing = useDrawingStore((s) => {
    const d = id === null ? undefined : s.drawings.find((x) => x.id === id);
    return d?.type === 'text' ? d : null;
  });
  const size = drawing?.size ?? DEFAULT_TEXT_SIZE;
  const color = drawing?.color ?? DEFAULT_COLOR.text;
  const [value, setValue] = useState(drawing?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const { commitText, cancelText } = useDrawingStore.getState();

  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const el = ref.current;
      const p = primitiveRef.current;
      const x = p?.timeToX(a.time) ?? null;
      const y = p?.priceToY(a.price) ?? null;
      if (el) {
        el.style.visibility = x === null || y === null ? 'hidden' : 'visible';
        if (x !== null && y !== null) {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }
      }
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [a, primitiveRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      commitText(el.value);
      if (chartRef.current?.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [chartRef, commitText]);

  const box = textBox(value, size, canvasMeasure(size));

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      aria-label="Text"
      value={value}
      maxLength={TEXT_MAX_LENGTH}
      spellCheck={false}
      wrap="off"
      rows={1}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelText();
        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          commitText(value);
        }
      }}
      onBlur={(e) => {
        if (document.activeElement !== e.currentTarget) commitText(e.currentTarget.value);
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: Math.ceil(box.w) + size,
        height: box.h,
        fontSize: size,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        color,
        caretColor: color,
        outline: `1px dashed ${color}`,
        outlineOffset: 3,
      }}
      className="z-20 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre"
    />
  );
}

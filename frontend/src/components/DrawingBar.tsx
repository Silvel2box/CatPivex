import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { canCarryAlert } from '../chart/drawings/geometry';
import {
  FIB_FILL_ALPHA,
  FIB_FILL_OPTIONS,
  TEXT_SIZES,
  type DrawingWidth,
  type TextSize,
} from '../chart/drawings/types';
import { addLineAlert, alertForLine, useAlertStore } from '../store/alertStore';
import { useDrawingStore } from '../store/drawingStore';
import { btn, svg } from './DrawingToolbar';
import { barPosition, type Pos, type Size } from './drawingBarLogic';
import { FibLevelsPanel } from './FibLevelsPanel';

const WIDTHS: DrawingWidth[] = [1, 2, 3, 4];

function useSize(ref: RefObject<HTMLElement | null>, active: boolean): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return size;
}

/** Floating style bar for the selected drawing; mounted outside the chart container. */
export function DrawingBar({ areaRef }: { areaRef: RefObject<HTMLElement | null> }) {
  const selected = useDrawingStore((s) =>
    s.tool === null ? (s.drawings.find((d) => d.id === s.selectedId) ?? null) : null,
  );
  const symbol = useDrawingStore((s) => s.symbol);
  const saved = useDrawingStore((s) => s.drawingBar);
  const alerts = useAlertStore((s) => s.alerts);
  const { setStyle, remove, reverse, setDrawingBar, startText } = useDrawingStore.getState();
  const barRef = useRef<HTMLDivElement>(null);
  const area = useSize(areaRef, true);
  const bar = useSize(barRef, selected !== null);
  const drag = useRef<{ start: Pos; from: Pos } | null>(null);
  const [dragPos, setDragPos] = useState<Pos | null>(null);

  if (!selected) return null;
  const pos = area && bar ? barPosition(dragPos ?? saved, bar, area) : null;

  const onGripDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pos) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, from: pos };
  };
  const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !area || !bar) return;
    setDragPos(
      barPosition(
        { x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y },
        bar,
        area,
      ),
    );
  };
  const onGripUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dragPos) setDrawingBar(dragPos);
    setDragPos(null);
  };

  const alertable = canCarryAlert(selected);
  const lineAlert = alertable && symbol ? alertForLine(alerts, symbol, selected.id) : null;

  return (
    <div
      ref={barRef}
      data-testid="drawing-style"
      style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
      className="absolute z-20 flex items-center gap-1 rounded border border-[#2a2e39] bg-[#1e222d] p-1 shadow-lg"
    >
      <div
        data-testid="drawing-bar-grip"
        title="Drag to move"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        className="flex h-8 w-4 cursor-grab touch-none items-center justify-center text-[#787b86] hover:text-[#d1d4dc]"
      >
        <svg viewBox="0 0 8 16" className="h-4 w-2" fill="currentColor" aria-hidden>
          {[3, 8, 13].map((y) => (
            <g key={y}>
              <circle cx="2" cy={y} r="1.2" />
              <circle cx="6" cy={y} r="1.2" />
            </g>
          ))}
        </svg>
      </div>
      <input
        type="color"
        data-testid="drawing-color"
        title={selected.type === 'text' ? 'Text colour' : 'Line colour'}
        value={selected.color}
        onChange={(e) => setStyle(selected.id, { color: e.target.value })}
        className="h-6 w-7 cursor-pointer rounded border border-[#2a2e39] bg-transparent p-0"
      />
      {selected.type === 'text' ? (
        <>
          <select
            data-testid="drawing-text-size"
            title="Font size (px)"
            aria-label="Font size (px)"
            value={selected.size}
            onChange={(e) => setStyle(selected.id, { size: Number(e.target.value) as TextSize })}
            className="w-10 rounded border border-[#2a2e39] bg-[#131722] py-0.5 text-center text-[11px] text-[#d1d4dc] outline-none"
          >
            {TEXT_SIZES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="drawing-text-edit"
            title="Edit text"
            onClick={() => startText(selected.id, selected.a)}
            className={btn(false)}
          >
            {svg(<path d="M5 19l1-4L16 5l3 3L9 18zM14 7l3 3" strokeLinejoin="round" />)}
          </button>
        </>
      ) : (
        <select
          data-testid="drawing-width"
          title="Line width (px)"
          aria-label="Line width (px)"
          value={selected.width}
          onChange={(e) => setStyle(selected.id, { width: Number(e.target.value) as DrawingWidth })}
          className="w-9 rounded border border-[#2a2e39] bg-[#131722] py-0.5 text-center text-[11px] text-[#d1d4dc] outline-none"
        >
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      )}
      {selected.type === 'fib' && (
        <>
          <select
            data-testid="drawing-fill"
            title="Background opacity (0% = no fill)"
            aria-label="Background opacity"
            value={selected.fill ?? FIB_FILL_ALPHA}
            onChange={(e) => setStyle(selected.id, { fill: Number(e.target.value) })}
            className="w-10 rounded border border-[#2a2e39] bg-[#131722] py-0.5 text-center text-[11px] text-[#d1d4dc] outline-none"
          >
            {FIB_FILL_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {Math.round(v * 100)}%
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="drawing-reverse"
            title="Reverse: swap levels 0 and 1"
            onClick={() => reverse(selected.id)}
            className={btn(false)}
          >
            {svg(<path d="M8 4v16M8 4 5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3" />)}
          </button>
          <button
            type="button"
            data-testid="drawing-extend"
            title="Extend lines to the right"
            aria-pressed={selected.extend === true}
            onClick={() => setStyle(selected.id, { extend: !selected.extend })}
            className={btn(selected.extend === true)}
          >
            {svg(<path d="M4 8h10M4 12h16M4 16h10M17 9l3 3-3 3" />)}
          </button>
          <FibLevelsPanel key={selected.id} fib={selected} />
        </>
      )}
      {alertable &&
        symbol &&
        (lineAlert ? (
          <button
            type="button"
            data-testid="bar-edit-alert"
            title="Edit alert"
            onClick={() =>
              useAlertStore.getState().openPanel('alerts', { mode: 'edit', id: lineAlert.id })
            }
            className={btn(true)}
          >
            {svg(<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" />)}
          </button>
        ) : (
          <button
            type="button"
            data-testid="bar-add-alert"
            title="Add alert"
            onClick={() => addLineAlert(symbol, selected)}
            className={btn(false)}
          >
            {svg(<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" />)}
          </button>
        ))}
      <button
        type="button"
        data-testid="drawing-delete"
        title="Delete drawing (Delete)"
        onClick={() => remove(selected.id)}
        className="flex h-8 w-8 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-[#ef5350]"
      >
        {svg(<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5" />)}
      </button>
    </div>
  );
}

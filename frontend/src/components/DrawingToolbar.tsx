import type { ReactNode } from 'react';
import {
  FIB_FILL_ALPHA,
  FIB_FILL_OPTIONS,
  type DrawingType,
  type DrawingWidth,
} from '../chart/drawings/types';
import { useDrawingStore } from '../store/drawingStore';

const ICON = 'h-5 w-5';
const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    className={ICON}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    aria-hidden
  >
    {children}
  </svg>
);

const TOOLS: { type: DrawingType; label: string; key: string; icon: ReactNode }[] = [
  {
    type: 'trendline',
    label: 'Trend line',
    key: 'Alt+T',
    icon: svg(
      <>
        <path d="M5 19 19 5" />
        <circle cx="5" cy="19" r="1.8" fill="currentColor" />
        <circle cx="19" cy="5" r="1.8" fill="currentColor" />
      </>,
    ),
  },
  {
    type: 'hline',
    label: 'Horizontal line',
    key: 'Alt+H',
    icon: svg(
      <>
        <path d="M3 12h18" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </>,
    ),
  },
  {
    type: 'hray',
    label: 'Horizontal ray',
    key: 'Alt+J',
    icon: svg(
      <>
        <path d="M6 12h15" />
        <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      </>,
    ),
  },
  {
    type: 'vline',
    label: 'Vertical line',
    key: 'Alt+V',
    icon: svg(
      <>
        <path d="M12 3v18" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </>,
    ),
  },
  {
    type: 'rect',
    label: 'Rectangle',
    key: 'Alt+R',
    icon: svg(<rect x="5" y="7" width="14" height="10" rx="1" />),
  },
  {
    type: 'fib',
    label: 'Fib retracement',
    key: 'Alt+F',
    icon: svg(<path d="M4 5h16M4 9.5h16M4 14h16M4 19h16M6 19 18 5" strokeWidth={1.3} />),
  },
];

const WIDTHS: DrawingWidth[] = [1, 2, 3, 4];

const btn = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded ${
    active
      ? 'bg-[#2962ff]/25 text-[#5b8cff]'
      : 'text-[#b2b5be] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
  }`;

/** Left toolbar: drawing tools, magnet, and style/delete for the selected drawing. */
export function DrawingToolbar() {
  const tool = useDrawingStore((s) => s.tool);
  const magnet = useDrawingStore((s) => s.magnet);
  const selected = useDrawingStore((s) => s.drawings.find((d) => d.id === s.selectedId) ?? null);
  const { setTool, setMagnet, setStyle, remove, reverse } = useDrawingStore.getState();

  return (
    <nav
      aria-label="Drawing tools"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[#2a2e39] py-2"
    >
      <button
        type="button"
        data-testid="draw-tool-cursor"
        title="Cursor (Esc)"
        aria-pressed={tool === null}
        onClick={() => setTool(null)}
        className={btn(tool === null)}
      >
        {svg(<path d="M6 4l12 7-5.5 1.2L15 18l-2 1-2.6-5.6L6 17z" fill="currentColor" />)}
      </button>
      {TOOLS.map((t) => (
        <button
          key={t.type}
          type="button"
          data-testid={`draw-tool-${t.type}`}
          title={`${t.label} (${t.key})`}
          aria-pressed={tool === t.type}
          onClick={() => setTool(tool === t.type ? null : t.type)}
          className={btn(tool === t.type)}
        >
          {t.icon}
        </button>
      ))}
      <div className="my-1 h-px w-6 bg-[#2a2e39]" />
      <button
        type="button"
        data-testid="magnet-toggle"
        title={`Magnet: snap to open/high/low/close (${magnet ? 'on' : 'off'})`}
        aria-pressed={magnet}
        onClick={() => setMagnet(!magnet)}
        className={btn(magnet)}
      >
        {svg(<path d="M7 4v7a5 5 0 0 0 10 0V4M7 4h3v7a2 2 0 0 0 4 0V4h3M7 8h3M14 8h3" />)}
      </button>

      {selected && (
        <div
          data-testid="drawing-style"
          className="mt-2 flex flex-col items-center gap-1.5 border-t border-[#2a2e39] pt-2"
        >
          <input
            type="color"
            data-testid="drawing-color"
            title="Line colour"
            value={selected.color}
            onChange={(e) => setStyle(selected.id, { color: e.target.value })}
            className="h-6 w-7 cursor-pointer rounded border border-[#2a2e39] bg-transparent p-0"
          />
          <select
            data-testid="drawing-width"
            title="Line width (px)"
            aria-label="Line width (px)"
            value={selected.width}
            onChange={(e) =>
              setStyle(selected.id, { width: Number(e.target.value) as DrawingWidth })
            }
            className="w-9 rounded border border-[#2a2e39] bg-[#131722] py-0.5 text-center text-[11px] text-[#d1d4dc] outline-none"
          >
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          {selected.type === 'fib' && (
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
          )}
          {selected.type === 'fib' && (
            <>
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
            </>
          )}
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
      )}
    </nav>
  );
}

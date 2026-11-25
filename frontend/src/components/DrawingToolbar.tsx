import type { ReactNode } from 'react';
import type { DrawingType } from '../chart/drawings/types';
import { useDrawingStore } from '../store/drawingStore';

const ICON = 'h-5 w-5';
export const svg = (children: ReactNode) => (
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

export const btn = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded ${
    active
      ? 'bg-[#2962ff]/25 text-[#5b8cff]'
      : 'text-[#b2b5be] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
  }`;

/** Left toolbar: drawing tools, magnet and stay-in-drawing-mode. */
export function DrawingToolbar() {
  const tool = useDrawingStore((s) => s.tool);
  const magnet = useDrawingStore((s) => s.magnet);
  const measuring = useDrawingStore((s) => s.measuring);
  const stayInTool = useDrawingStore((s) => s.stayInTool);
  const { setTool, setMagnet, setMeasuring, setStayInTool } = useDrawingStore.getState();

  return (
    <nav
      aria-label="Drawing tools"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[#2a2e39] py-2"
    >
      <button
        type="button"
        data-testid="draw-tool-cursor"
        title="Cursor (Esc)"
        aria-pressed={tool === null && !measuring}
        onClick={() => setTool(null)}
        className={btn(tool === null && !measuring)}
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
      <button
        type="button"
        data-testid="draw-tool-measure"
        title="Measure (Shift+click)"
        aria-pressed={measuring}
        onClick={() => setMeasuring(!measuring)}
        className={btn(measuring)}
      >
        {svg(<path d="M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2" strokeLinejoin="round" />)}
      </button>
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
      <button
        type="button"
        data-testid="draw-stay-toggle"
        title={`Stay in drawing mode (${stayInTool ? 'on' : 'off'})`}
        aria-pressed={stayInTool}
        onClick={() => setStayInTool(!stayInTool)}
        className={btn(stayInTool)}
      >
        {svg(
          <>
            <rect x="5.5" y="11" width="13" height="9" rx="1.5" />
            <path
              d={stayInTool ? 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3' : 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'}
            />
          </>,
        )}
      </button>
    </nav>
  );
}

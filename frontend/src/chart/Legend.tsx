import { useSyncExternalStore, type ReactNode } from 'react';
import { useIndicatorPanelStore } from '../store/indicatorPanelStore';
import { useIndicatorStore } from '../store/indicatorStore';
import { formatValue, formatVolume, type LegendModel } from './indicatorData';

/** Tiny external store so crosshair moves re-render only the legend, not the chart view. */
export interface LegendFeed {
  get(): LegendModel | null;
  set(model: LegendModel): void;
  subscribe(cb: () => void): () => void;
}

export function createLegendFeed(): LegendFeed {
  let model: LegendModel | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => model,
    set(next) {
      model = next;
      for (const cb of listeners) cb();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    className="h-3.5 w-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

const EYE = icon(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
const EYE_OFF = icon(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3 3l18 18" />
  </>,
);
const GEAR = icon(
  <>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="12" cy="12" r="6.5" />
    <path
      d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
      strokeWidth={2.4}
    />
  </>,
);
const CROSS = icon(<path d="M6 6l12 12M18 6 6 18" />);

const BUTTON =
  'flex h-4 w-5 items-center justify-center rounded text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]';

function RowControls({ id, hidden }: { id: string; hidden: boolean }) {
  const { toggleVisible, remove } = useIndicatorStore.getState();
  return (
    <span className={`${hidden ? 'flex' : 'hidden group-hover:flex'} items-center`}>
      <button
        type="button"
        data-testid="legend-toggle"
        data-ind-id={id}
        title={hidden ? 'Show' : 'Hide'}
        aria-pressed={!hidden}
        onClick={() => toggleVisible(id)}
        className={BUTTON}
      >
        {hidden ? EYE_OFF : EYE}
      </button>
      <button
        type="button"
        data-testid="legend-settings"
        data-ind-id={id}
        title="Settings"
        onClick={() => useIndicatorPanelStore.getState().openFor(id)}
        className={BUTTON}
      >
        {GEAR}
      </button>
      <button
        type="button"
        data-testid="legend-remove"
        data-ind-id={id}
        title="Remove"
        onClick={() => remove(id)}
        className={BUTTON}
      >
        {CROSS}
      </button>
    </span>
  );
}

export function Legend({ feed }: { feed: LegendFeed }) {
  const model = useSyncExternalStore(feed.subscribe, feed.get);
  if (!model) return null;
  const { bar } = model;
  const fields: [string, string][] = bar
    ? [
        ['O', formatValue(bar.open)],
        ['H', formatValue(bar.high)],
        ['L', formatValue(bar.low)],
        ['C', formatValue(bar.close)],
        ['V', formatVolume(bar.volume)],
      ]
    : [];

  return (
    <div
      data-testid="legend"
      data-time={model.time ?? ''}
      className="flex flex-col gap-0.5 rounded bg-[#131722]/70 px-1 text-xs text-[#d1d4dc] tabular-nums"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">
          {model.symbol} · {model.interval}
        </span>
        {fields.map(([k, v]) => (
          <span key={k}>
            <span className="text-[#787b86]">{k}</span>{' '}
            <span style={{ color: model.color }}>{v}</span>
          </span>
        ))}
      </div>
      {model.rows.map((row) => (
        <div
          key={row.id}
          data-testid="legend-row"
          data-ind-id={row.id}
          data-hidden={row.hidden || undefined}
          className="group pointer-events-auto flex w-fit flex-wrap items-center gap-x-2"
        >
          <span className={`text-[#787b86] ${row.hidden ? 'opacity-50' : ''}`}>{row.label}</span>
          <RowControls id={row.id} hidden={row.hidden} />
          {row.values.map((v) => (
            <span
              key={v.line}
              data-testid="legend-value"
              data-ind-id={row.id}
              data-line={v.line}
              style={{ color: v.color }}
            >
              {v.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

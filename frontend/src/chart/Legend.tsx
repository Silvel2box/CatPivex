import { useSyncExternalStore } from 'react';
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
        <div key={row.id} data-testid="legend-row" className="flex flex-wrap gap-x-2">
          <span className="text-[#787b86]">{row.label}</span>
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

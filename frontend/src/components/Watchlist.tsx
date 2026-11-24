import { useEffect, useState } from 'react';
import { startPolling } from '../realtime/poll';
import { useChartStore } from '../store/chartStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { formatChangePercent, formatPrice, splitSymbol } from './quoteFormat';

const QUOTES_POLL_MS = 30_000;

export function Watchlist() {
  const symbols = useWatchlistStore((s) => s.symbols);
  const quotes = useWatchlistStore((s) => s.quotes);
  const loaded = useWatchlistStore((s) => s.loaded);
  const error = useWatchlistStore((s) => s.error);
  const { load, add, remove, reorder, refreshQuotes } = useWatchlistStore.getState();
  const current = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Restart polling only when the set of symbols changes, not on reorder.
  const quoteKey = [...symbols].sort().join(',');
  useEffect(() => {
    if (!quoteKey) return;
    return startPolling((signal) => refreshQuotes(signal), QUOTES_POLL_MS, { immediate: true });
  }, [quoteKey, refreshQuotes]);

  const inList = symbols.includes(current);

  return (
    <aside
      data-testid="watchlist"
      aria-label="Watchlist"
      className="flex w-60 shrink-0 flex-col border-l border-[#2a2e39] bg-[#131722] text-sm text-[#d1d4dc]"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2a2e39] px-3">
        <span className="font-semibold">Watchlist</span>
        <button
          type="button"
          data-testid="wl-add"
          disabled={inList}
          onClick={() => void add(current)}
          title={inList ? `${current} is already in the watchlist` : `Add ${current}`}
          aria-label={`Add ${current} to watchlist`}
          className="flex h-6 w-6 items-center justify-center rounded text-lg leading-none hover:bg-[#2a2e39] disabled:cursor-default disabled:text-[#4a4e59] disabled:hover:bg-transparent"
        >
          +
        </button>
      </div>

      <div className="flex shrink-0 justify-between px-3 py-1 text-[11px] text-[#787b86]">
        <span>Symbol</span>
        <span>Last / Chg%</span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {symbols.map((symbol, index) => {
          const { ticker, exchange } = splitSymbol(symbol);
          const quote = quotes[symbol];
          const change = formatChangePercent(quote?.change_percent ?? null);
          const active = symbol === current;
          const isOver = drag !== null && drag.over === index && drag.from !== index;
          const dropLine = isOver
            ? drag.from > index
              ? 'border-t-[#2962ff]'
              : 'border-b-[#2962ff]'
            : '';
          return (
            <li
              key={symbol}
              data-testid="wl-row"
              data-symbol={symbol}
              data-active={active || undefined}
              role="button"
              tabIndex={0}
              aria-current={active || undefined}
              onClick={() => setSymbol(symbol)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSymbol(symbol);
                }
              }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', symbol); // Firefox needs data to drag
                setDrag({ from: index, over: index });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (drag.over !== index) setDrag({ ...drag, over: index });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) void reorder(drag.from, index);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              className={`group relative cursor-pointer border-y border-transparent outline-none focus-visible:ring-1 focus-visible:ring-[#2962ff] ${dropLine} ${
                active ? 'bg-[#2a2e39]' : 'hover:bg-[#1e222d]'
              } ${drag?.from === index ? 'opacity-50' : ''}`}
            >
              {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-[#2962ff]" />}
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{ticker}</span>
                  <span className="block truncate text-[11px] text-[#787b86]">{exchange}</span>
                </span>
                <span
                  className="shrink-0 text-right tabular-nums"
                  title={quote?.error ? quote.error.message : undefined}
                >
                  <span className="block">
                    {formatPrice(quote?.price ?? null)}
                    {quote?.error && <span className="ml-1 text-[#ef5350]">!</span>}
                  </span>
                  <span className="block text-[11px]" style={{ color: change.color }}>
                    {change.text}
                  </span>
                </span>
              </div>
              <button
                type="button"
                data-testid="wl-remove"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(symbol);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                title={`Remove ${symbol}`}
                aria-label={`Remove ${symbol} from watchlist`}
                className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-[#2a2e39] text-[#787b86] opacity-0 group-hover:opacity-100 hover:text-[#ef5350] focus-visible:opacity-100"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {loaded && symbols.length === 0 && (
        <p className="px-3 py-2 text-xs text-[#787b86]">Empty. Press + to add the chart symbol.</p>
      )}
      {!loaded && !error && <p className="px-3 py-2 text-xs text-[#787b86]">Loading…</p>}
      {error && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#2a2e39] px-3 py-2 text-xs text-[#ef5350]">
          <span className="min-w-0 truncate" title={error}>
            {error}
          </span>
          {!loaded && (
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 text-[#d1d4dc] hover:underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

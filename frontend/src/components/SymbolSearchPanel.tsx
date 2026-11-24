import { useEffect, useState } from 'react';
import { searchSymbols } from '../api/client';
import type { SymbolInfo } from '../api/types';
import { nextIndex, resolveEnter } from './searchLogic';

const DEBOUNCE_MS = 200;

/**
 * Search box + results (debounced, a newer query aborts the older request). Used by the chart's
 * symbol search and by the watchlist's "+". Mount it when opening; it owns its query.
 */
export function SymbolSearchPanel({
  initialQuery,
  onPick,
  onClose,
  isAdded,
  inputTestId,
  resultTestId,
  className,
}: {
  initialQuery: string;
  onPick: (symbol: string) => void;
  onClose: () => void;
  /** Marks rows that are already added (watchlist); picking them does nothing. */
  isAdded?: (symbol: string) => boolean;
  inputTestId: string;
  resultTestId: string;
  className: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  // Last finished search, tagged with its query so stale rows are never shown for a newer query.
  const [found, setFound] = useState<{ q: string; rows: SymbolInfo[]; error: string | null }>({
    q: '',
    rows: [],
    error: null,
  });
  const [activeRaw, setActive] = useState(0);

  const q = query.trim();
  const fresh = q !== '' && found.q === q;
  const results = fresh ? found.rows : [];
  const loading = q !== '' && !fresh;
  const error = fresh ? found.error : null;
  const active = results.length > 0 ? Math.min(activeRaw, results.length - 1) : -1;

  const pick = (symbol: string) => {
    if (!isAdded?.(symbol)) onPick(symbol);
  };

  useEffect(() => {
    if (q === '') return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchSymbols(q, ctrl.signal)
        .then((rows) => setFound({ q, rows, error: null }))
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setFound({ q, rows: [], error: err instanceof Error ? err.message : 'Search failed' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(nextIndex(active, e.key === 'ArrowDown' ? 1 : -1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = resolveEnter(query, results, active);
      if (picked) pick(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={className}>
      <input
        autoFocus
        data-testid={inputTestId}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onInputKey}
        placeholder="Search: BTC, PTT, AAPL, XAUUSD…"
        spellCheck={false}
        className="w-full border-b border-[#2a2e39] bg-transparent px-3 py-2 text-[#d1d4dc] outline-none placeholder:text-[#787b86]"
      />
      <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
        {results.map((r, i) => {
          const added = isAdded?.(r.symbol) ?? false;
          return (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              aria-disabled={added || undefined}
              data-testid={resultTestId}
              data-symbol={r.symbol}
              data-added={added || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r.symbol);
              }}
              className={`flex items-center gap-3 px-3 py-1.5 ${added ? 'cursor-default' : 'cursor-pointer'} ${
                i === active ? 'bg-[#2a2e39]' : ''
              }`}
            >
              <span className="w-28 truncate font-semibold">{r.symbol.split(':')[1]}</span>
              <span className="flex-1 truncate text-[#787b86]">{r.name}</span>
              {added ? (
                <span className="text-xs text-[#26a69a]">✓ Added</span>
              ) : (
                !r.realtime && <span className="text-xs text-[#f7a600]">Delayed</span>
              )}
              <span className="rounded bg-[#2a2e39] px-1.5 text-xs text-[#b2b5be]">
                {r.exchange}
              </span>
            </li>
          );
        })}
        {results.length === 0 && q !== '' && (
          <li className="px-3 py-2 text-[#787b86]">
            {loading ? 'Searching…' : (error ?? 'No results')}
          </li>
        )}
      </ul>
    </div>
  );
}

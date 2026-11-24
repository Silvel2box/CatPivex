import { useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../api/client';
import type { SymbolInfo } from '../api/types';
import { useChartStore } from '../store/chartStore';
import { isSearchStartKey, nextIndex, resolveEnter } from './searchLogic';

const DEBOUNCE_MS = 200;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function SymbolSearch() {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Last finished search, tagged with its query so stale rows are never shown for a newer query.
  const [found, setFound] = useState<{ q: string; rows: SymbolInfo[]; error: string | null }>({
    q: '',
    rows: [],
    error: null,
  });
  const [activeRaw, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const fresh = q !== '' && found.q === q;
  const results = fresh ? found.rows : [];
  const loading = q !== '' && !fresh;
  const error = fresh ? found.error : null;
  const active = results.length > 0 ? Math.min(activeRaw, results.length - 1) : -1;

  const openWith = (initial: string) => {
    setQuery(initial);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (next: string) => {
    setSymbol(next);
    close();
  };

  // Typing a letter anywhere (outside inputs) opens the search with that letter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || isTypingTarget(e.target) || !isSearchStartKey(e)) return;
      e.preventDefault();
      openWith(e.key);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Debounced search; a newer query aborts the older request.
  useEffect(() => {
    if (!open || q === '') return;
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
  }, [q, open]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(nextIndex(active, e.key === 'ArrowDown' ? 1 : -1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = resolveEnter(query, results, active);
      if (picked) choose(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="symbol-button"
        onClick={() => (open ? close() : openWith(''))}
        className="rounded px-2 py-1 font-semibold hover:bg-[#2a2e39]"
        title="Search symbol (or just start typing)"
      >
        {symbol}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 w-96 rounded border border-[#2a2e39] bg-[#1e222d] shadow-xl">
          <input
            autoFocus
            data-testid="symbol-search-input"
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
            {results.map((r, i) => (
              <li
                key={r.symbol}
                role="option"
                aria-selected={i === active}
                data-testid="symbol-result"
                data-symbol={r.symbol}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r.symbol);
                }}
                className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 ${
                  i === active ? 'bg-[#2a2e39]' : ''
                }`}
              >
                <span className="w-32 truncate font-semibold">{r.symbol.split(':')[1]}</span>
                <span className="flex-1 truncate text-[#787b86]">{r.name}</span>
                {!r.realtime && <span className="text-xs text-[#f7a600]">Delayed</span>}
                <span className="rounded bg-[#2a2e39] px-1.5 text-xs text-[#b2b5be]">
                  {r.exchange}
                </span>
              </li>
            ))}
            {results.length === 0 && query.trim() !== '' && (
              <li className="px-3 py-2 text-[#787b86]">
                {loading ? 'Searching…' : (error ?? 'No results')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

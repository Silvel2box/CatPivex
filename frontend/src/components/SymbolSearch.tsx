import { useEffect, useRef, useState } from 'react';
import { useChartStore } from '../store/chartStore';
import { isSearchStartKey } from './searchLogic';
import { SymbolSearchPanel } from './SymbolSearchPanel';

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function SymbolSearch() {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  /** null = closed; otherwise the text the search box opens with. */
  const [openWith, setOpenWith] = useState<string | null>(null);
  const open = openWith !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => setOpenWith(null);

  // Typing a letter anywhere (outside inputs) opens the search with that letter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || isTypingTarget(e.target) || !isSearchStartKey(e)) return;
      e.preventDefault();
      setOpenWith(e.key);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="symbol-button"
        onClick={() => setOpenWith(open ? null : '')}
        className="rounded px-2 py-1 font-semibold hover:bg-[#2a2e39]"
        title="Search symbol (or just start typing)"
      >
        {symbol}
      </button>

      {open && (
        <SymbolSearchPanel
          initialQuery={openWith}
          onPick={(next) => {
            setSymbol(next);
            close();
          }}
          onClose={close}
          inputTestId="symbol-search-input"
          resultTestId="symbol-result"
          className="absolute top-full left-0 z-20 mt-1 w-96 rounded border border-[#2a2e39] bg-[#1e222d] shadow-xl"
        />
      )}
    </div>
  );
}

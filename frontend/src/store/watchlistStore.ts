import { create } from 'zustand';
import type { Quote } from '../api/types';
import {
  addToWatchlist,
  fetchQuotes,
  fetchWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
} from '../api/watchlist';

/** Move the item at `from` to index `to` (the item ends up at `to`). Returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

/** Append `item` unless already present. Returns a new array. */
export function addIfAbsent<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? [...list] : [...list, item];
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface WatchlistState {
  symbols: string[];
  quotes: Record<string, Quote>;
  loaded: boolean;
  /** Last failed action (load/add/remove/reorder), cleared by the next success. */
  error: string | null;
  load: () => Promise<void>;
  add: (symbol: string) => Promise<void>;
  remove: (symbol: string) => Promise<void>;
  reorder: (from: number, to: number) => Promise<void>;
  refreshQuotes: (signal?: AbortSignal) => Promise<void>;
}

export const useWatchlistStore = create<WatchlistState>()((set, get) => {
  /**
   * Optimistic update: show `next` now, sync with the server, then adopt the server's list.
   * On failure roll back to the previous list, unless something else changed it meanwhile.
   */
  const mutate = async (next: string[], request: () => Promise<{ symbols: string[] }>) => {
    const previous = get().symbols;
    set({ symbols: next });
    try {
      const res = await request();
      if (get().symbols === next) set({ symbols: res.symbols });
      set({ error: null });
    } catch (err) {
      if (get().symbols === next) set({ symbols: previous });
      set({ error: errorMessage(err) });
    }
  };

  return {
    symbols: [],
    quotes: {},
    loaded: false,
    error: null,

    load: async () => {
      try {
        const res = await fetchWatchlist();
        set({ symbols: res.symbols, loaded: true, error: null });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    add: async (symbol) => {
      const { symbols } = get();
      if (symbols.includes(symbol)) return;
      await mutate(addIfAbsent(symbols, symbol), () => addToWatchlist(symbol));
    },

    remove: async (symbol) => {
      const { symbols } = get();
      await mutate(
        symbols.filter((s) => s !== symbol),
        () => removeFromWatchlist(symbol),
      );
    },

    reorder: async (from, to) => {
      const { symbols } = get();
      const next = moveItem(symbols, from, to);
      if (next.every((s, i) => s === symbols[i])) return;
      await mutate(next, () => reorderWatchlist(next));
    },

    refreshQuotes: async (signal) => {
      const { symbols } = get();
      if (symbols.length === 0) return;
      const list = await fetchQuotes(symbols, signal);
      if (signal?.aborted) return;
      const quotes = { ...get().quotes };
      for (const q of list) quotes[q.symbol] = q;
      set({ quotes });
    },
  };
});

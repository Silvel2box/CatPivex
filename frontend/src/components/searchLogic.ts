import type { SymbolInfo } from '../api/types';

/** Move the highlighted row by delta, wrapping around. -1 when there are no rows. */
export function nextIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}

/**
 * What Enter selects: the highlighted row, else the first row, else the typed text when it already
 * looks like a full symbol ("BINANCE:SOLUSDT"). null = nothing to select.
 */
export function resolveEnter(query: string, results: SymbolInfo[], active: number): string | null {
  if (results.length > 0) return results[Math.max(active, 0)]?.symbol ?? null;
  const typed = query.trim().toUpperCase();
  return /^[A-Z]+:[A-Z0-9.=^-]+$/.test(typed) ? typed : null;
}

/** A plain letter/digit typed outside any input opens the search box with that character. */
export function isSearchStartKey(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): boolean {
  return !e.ctrlKey && !e.altKey && !e.metaKey && /^[a-zA-Z0-9]$/.test(e.key);
}

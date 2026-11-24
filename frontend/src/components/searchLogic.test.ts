import { describe, expect, it } from 'vitest';
import type { SymbolInfo } from '../api/types';
import { isSearchStartKey, nextIndex, resolveEnter } from './searchLogic';

const info = (symbol: string): SymbolInfo => ({
  symbol,
  name: symbol,
  exchange: symbol.split(':')[0]!,
  type: 'crypto',
  realtime: true,
});

describe('T2.11 symbol search logic', () => {
  it('nextIndex wraps and handles empty lists', () => {
    expect(nextIndex(-1, 1, 3)).toBe(0);
    expect(nextIndex(-1, -1, 3)).toBe(2);
    expect(nextIndex(2, 1, 3)).toBe(0);
    expect(nextIndex(0, -1, 3)).toBe(2);
    expect(nextIndex(1, 1, 0)).toBe(-1);
  });

  it('resolveEnter picks highlighted row, else first row', () => {
    const rows = [info('BINANCE:ETHUSDT'), info('BINANCE:ETHFIUSDT')];
    expect(resolveEnter('eth', rows, 1)).toBe('BINANCE:ETHFIUSDT');
    expect(resolveEnter('eth', rows, -1)).toBe('BINANCE:ETHUSDT');
  });

  it('resolveEnter accepts a typed full symbol only when there are no rows', () => {
    expect(resolveEnter(' binance:solusdt ', [], -1)).toBe('BINANCE:SOLUSDT');
    expect(resolveEnter('fx:xauusd', [], -1)).toBe('FX:XAUUSD');
    expect(resolveEnter('sol', [], -1)).toBeNull();
    expect(resolveEnter('', [], -1)).toBeNull();
  });

  it('only plain letters/digits open the search', () => {
    const k = (key: string, mod: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {}) =>
      isSearchStartKey({ key, ctrlKey: false, altKey: false, metaKey: false, ...mod });
    expect(k('e')).toBe(true);
    expect(k('7')).toBe(true);
    expect(k('Escape')).toBe(false);
    expect(k(' ')).toBe(false);
    expect(k('h', { altKey: true })).toBe(false); // Alt+H is the hline shortcut (Phase 4)
    expect(k('c', { ctrlKey: true })).toBe(false);
  });
});

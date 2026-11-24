import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addIfAbsent, moveItem, useWatchlistStore } from './watchlistStore';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useWatchlistStore.setState({ symbols: [], quotes: {}, loaded: false, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T2.9a moveItem', () => {
  it('moves an item down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns an unchanged copy for same index or out of range', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(list, 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(list, -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(list, 0, 1)).not.toBe(list);
  });
});

describe('T2.9a addIfAbsent', () => {
  it('appends a new item and ignores an existing one', () => {
    expect(addIfAbsent(['a'], 'b')).toEqual(['a', 'b']);
    expect(addIfAbsent(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });
});

describe('T2.9a watchlist store', () => {
  it('reorder: optimistic update, PUT the new order, adopt the server list', async () => {
    useWatchlistStore.setState({ symbols: ['A:1', 'B:2', 'C:3'], loaded: true });
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const pending = useWatchlistStore.getState().reorder(2, 0);
    expect(useWatchlistStore.getState().symbols).toEqual(['C:3', 'A:1', 'B:2']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/watchlist$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ symbols: ['C:3', 'A:1', 'B:2'] });

    resolve(json({ symbols: ['C:3', 'A:1', 'B:2'] }));
    await pending;
    expect(useWatchlistStore.getState().symbols).toEqual(['C:3', 'A:1', 'B:2']);
    expect(useWatchlistStore.getState().error).toBeNull();
  });

  it('reorder: rolls back on a failed PUT and records the error', async () => {
    useWatchlistStore.setState({ symbols: ['A:1', 'B:2', 'C:3'], loaded: true });
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'internal_error', message: 'db locked' } }, 500),
    );

    await useWatchlistStore.getState().reorder(0, 2);
    expect(useWatchlistStore.getState().symbols).toEqual(['A:1', 'B:2', 'C:3']);
    expect(useWatchlistStore.getState().error).toBe('db locked');
  });

  it('reorder: rolls back on a network error', async () => {
    useWatchlistStore.setState({ symbols: ['A:1', 'B:2'], loaded: true });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await useWatchlistStore.getState().reorder(0, 1);
    expect(useWatchlistStore.getState().symbols).toEqual(['A:1', 'B:2']);
    expect(useWatchlistStore.getState().error).toBe('Failed to fetch');
  });

  it('add: POSTs only when absent', async () => {
    useWatchlistStore.setState({ symbols: ['A:1'], loaded: true });
    fetchMock.mockResolvedValueOnce(json({ symbols: ['A:1', 'SET:PTT'] }));

    await useWatchlistStore.getState().add('A:1');
    expect(fetchMock).not.toHaveBeenCalled();

    await useWatchlistStore.getState().add('SET:PTT');
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ symbol: 'SET:PTT' });
    expect(useWatchlistStore.getState().symbols).toEqual(['A:1', 'SET:PTT']);
  });

  it('remove: DELETEs the encoded symbol, rolls back on failure', async () => {
    useWatchlistStore.setState({ symbols: ['A:1', 'SET:PTT'], loaded: true });
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'upstream_error', message: 'nope' } }, 502),
    );

    await useWatchlistStore.getState().remove('SET:PTT');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('DELETE');
    expect(String(url)).toMatch(/\/api\/watchlist\/SET%3APTT$/);
    expect(useWatchlistStore.getState().symbols).toEqual(['A:1', 'SET:PTT']);
  });

  it('refreshQuotes: requests the list in order and stores quotes by symbol', async () => {
    useWatchlistStore.setState({ symbols: ['A:1', 'B:2'], loaded: true });
    fetchMock.mockResolvedValueOnce(
      json([
        {
          symbol: 'A:1',
          price: 10,
          change: 1,
          change_percent: 11.1,
          time: 1,
          delayed: false,
          error: null,
        },
        {
          symbol: 'B:2',
          price: null,
          change: null,
          change_percent: null,
          time: null,
          delayed: true,
          error: { code: 'upstream_error', message: 'timeout' },
        },
      ]),
    );

    await useWatchlistStore.getState().refreshQuotes();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/quotes');
    expect(url.searchParams.get('symbols')).toBe('A:1,B:2');
    const { quotes } = useWatchlistStore.getState();
    expect(quotes['A:1'].price).toBe(10);
    expect(quotes['B:2'].error?.message).toBe('timeout');
  });
});

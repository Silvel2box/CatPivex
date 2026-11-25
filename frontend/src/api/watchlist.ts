import { API_BASE, ApiError } from './client';
import type { ErrorResponse, Quote, Watchlist } from './types';

/** JSON request with the project error format turned into ApiError. */
export async function requestJson<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: {
    params?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
    /** Lets a save finish while the page unloads. */
    keepalive?: boolean;
  } = {},
): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method,
    signal: options.signal,
    keepalive: options.keepalive,
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ErrorResponse> | null;
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function fetchWatchlist(signal?: AbortSignal): Promise<Watchlist> {
  return requestJson<Watchlist>('GET', '/api/watchlist', { signal });
}

export function addToWatchlist(symbol: string): Promise<Watchlist> {
  return requestJson<Watchlist>('POST', '/api/watchlist', { body: { symbol } });
}

export function reorderWatchlist(symbols: string[]): Promise<Watchlist> {
  return requestJson<Watchlist>('PUT', '/api/watchlist', { body: { symbols } });
}

export function removeFromWatchlist(symbol: string): Promise<Watchlist> {
  return requestJson<Watchlist>('DELETE', `/api/watchlist/${encodeURIComponent(symbol)}`);
}

export function fetchQuotes(symbols: string[], signal?: AbortSignal): Promise<Quote[]> {
  return requestJson<Quote[]>('GET', '/api/quotes', {
    params: { symbols: symbols.join(',') },
    signal,
  });
}

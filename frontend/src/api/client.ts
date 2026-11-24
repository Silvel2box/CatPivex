import type { CandlesResponse, ErrorResponse, Interval, SymbolInfo } from './types';

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ErrorResponse> | null;
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchCandles(
  query: { symbol: string; interval: Interval; end?: number; limit?: number },
  signal?: AbortSignal,
): Promise<CandlesResponse> {
  return getJson<CandlesResponse>('/api/candles', query, signal);
}

export function searchSymbols(q: string, signal?: AbortSignal): Promise<SymbolInfo[]> {
  return getJson<SymbolInfo[]>('/api/symbols/search', { q }, signal);
}

import type { DrawingsResponse, LayoutResponse } from './types';
import { requestJson } from './watchlist';

const drawingsPath = (symbol: string) => `/api/drawings/${encodeURIComponent(symbol)}`;

export function fetchDrawings(symbol: string, signal?: AbortSignal): Promise<DrawingsResponse> {
  return requestJson<DrawingsResponse>('GET', drawingsPath(symbol), { signal });
}

export function saveDrawings(symbol: string, drawings: unknown[]): Promise<DrawingsResponse> {
  return requestJson<DrawingsResponse>('PUT', drawingsPath(symbol), {
    body: { drawings },
    keepalive: true,
  });
}

export function fetchLayout(signal?: AbortSignal): Promise<LayoutResponse> {
  return requestJson<LayoutResponse>('GET', '/api/layout', { signal });
}

export function saveLayout(layout: object): Promise<LayoutResponse> {
  return requestJson<LayoutResponse>('PUT', '/api/layout', { body: { layout }, keepalive: true });
}

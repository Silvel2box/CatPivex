import type { Alert, AlertCreate, AlertEvent, AlertUpdate } from './types';
import { requestJson } from './watchlist';

const alertPath = (id: number) => `/api/alerts/${id}`;

export function fetchAlerts(signal?: AbortSignal): Promise<Alert[]> {
  return requestJson<Alert[]>('GET', '/api/alerts', { signal });
}

export function createAlert(body: AlertCreate): Promise<Alert> {
  return requestJson<Alert>('POST', '/api/alerts', { body });
}

export function updateAlert(id: number, patch: AlertUpdate): Promise<Alert> {
  return requestJson<Alert>('PATCH', alertPath(id), { body: patch });
}

export function deleteAlert(id: number): Promise<void> {
  return requestJson<void>('DELETE', alertPath(id));
}

/** Newest first; only id > after when given. */
export function fetchAlertEvents(
  query: { after?: number; limit?: number },
  signal?: AbortSignal,
): Promise<AlertEvent[]> {
  const params: Record<string, string> = {};
  if (query.after !== undefined) params.after = String(query.after);
  if (query.limit !== undefined) params.limit = String(query.limit);
  return requestJson<AlertEvent[]>('GET', '/api/alerts/events', { params, signal });
}

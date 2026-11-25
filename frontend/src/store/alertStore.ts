import { create } from 'zustand';
import {
  createAlert,
  deleteAlert,
  fetchAlertEvents,
  fetchAlerts,
  updateAlert,
} from '../api/alerts';
import type { Alert, AlertCreate, AlertEvent, AlertUpdate } from '../api/types';
import { flushDrawingSaves } from '../persist/drawingFlush';
import { startPolling, type VisibilitySource } from '../realtime/poll';

export const EVENTS_POLL_MS = 5_000;
/** Events fetched per poll; more than this between two polls -> only the newest are notified. */
export const EVENTS_LIMIT = 50;
export const HISTORY_LIMIT = 100;

export type AlertNotifier = (event: AlertEvent) => void;
export type AlertsTab = 'alerts' | 'history';
export type AlertEditing = { mode: 'create' } | { mode: 'edit'; id: number } | null;

export interface AlertToast {
  id: number;
  title: string;
  body: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const sameSymbol = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export function alertForLine(alerts: Alert[], symbol: string, drawingId: string): Alert | null {
  return alerts.find((a) => a.drawing_id === drawingId && sameSymbol(a.symbol, symbol)) ?? null;
}

export function alertLineIds(alerts: Alert[], symbol: string | null): Set<string> {
  const ids = new Set<string>();
  if (!symbol) return ids;
  for (const a of alerts) {
    if (a.enabled && a.drawing_id && sameSymbol(a.symbol, symbol)) ids.add(a.drawing_id);
  }
  return ids;
}

function mergeEvents(fresh: AlertEvent[], old: AlertEvent[]): AlertEvent[] {
  const seen = new Set<number>();
  return [...fresh, ...old]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.id - a.id)
    .slice(0, HISTORY_LIMIT);
}

interface AlertState {
  alerts: Alert[];
  loaded: boolean;
  error: string | null;
  events: AlertEvent[];
  historyLoaded: boolean;
  /** Newest event id seen; null until the first poll took the baseline. */
  lastEventId: number | null;
  panelOpen: boolean;
  tab: AlertsTab;
  editing: AlertEditing;
  toasts: AlertToast[];

  load: () => Promise<void>;
  create: (body: AlertCreate) => Promise<Alert | null>;
  update: (id: number, patch: AlertUpdate) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
  /** Saves pending drawings first: the backend checks the line exists. */
  addForLine: (symbol: string, drawingId: string, price: number) => Promise<Alert | null>;
  reloadIfLinked: (symbol: string) => void;
  loadHistory: () => Promise<void>;
  pollEvents: (notify: AlertNotifier, signal?: AbortSignal) => Promise<void>;
  openPanel: (tab?: AlertsTab, editing?: AlertEditing) => void;
  closePanel: () => void;
  setTab: (tab: AlertsTab) => void;
  setEditing: (editing: AlertEditing) => void;
  clearError: () => void;
  pushToast: (title: string, body: string) => void;
  dismissToast: (id: number) => void;
}

export const useAlertStore = create<AlertState>()((set, get) => {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let toastSeq = 0;
  // A load that started before a mutation may answer with the old list: replace it by a new one.
  const supersedeLoads = () => {
    if (loadsInFlight > 0) void get().load();
  };

  return {
    alerts: [],
    loaded: false,
    error: null,
    events: [],
    historyLoaded: false,
    lastEventId: null,
    panelOpen: false,
    tab: 'alerts',
    editing: null,
    toasts: [],

    load: async () => {
      const seq = ++loadSeq;
      loadsInFlight++;
      try {
        const alerts = await fetchAlerts();
        if (seq === loadSeq) set({ alerts, loaded: true });
      } catch (err) {
        if (seq === loadSeq) set({ error: errorMessage(err) });
      } finally {
        loadsInFlight--;
      }
    },

    create: async (body) => {
      try {
        const alert = await createAlert(body);
        set((s) => ({
          alerts: [...s.alerts.filter((a) => a.id !== alert.id), alert].sort((a, b) => a.id - b.id),
          error: null,
        }));
        supersedeLoads();
        return alert;
      } catch (err) {
        set({ error: errorMessage(err) });
        return null;
      }
    },

    update: async (id, patch) => {
      try {
        const alert = await updateAlert(id, patch);
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? alert : a)), error: null }));
        supersedeLoads();
        return true;
      } catch (err) {
        set({ error: errorMessage(err) });
        return false;
      }
    },

    remove: async (id) => {
      try {
        await deleteAlert(id);
        set((s) => ({
          alerts: s.alerts.filter((a) => a.id !== id),
          editing: s.editing?.mode === 'edit' && s.editing.id === id ? null : s.editing,
          error: null,
        }));
        supersedeLoads();
        return true;
      } catch (err) {
        set({ error: errorMessage(err) });
        return false;
      }
    },

    addForLine: async (symbol, drawingId, price) => {
      await flushDrawingSaves();
      return get().create({ symbol, condition: 'crosses', price, drawing_id: drawingId });
    },

    reloadIfLinked: (symbol) => {
      if (get().alerts.some((a) => a.drawing_id && sameSymbol(a.symbol, symbol))) void get().load();
    },

    loadHistory: async () => {
      try {
        const events = await fetchAlertEvents({ limit: HISTORY_LIMIT });
        set((s) => ({ events: mergeEvents(events, s.events), historyLoaded: true, error: null }));
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    pollEvents: async (notify, signal) => {
      const after = get().lastEventId;
      if (after === null) {
        const newest = await fetchAlertEvents({ limit: 1 }, signal);
        if (!signal?.aborted && get().lastEventId === null) {
          set({ lastEventId: newest[0]?.id ?? 0 });
        }
        return;
      }
      const list = await fetchAlertEvents({ after, limit: EVENTS_LIMIT }, signal);
      if (signal?.aborted) return;
      const seen = get().lastEventId ?? after;
      const fresh = list.filter((e) => e.id > seen).sort((a, b) => a.id - b.id);
      if (fresh.length === 0) return;
      set((s) => ({
        lastEventId: fresh[fresh.length - 1].id,
        events: mergeEvents(fresh, s.events),
      }));
      for (const e of fresh) {
        try {
          notify(e);
        } catch (err) {
          console.error('Alert notification failed', err);
        }
      }
      // A once-alert is disabled by its trigger.
      void get().load();
    },

    openPanel: (tab, editing) =>
      set((s) => ({
        panelOpen: true,
        tab: tab ?? s.tab,
        editing: editing === undefined ? s.editing : editing,
        error: null,
      })),
    closePanel: () => set({ panelOpen: false, editing: null }),
    setTab: (tab) => set({ tab }),
    setEditing: (editing) => set({ editing, error: null }),
    clearError: () => set({ error: null }),
    pushToast: (title, body) =>
      set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, title, body }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});

export function startAlertPolling(
  notify: AlertNotifier,
  options: { intervalMs?: number; visibility?: VisibilitySource } = {},
): () => void {
  return startPolling(
    (signal) => useAlertStore.getState().pollEvents(notify, signal),
    options.intervalMs ?? EVENTS_POLL_MS,
    { immediate: true, visibility: options.visibility },
  );
}

import type { Candle } from '../api/types';
import { applyRealtimeBar } from '../chart/series';

/** Page visibility, injectable so tests can run without a DOM. */
export interface VisibilitySource {
  isHidden(): boolean;
  /** Call `cb` whenever the page becomes visible. Returns an unsubscribe function. */
  onVisible(cb: () => void): () => void;
}

export const documentVisibility: VisibilitySource = {
  isHidden: () => document.hidden,
  onVisible(cb) {
    const handler = () => {
      if (!document.hidden) cb();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/**
 * Run `task` every `intervalMs` while the page is visible (ticks are skipped while hidden;
 * an overdue run happens as soon as the page is visible again). Runs never overlap.
 * Returns a dispose function that stops the timer and aborts the in-flight run's signal.
 */
export function startPolling(
  task: (signal: AbortSignal) => Promise<unknown>,
  intervalMs: number,
  options: { immediate?: boolean; visibility?: VisibilitySource } = {},
): () => void {
  const visibility = options.visibility ?? documentVisibility;
  const abort = new AbortController();
  let running = false;
  let lastRun = -Infinity;

  const run = () => {
    if (abort.signal.aborted || running || visibility.isHidden()) return;
    running = true;
    lastRun = Date.now();
    Promise.resolve()
      .then(() => task(abort.signal))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) console.error('Polling task failed', err);
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(run, intervalMs);
  const offVisible = visibility.onVisible(() => {
    if (Date.now() - lastRun >= intervalMs) run();
  });
  if (options.immediate) run();

  return () => {
    abort.abort();
    clearInterval(timer);
    offVisible();
  };
}

/**
 * Poll the latest bars of a non-realtime symbol and merge them with `applyRealtimeBar`
 * (same time replaces, newer appends, older ignored). `onBar` gets every applied bar.
 */
export function startLatestBarsPolling(options: {
  fetchLatest: (signal: AbortSignal) => Promise<Candle[]>;
  bars: () => Candle[];
  onBar: (bar: Candle) => void;
  intervalMs?: number;
  visibility?: VisibilitySource;
}): () => void {
  return startPolling(
    async (signal) => {
      const latest = await options.fetchLatest(signal);
      if (signal.aborted) return;
      for (const bar of [...latest].sort((a, b) => a.time - b.time)) {
        if (applyRealtimeBar(options.bars(), bar)) options.onBar(bar);
      }
    },
    options.intervalMs ?? 60_000,
    { visibility: options.visibility },
  );
}

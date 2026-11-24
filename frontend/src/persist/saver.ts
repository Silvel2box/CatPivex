// Debounced saving (T4.4): many changes in a burst -> one PUT with the last value.

export interface DebouncedSaver<T> {
  /** Queue `value` for `key`; restarts that key's timer. Keys are independent. */
  schedule(key: string, value: T): void;
  /** Save every pending key now (symbol switch, page hide). Resolves when those saves settle. */
  flush(): Promise<void>;
  /** Drop pending saves without saving. */
  cancel(): void;
}

/**
 * Trailing debounce per key: `save(key, lastValue)` runs `delayMs` after the last schedule() for
 * that key. A failed save is reported to `onError` (default console.error) and never throws.
 */
export function createDebouncedSaver<T>(
  save: (key: string, value: T) => Promise<void>,
  delayMs = 500,
  onError: (key: string, err: unknown) => void = (key, err) =>
    console.error(`Save failed (${key})`, err),
): DebouncedSaver<T> {
  const pending = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>();
  /** Last save queued per key. Saves of one key run one after another, so the last value lands
   *  last even if an earlier request is slow. These promises never reject. */
  const tails = new Map<string, Promise<void>>();

  async function runSave(key: string, value: T): Promise<void> {
    try {
      await save(key, value);
    } catch (err) {
      try {
        onError(key, err);
      } catch {
        // onError must not break the chain either.
      }
    }
  }

  function fire(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
    // Nothing in flight for this key -> start now (synchronously, so a flush() from a pagehide
    // handler issues the request inside the handler); else queue behind the in-flight save.
    const prev = tails.get(key);
    const next = prev ? prev.then(() => runSave(key, entry.value)) : runSave(key, entry.value);
    tails.set(key, next);
    void next.then(() => {
      if (tails.get(key) === next) tails.delete(key);
    });
  }

  return {
    schedule(key, value) {
      const old = pending.get(key);
      if (old) clearTimeout(old.timer);
      pending.set(key, { value, timer: setTimeout(() => fire(key), delayMs) });
    },
    async flush() {
      for (const key of [...pending.keys()]) fire(key);
      await Promise.all([...tails.values()]);
    },
    cancel() {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

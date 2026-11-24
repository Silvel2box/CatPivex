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
  void save;
  void delayMs;
  void onError;
  throw new Error('not implemented');
}

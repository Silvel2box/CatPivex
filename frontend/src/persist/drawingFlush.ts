// Lets other modules wait for pending drawing saves without importing persistence (no cycle).

let flusher: (() => Promise<void>) | null = null;

/** Registered by startPersistence(); null on cleanup. */
export function setDrawingFlusher(fn: (() => Promise<void>) | null): void {
  flusher = fn;
}

/** Save pending drawing changes now; resolves when they settled (never rejects). */
export function flushDrawingSaves(): Promise<void> {
  return flusher ? flusher() : Promise.resolve();
}

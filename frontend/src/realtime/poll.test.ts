import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../api/types';
import { startLatestBarsPolling, startPolling, type VisibilitySource } from './poll';

const bar = (time: number, close = 1): Candle => ({
  time,
  open: 1,
  high: 1,
  low: 1,
  close,
  volume: 1,
});

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  isHidden() {
    return this.hidden;
  }
  onVisible(cb: () => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (!hidden) for (const cb of this.listeners) cb();
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T2.9c startLatestBarsPolling', () => {
  it('applies polled bars via the merge helper: replace same time, append newer, ignore older', async () => {
    const visibility = new FakeVisibility();
    const bars = [bar(60), bar(120, 5)];
    const fetchLatest = vi.fn(async () => [bar(180, 9), bar(60, 0), bar(120, 7)]);
    const onBar = vi.fn();

    const stop = startLatestBarsPolling({
      fetchLatest,
      bars: () => bars,
      onBar,
      intervalMs: 60_000,
      visibility,
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchLatest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(bars.map((b) => [b.time, b.close])).toEqual([
      [60, 1],
      [120, 7],
      [180, 9],
    ]);
    expect(onBar.mock.calls.map(([b]) => b.time)).toEqual([120, 180]);

    stop();
  });

  it('stops on dispose: no more fetches, in-flight result ignored', async () => {
    const visibility = new FakeVisibility();
    const bars = [bar(60)];
    let resolve!: (c: Candle[]) => void;
    const fetchLatest = vi.fn(
      (signal: AbortSignal) =>
        new Promise<Candle[]>((r) => {
          expect(signal.aborted).toBe(false);
          resolve = r;
        }),
    );
    const onBar = vi.fn();
    const stop = startLatestBarsPolling({
      fetchLatest,
      bars: () => bars,
      onBar,
      intervalMs: 1000,
      visibility,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    const signal = fetchLatest.mock.calls[0][0];

    stop();
    expect(signal.aborted).toBe(true);
    resolve([bar(120)]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(onBar).not.toHaveBeenCalled();
    expect(bars).toHaveLength(1);
    expect(visibility.listenerCount).toBe(0);
  });
});

describe('T2.9c startPolling', () => {
  it('skips ticks while hidden and catches up when visible again', async () => {
    const visibility = new FakeVisibility();
    const task = vi.fn(async () => {});
    const stop = startPolling(task, 30_000, { immediate: true, visibility });
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    visibility.hidden = true;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(task).toHaveBeenCalledTimes(1);

    visibility.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not overlap runs while a task is still pending', async () => {
    const visibility = new FakeVisibility();
    const task = vi.fn(() => new Promise<void>(() => {}));
    const stop = startPolling(task, 1000, { visibility });
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    stop();
  });
});

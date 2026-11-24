import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedSaver } from './saver';

/** A save whose promises the test resolves / rejects by hand. */
function controlledSave() {
  const calls: { key: string; value: number; resolve: () => void; reject: (e: unknown) => void }[] =
    [];
  const save = vi.fn(
    (key: string, value: number) =>
      new Promise<void>((resolve, reject) => calls.push({ key, value, resolve, reject })),
  );
  return { save, calls };
}

describe('T4.4 saver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('10 schedules within 500 ms -> one save with the last value, 500 ms after the last', () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createDebouncedSaver<number>(save, 500);
    for (let i = 0; i < 10; i++) {
      saver.schedule('BTC', i);
      vi.advanceTimersByTime(45); // last schedule at t = 405
    }
    // now t = 450; last schedule at 405 -> due at 905.
    vi.advanceTimersByTime(454);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('BTC', 9);
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keys are independent', () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createDebouncedSaver<number>(save, 500);
    saver.schedule('A', 1);
    vi.advanceTimersByTime(300);
    saver.schedule('B', 2); // must not restart A's timer
    vi.advanceTimersByTime(200);
    expect(save.mock.calls).toEqual([['A', 1]]);
    vi.advanceTimersByTime(300);
    expect(save.mock.calls).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('flush() saves pending keys now and resolves after they settle', async () => {
    const { save, calls } = controlledSave();
    const saver = createDebouncedSaver<number>(save, 500);
    saver.schedule('A', 1);
    saver.schedule('B', 2);
    saver.schedule('A', 3);
    let done = false;
    const flushed = saver.flush().then(() => {
      done = true;
    });
    // Started synchronously inside flush() (matters for a pagehide handler).
    expect(calls.map((c) => [c.key, c.value])).toEqual([
      ['A', 3],
      ['B', 2],
    ]);
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false); // B still in flight
    calls[1].reject(new Error('offline')); // a failed save still settles
    await flushed;
    expect(done).toBe(true);
    // Nothing is left to fire later.
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() with nothing pending resolves', async () => {
    const saver = createDebouncedSaver<number>(() => Promise.resolve(), 500);
    await expect(saver.flush()).resolves.toBeUndefined();
  });

  it('cancel() drops pending keys', async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createDebouncedSaver<number>(save, 500);
    saver.schedule('A', 1);
    saver.schedule('B', 2);
    saver.cancel();
    vi.advanceTimersByTime(5000);
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    // Still usable afterwards.
    saver.schedule('A', 4);
    vi.advanceTimersByTime(500);
    expect(save.mock.calls).toEqual([['A', 4]]);
  });

  it('a rejected save goes to onError and does not throw', async () => {
    const err = new Error('500');
    const onError = vi.fn();
    const saver = createDebouncedSaver<number>(() => Promise.reject(err), 500, onError);
    saver.schedule('A', 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledWith('A', err);
    // A synchronous throw and a throwing onError are contained too.
    const saver2 = createDebouncedSaver<number>(
      () => {
        throw err;
      },
      500,
      () => {
        throw new Error('onError broke');
      },
    );
    saver2.schedule('A', 1);
    await vi.advanceTimersByTimeAsync(500);
    await expect(saver2.flush()).resolves.toBeUndefined();
  });

  it('a schedule made while a save is in flight is saved afterwards, last value last', async () => {
    const { save, calls } = controlledSave();
    const saver = createDebouncedSaver<number>(save, 500);
    saver.schedule('A', 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1); // save(A, 1) in flight
    saver.schedule('A', 2);
    await vi.advanceTimersByTimeAsync(500);
    // Same key: waits for the in-flight request so an older value cannot land after a newer one.
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.value)).toEqual([1, 2]);
    calls[1].resolve();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('an in-flight save of one key does not hold up another key', async () => {
    const { save, calls } = controlledSave();
    const saver = createDebouncedSaver<number>(save, 500);
    saver.schedule('A', 1);
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule('B', 2);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.map((c) => c.key)).toEqual(['A', 'B']);
  });
});

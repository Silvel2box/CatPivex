import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, AlertEvent } from '../api/types';
import { setDrawingFlusher } from '../persist/drawingFlush';
import type { VisibilitySource } from '../realtime/poll';
import { alertForLine, alertLineIds, startAlertPolling, useAlertStore } from './alertStore';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const alert = (id: number, extra: Partial<Alert> = {}): Alert => ({
  id,
  symbol: 'BINANCE:BTCUSDT',
  condition: 'crosses',
  price: 100,
  repeat: false,
  enabled: true,
  drawing_id: null,
  note: '',
  created_at: 1_700_000_000,
  last_triggered_at: null,
  ...extra,
});

const event = (id: number): AlertEvent => ({
  id,
  alert_id: 1,
  symbol: 'BINANCE:BTCUSDT',
  condition: 'crosses',
  level: 100,
  price: 101,
  time: 1_700_000_000 + id,
  message: `event ${id}`,
  deliveries: { telegram: 'ok' },
});

const fetchMock = vi.fn<typeof fetch>();
const call = (i: number) => {
  const [url, init] = fetchMock.mock.calls[i];
  const u = new URL(String(url));
  return {
    method: init?.method ?? 'GET',
    path: u.pathname,
    params: Object.fromEntries(u.searchParams),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
};

const initial = useAlertStore.getState();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useAlertStore.setState(initial, true);
  setDrawingFlusher(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setDrawingFlusher(null);
});

describe('T5 alert store CRUD', () => {
  it('load: GET /api/alerts fills the list', async () => {
    fetchMock.mockResolvedValueOnce(json([alert(1), alert(2)]));
    await useAlertStore.getState().load();
    expect(call(0)).toMatchObject({ method: 'GET', path: '/api/alerts' });
    expect(useAlertStore.getState().alerts.map((a) => a.id)).toEqual([1, 2]);
    expect(useAlertStore.getState().loaded).toBe(true);
  });

  it('create: POST the body, append the returned alert', async () => {
    useAlertStore.setState({ alerts: [alert(1)] });
    fetchMock.mockResolvedValueOnce(json(alert(5, { price: 123 }), 201));
    const body = { symbol: 'BINANCE:BTCUSDT', condition: 'gte' as const, price: 123 };
    const created = await useAlertStore.getState().create(body);
    expect(call(0)).toMatchObject({ method: 'POST', path: '/api/alerts', body });
    expect(created?.id).toBe(5);
    expect(useAlertStore.getState().alerts.map((a) => a.id)).toEqual([1, 5]);
    expect(useAlertStore.getState().error).toBeNull();
  });

  it('update: PATCH only the given fields, replace the alert', async () => {
    useAlertStore.setState({ alerts: [alert(1), alert(2)] });
    fetchMock.mockResolvedValueOnce(json(alert(2, { enabled: false })));
    expect(await useAlertStore.getState().update(2, { enabled: false })).toBe(true);
    expect(call(0)).toMatchObject({
      method: 'PATCH',
      path: '/api/alerts/2',
      body: { enabled: false },
    });
    expect(useAlertStore.getState().alerts[1].enabled).toBe(false);
  });

  it('remove: DELETE (204, no body) drops the alert', async () => {
    useAlertStore.setState({ alerts: [alert(1), alert(2)], editing: { mode: 'edit', id: 2 } });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await useAlertStore.getState().remove(2)).toBe(true);
    expect(call(0)).toMatchObject({ method: 'DELETE', path: '/api/alerts/2' });
    expect(useAlertStore.getState().alerts.map((a) => a.id)).toEqual([1]);
    expect(useAlertStore.getState().editing).toBeNull();
  });

  it('422 surfaces the server message, keeps the list', async () => {
    useAlertStore.setState({ alerts: [alert(1, { drawing_id: 'd-1' })] });
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'validation_error', message: 'Move the line instead' } }, 422),
    );
    expect(await useAlertStore.getState().update(1, { price: 5 })).toBe(false);
    expect(useAlertStore.getState().error).toBe('Move the line instead');
    expect(useAlertStore.getState().alerts[0].price).toBe(100);

    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'validation_error', message: 'x' } }, 422),
    );
    expect(await useAlertStore.getState().create({ symbol: 'A', condition: 'gte', price: 1 })).toBe(
      null,
    );
    expect(useAlertStore.getState().error).toBe('x');
  });

  it('a load started before a create is replaced by a fresh one', async () => {
    let resolveOld!: (r: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(json(alert(3), 201))
      .mockResolvedValueOnce(json([alert(3)]));
    const loading = useAlertStore.getState().load();
    await useAlertStore.getState().create({ symbol: 'A', condition: 'gte', price: 1 });
    resolveOld(json([]));
    await loading;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(useAlertStore.getState().alerts.map((a) => a.id)).toEqual([3]));
  });
});

describe('T5 linked alerts', () => {
  it('addForLine flushes drawing saves before the POST', async () => {
    const order: string[] = [];
    let finishFlush!: () => void;
    setDrawingFlusher(() => {
      order.push('flush');
      return new Promise<void>((r) => (finishFlush = r));
    });
    fetchMock.mockImplementation(async (_url, init) => {
      order.push(String(init?.method));
      return json(alert(9, { drawing_id: 'd-1', price: 42 }), 201);
    });

    const pending = useAlertStore.getState().addForLine('BINANCE:BTCUSDT', 'd-1', 42);
    await Promise.resolve();
    expect(order).toEqual(['flush']);
    finishFlush();
    await pending;
    expect(order).toEqual(['flush', 'POST']);
    expect(call(0).body).toEqual({
      symbol: 'BINANCE:BTCUSDT',
      condition: 'crosses',
      price: 42,
      drawing_id: 'd-1',
    });
  });

  it('reloadIfLinked reloads only when the symbol has linked alerts', async () => {
    useAlertStore.setState({ alerts: [alert(1, { drawing_id: 'd-1' })] });
    fetchMock.mockResolvedValue(json([]));
    useAlertStore.getState().reloadIfLinked('SET:PTT');
    expect(fetchMock).not.toHaveBeenCalled();
    useAlertStore.getState().reloadIfLinked('binance:btcusdt');
    expect(call(0)).toMatchObject({ method: 'GET', path: '/api/alerts' });
  });

  it('alertForLine / alertLineIds match by drawing id and symbol; bell only when enabled', () => {
    const list = [
      alert(1, { drawing_id: 'd-1' }),
      alert(2, { drawing_id: 'd-2', enabled: false }),
      alert(3, { drawing_id: 'd-3', symbol: 'SET:PTT' }),
      alert(4),
    ];
    expect(alertForLine(list, 'BINANCE:BTCUSDT', 'd-2')?.id).toBe(2);
    expect(alertForLine(list, 'BINANCE:BTCUSDT', 'd-3')).toBeNull();
    expect([...alertLineIds(list, 'BINANCE:BTCUSDT')]).toEqual(['d-1']);
    expect(alertLineIds(list, null).size).toBe(0);
  });
});

class FakeVisibility implements VisibilitySource {
  isHidden() {
    return false;
  }
  onVisible() {
    return () => {};
  }
}

describe('T5 alert events polling', () => {
  it('baseline silently, then each new event once in id order, after=<newest id>', async () => {
    vi.useFakeTimers();
    const responses: Record<string, unknown[]> = {
      first: [event(7)],
      after7: [event(9), event(8)],
      after9: [event(9)], // stale repeat must not notify again
    };
    const eventCalls: Record<string, string>[] = [];
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/api/alerts') return json([alert(1, { enabled: false })]);
      const params = Object.fromEntries(u.searchParams);
      eventCalls.push(params);
      if (params.after === undefined) return json(responses.first);
      return json(responses[`after${params.after}`] ?? []);
    });
    const notify = vi.fn<(e: AlertEvent) => void>();
    const stop = startAlertPolling(notify, { intervalMs: 5000, visibility: new FakeVisibility() });

    await vi.advanceTimersByTimeAsync(0);
    expect(eventCalls).toEqual([{ limit: '1' }]);
    expect(useAlertStore.getState().lastEventId).toBe(7);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(eventCalls[1]).toEqual({ after: '7', limit: '50' });
    expect(notify.mock.calls.map(([e]) => e.id)).toEqual([8, 9]);
    expect(useAlertStore.getState().lastEventId).toBe(9);
    expect(useAlertStore.getState().events.map((e) => e.id)).toEqual([9, 8]);
    // The list is refreshed (a once-alert got disabled).
    expect(useAlertStore.getState().alerts[0].enabled).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(eventCalls[2]).toEqual({ after: '9', limit: '50' });
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });

  it('no events yet -> baseline 0, the first real event notifies', async () => {
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([event(1)]));
    fetchMock.mockResolvedValue(json([]));
    const notify = vi.fn();
    await useAlertStore.getState().pollEvents(notify);
    expect(useAlertStore.getState().lastEventId).toBe(0);
    await useAlertStore.getState().pollEvents(notify);
    expect(call(1).params).toEqual({ after: '0', limit: '50' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a failing notifier does not stop the others', async () => {
    useAlertStore.setState({ lastEventId: 1 });
    fetchMock.mockResolvedValueOnce(json([event(3), event(2)])).mockResolvedValue(json([]));
    const seen: number[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useAlertStore.getState().pollEvents((e) => {
      seen.push(e.id);
      if (e.id === 2) throw new Error('boom');
    });
    expect(seen).toEqual([2, 3]);
    errorSpy.mockRestore();
  });
});

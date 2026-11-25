import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '../api/types';
import { useAlertStore } from '../store/alertStore';
import { useChartStore } from '../store/chartStore';
import { useDrawingStore } from '../store/drawingStore';
import { startPersistence } from './sync';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SYMBOL = 'BINANCE:BTCUSDT';
const linked: Alert = {
  id: 9,
  symbol: SYMBOL,
  condition: 'crosses',
  price: 42,
  repeat: false,
  enabled: true,
  drawing_id: 'd-1',
  note: '',
  created_at: 0,
  last_triggered_at: null,
};

const fetchMock = vi.fn<typeof fetch>();
const requests = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`,
  );

const initialAlerts = useAlertStore.getState();
const initialDrawings = useDrawingStore.getState();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    if (path.startsWith('/api/drawings/')) {
      const body = init?.body ? JSON.parse(String(init.body)) : { drawings: [] };
      return json({ symbol: SYMBOL, drawings: body.drawings });
    }
    if (path === '/api/alerts' && method === 'POST') return json(linked, 201);
    if (path === '/api/alerts') return json([]);
    return json({ layout: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  useChartStore.setState({ symbol: SYMBOL });
  useAlertStore.setState(initialAlerts, true);
  useDrawingStore.setState(initialDrawings, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function started() {
  const stop = startPersistence();
  await vi.waitFor(() => expect(useDrawingStore.getState().loading).toBe(false));
  fetchMock.mockClear();
  return stop;
}

describe('T5 drawings persistence + linked alerts', () => {
  it('"Add alert" on a new line: PUT the drawings first, then POST the alert', async () => {
    const stop = await started();
    useDrawingStore
      .getState()
      .add({ id: 'd-1', type: 'hline', price: 42, color: '#2962ff', width: 1 });
    // Without the flush the debounced PUT would come 500 ms later, after the POST.
    await useAlertStore.getState().addForLine(SYMBOL, 'd-1', 42);
    expect(requests()).toEqual([
      `PUT /api/drawings/${encodeURIComponent(SYMBOL)}`,
      'POST /api/alerts',
    ]);
    stop();
  });

  it('a drawings save reloads the alerts when the symbol has a linked one', async () => {
    const stop = await started();
    useAlertStore.setState({ alerts: [linked] });
    useDrawingStore
      .getState()
      .add({ id: 'd-2', type: 'hline', price: 50, color: '#2962ff', width: 1 });
    stop(); // flushes the pending save
    await vi.waitFor(() =>
      expect(requests()).toEqual([
        `PUT /api/drawings/${encodeURIComponent(SYMBOL)}`,
        'GET /api/alerts',
      ]),
    );
  });
});

import { expect, test, type APIRequestContext, type Page } from './fixtures';

// Uses the e2e DB (see playwright.config.ts); the list is still saved/restored so tests stay independent.
import { E2E_API as API } from '../playwright.config';
let saved: string[] = [];

const getList = async (request: APIRequestContext) =>
  ((await (await request.get(`${API}/api/watchlist`)).json()) as { symbols: string[] }).symbols;
const putList = (request: APIRequestContext, symbols: string[]) =>
  request.put(`${API}/api/watchlist`, { data: { symbols } });

const state = (page: Page) =>
  page.evaluate(() => window.__catpivex!.state() as unknown as {
    symbol: string;
    barCount: number;
    loading: boolean;
    delayed: boolean;
  });

async function waitSymbolLoaded(page: Page, symbol: string, timeout = 30_000) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s.symbol === symbol && !s.loading && s.barCount > 0;
      },
      { timeout, intervals: [200] },
    )
    .toBe(true);
}

const row = (page: Page, symbol: string) =>
  page.locator(`[data-testid="wl-row"][data-symbol="${symbol}"]`);
const rowOrder = (page: Page) =>
  page.locator('[data-testid="wl-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-symbol')));

test.beforeAll(async ({ request }) => {
  saved = await getList(request);
});
test.afterAll(async ({ request }) => {
  await putList(request, saved);
});

test.beforeEach(async ({ page, request }) => {
  await putList(request, ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'SET:PTT', 'US:AAPL']);
  await page.goto('/');
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitSymbolLoaded(page, 'BINANCE:BTCUSDT');
});

test('T2.9e rows show prices and change % from /api/quotes', async ({ page }) => {
  await expect(page.locator('[data-testid="wl-row"]')).toHaveCount(4);
  for (const s of ['BINANCE:BTCUSDT', 'SET:PTT', 'US:AAPL']) {
    await expect(row(page, s)).toContainText(/\d/, { timeout: 30_000 });
    await expect(row(page, s)).toContainText('%', { timeout: 30_000 });
  }
});

test('T2.9f quotes refresh by themselves (a second /api/quotes call within 35s)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.waitForRequest((r) => r.url().includes('/api/quotes'), { timeout: 35_000 });
});

test('T2.9g click a SET row → chart switches and shows Delayed; Binance has no badge', async ({
  page,
}) => {
  await expect(page.getByTestId('delayed-badge')).toHaveCount(0);
  await row(page, 'SET:PTT').click();
  await waitSymbolLoaded(page, 'SET:PTT');
  await expect(page.getByTestId('delayed-badge')).toBeVisible();
  expect((await state(page)).delayed).toBe(true);
});

test('T2.9h add current symbol, remove a row, both persist after reload', async ({ page, request }) => {
  await page.getByTestId('symbol-button').click();
  await page.getByTestId('symbol-search-input').fill('BINANCE:BNBUSDT');
  await page.locator('[data-testid="symbol-result"][data-symbol="BINANCE:BNBUSDT"]').click();
  await waitSymbolLoaded(page, 'BINANCE:BNBUSDT');

  await page.getByTestId('wl-add').click();
  await expect(row(page, 'BINANCE:BNBUSDT')).toBeVisible();
  await expect(page.getByTestId('wl-add')).toBeDisabled();

  await row(page, 'US:AAPL').hover();
  await row(page, 'US:AAPL').getByTestId('wl-remove').click();
  await expect(row(page, 'US:AAPL')).toHaveCount(0);

  await expect
    .poll(() => getList(request))
    .toEqual(['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'SET:PTT', 'BINANCE:BNBUSDT']);
  await page.reload();
  await expect.poll(() => rowOrder(page)).toEqual([
    'BINANCE:BTCUSDT',
    'BINANCE:ETHUSDT',
    'SET:PTT',
    'BINANCE:BNBUSDT',
  ]);
});

test('T2.9i drag to reorder persists', async ({ page, request }) => {
  await row(page, 'US:AAPL').dragTo(row(page, 'BINANCE:BTCUSDT'));
  await expect.poll(() => rowOrder(page)).toEqual([
    'US:AAPL',
    'BINANCE:BTCUSDT',
    'BINANCE:ETHUSDT',
    'SET:PTT',
  ]);
  await expect.poll(() => getList(request)).toEqual([
    'US:AAPL',
    'BINANCE:BTCUSDT',
    'BINANCE:ETHUSDT',
    'SET:PTT',
  ]);
});

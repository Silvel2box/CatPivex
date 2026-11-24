import { expect, test, type Page } from '@playwright/test';
import { E2E_API } from '../playwright.config';

type Bar = { time: number; close: number };
const state = (page: Page) =>
  page.evaluate(() => window.__catpivex!.state() as unknown as {
    symbol: string;
    barCount: number;
    loading: boolean;
    lastBar: Bar | null;
    wsConnected: boolean;
  });

async function waitSymbolLoaded(page: Page, symbol: string) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s.symbol === symbol && !s.loading && s.barCount > 0;
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
}

const input = (page: Page) => page.getByTestId('symbol-search-input');
const rows = (page: Page) => page.getByTestId('symbol-result');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitSymbolLoaded(page, 'BINANCE:BTCUSDT');
});

test('T2.12a typing a letter on the chart opens search; picking ETHUSDT switches the chart', async ({
  page,
}) => {
  await page.getByTestId('chart').click();
  await page.keyboard.press('e');
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveValue('e');

  await input(page).fill('eth');
  const eth = page.locator('[data-testid="symbol-result"][data-symbol="BINANCE:ETHUSDT"]');
  await expect(eth).toBeVisible({ timeout: 10_000 });
  await eth.click();

  await expect(input(page)).toBeHidden();
  await expect(page.getByTestId('symbol-button')).toHaveText('BINANCE:ETHUSDT');
  await waitSymbolLoaded(page, 'BINANCE:ETHUSDT');

  // Chart and realtime now follow ETH: last bar close within 1% of the API's latest ETH close.
  await expect.poll(async () => (await state(page)).wsConnected, { timeout: 10_000 }).toBe(true);
  const api = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/candles?symbol=BINANCE:ETHUSDT&interval=1m&limit=1`);
    return (await r.json()).candles[0].close as number;
  }, E2E_API);
  const chartClose = (await state(page)).lastBar!.close;
  expect(Math.abs(chartClose - api) / api).toBeLessThan(0.01);
});

test('T2.12b arrow keys + Enter pick the highlighted row', async ({ page }) => {
  await page.getByTestId('symbol-button').click();
  await input(page).fill('sol');
  await expect(rows(page).nth(1)).toBeVisible({ timeout: 10_000 });
  const second = await rows(page).nth(1).getAttribute('data-symbol');

  await input(page).press('ArrowDown');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await input(page).press('Enter');
  await waitSymbolLoaded(page, second!);
});

test('T2.12c Escape closes without changing the symbol', async ({ page }) => {
  await page.getByTestId('symbol-button').click();
  await input(page).fill('eth');
  await expect(rows(page).first()).toBeVisible({ timeout: 10_000 });
  await input(page).press('Escape');
  await expect(input(page)).toBeHidden();
  expect((await state(page)).symbol).toBe('BINANCE:BTCUSDT');
});

test('T2.12d unknown query shows "No results"', async ({ page }) => {
  await page.getByTestId('symbol-button').click();
  await input(page).fill('zzzqqq999');
  await expect(page.getByText('No results')).toBeVisible({ timeout: 10_000 });
});

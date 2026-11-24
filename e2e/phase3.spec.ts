import { expect, test } from '@playwright/test';
import { E2E_API } from '../playwright.config';
import { addIndicators, hook, openApp, waitLoaded, type Hook } from './phase3-helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('T3.4 legend shows the hovered bar and the SMA value at that bar', async ({ page, request }) => {
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
  await addIndicators(page, ['sma']);
  await expect.poll(() => hook(page, (h) => h.indicators()[0]?.lines.value?.count ?? 0)).toBeGreaterThan(400);

  // Independent expected value: SMA20 computed here from the API's candles.
  const res = await request.get(`${E2E_API}/api/candles?symbol=BINANCE:BTCUSDT&interval=1h&limit=500`);
  const bars = (await res.json()).candles as { time: number; close: number }[];
  const i = bars.length - 30;
  const t = bars[i]!.time;
  const sma = bars.slice(i - 19, i + 1).reduce((s, b) => s + b.close, 0) / 20;

  const x = await page.evaluate(
    (time) => (window as unknown as { __catpivex: Hook }).__catpivex.xForTime(time),
    t,
  );
  expect(x).not.toBeNull();
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.mouse.move(box.x + x!, box.y + box.height * 0.3);

  const legend = page.getByTestId('legend');
  await expect(legend).toHaveAttribute('data-time', String(t));
  const shown = await legend.locator('[data-testid="legend-value"][data-line="value"]').first().innerText();
  expect(Math.abs(Number(shown.replace(/,/g, '')) - sma)).toBeLessThan(0.01);
  await expect(legend).toContainText(bars[i]!.close.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
});

test('T3.8 line width picked in the panel reaches the chart series; histogram has no picker', async ({
  page,
}) => {
  await page.getByTestId('indicators-button').click();
  await page.getByTestId('ind-add-macd').click();
  const row = page.getByTestId('ind-instance').first();
  await expect(row.getByTestId('ind-width-hist')).toHaveCount(0);
  await expect.poll(() => hook(page, (h) => h.indicators()[0]?.lines.signal?.width)).toBe(1);
  await row.getByTestId('ind-width-signal').selectOption('4');
  await expect.poll(() => hook(page, (h) => h.indicators()[0]?.lines.signal?.width)).toBe(4);
  expect(await hook(page, (h) => h.indicators()[0]?.lines.macd?.width)).toBe(1);
  expect(await hook(page, (h) => h.indicators()[0]?.lines.signal?.count)).toBeGreaterThan(0);
});

test('T3.4b RSI and MACD get their own panes; removing them removes the panes', async ({ page }) => {
  const before = await hook(page, (h) => h.paneCount());
  await addIndicators(page, ['rsi', 'macd']);
  await expect.poll(() => hook(page, (h) => h.paneCount())).toBe(before + 2);
  await page.getByTestId('indicators-button').click();
  const removes = page.getByTestId('ind-remove');
  while ((await removes.count()) > 0) await removes.first().click();
  await expect.poll(() => hook(page, (h) => h.paneCount())).toBe(before);
});

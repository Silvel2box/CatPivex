import { expect, test } from './fixtures';
import { addIndicators, hook, openApp } from './phase3-helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('T7.1 Stochastic and Stoch RSI draw k/d within 0..100, each in its own pane', async ({
  page,
}) => {
  expect(await hook(page, (h) => h.state().symbol)).toBe('BINANCE:BTCUSDT');
  const before = await hook(page, (h) => h.paneCount());
  await addIndicators(page, ['stoch', 'stochrsi']);
  await expect.poll(() => hook(page, (h) => h.paneCount())).toBe(before + 2);

  for (const type of ['stoch', 'stochrsi']) {
    await expect
      .poll(() =>
        page.evaluate((t) => {
          const ind = window.__catpivex!.indicators().find((i) => i.type === t);
          return Math.min(ind?.lines.k?.count ?? 0, ind?.lines.d?.count ?? 0);
        }, type),
      )
      .toBeGreaterThan(0);
    const last = await page.evaluate((t) => {
      const ind = window.__catpivex!.indicators().find((i) => i.type === t)!;
      return [ind.lines.k?.last?.value, ind.lines.d?.last?.value];
    }, type);
    for (const v of last) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }
});

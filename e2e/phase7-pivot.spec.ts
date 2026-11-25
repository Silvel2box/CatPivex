import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { addIndicators, hook, openApp, waitLoaded } from './phase3-helpers';

const pivotLines = (page: Page) =>
  hook(page, (h) => h.indicators().find((i) => i.type === 'pivot') ?? null);

const savedLayout = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/layout`)).json()).layout as {
    indicators?: { type: string; params: Record<string, number> }[];
  } | null;

test('T7.3 Pivot Points on BTC 1m: P from yesterday, Camarilla via the select, kept after reload', async ({
  page,
}) => {
  await openApp(page);
  await addIndicators(page, ['pivot']);

  await expect
    .poll(async () => (await pivotLines(page))?.lines.P.count ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const pivot = (await pivotLines(page))!;
  expect(pivot.params).toEqual({ kind: 0, timeframe: 0 });
  for (const k of ['R1', 'S1']) expect(pivot.lines[k].count).toBeGreaterThan(0);
  for (const k of ['R4', 'S4']) expect(pivot.lines[k].count).toBe(0);

  const res = await page.request.get(
    `${E2E_API}/api/candles?symbol=BINANCE:BTCUSDT&interval=1D&limit=3`,
  );
  const daily = (await res.json()).candles as { time: number; high: number; low: number; close: number }[];
  const today = daily[daily.length - 1];
  const yesterday = daily[daily.length - 2];
  const last = pivot.lines.P.last!;
  expect(last.time).toBeGreaterThanOrEqual(today.time);
  const expected = (yesterday.high + yesterday.low + yesterday.close) / 3;
  expect(Math.abs(last.value - expected)).toBeLessThan(1e-6 * expected);

  await page.getByTestId('indicators-button').click();
  const kind = page.getByTestId('ind-param-kind');
  await expect(kind).toHaveValue('0');
  await kind.selectOption({ label: 'Camarilla' });
  await expect
    .poll(async () => (await pivotLines(page))?.lines.R4.count ?? 0)
    .toBeGreaterThan(0);
  const cam = (await pivotLines(page))!;
  expect(cam.params).toEqual({ kind: 2, timeframe: 0 });
  expect(cam.lines.S4.count).toBe(cam.lines.R4.count);
  const range = yesterday.high - yesterday.low;
  expect(Math.abs(cam.lines.R4.last!.value - (yesterday.close + (1.1 * range) / 2))).toBeLessThan(
    1e-6 * yesterday.close,
  );
  await expect(page.getByTestId('ind-instance')).toContainText('Pivot Points Camarilla Auto');

  await expect
    .poll(async () => (await savedLayout(page))?.indicators?.[0]?.params.kind)
    .toBe(2);
  await page.reload();
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitLoaded(page, '1m');
  await expect
    .poll(async () => (await pivotLines(page))?.lines.R4.count ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await page.getByTestId('indicators-button').click();
  await expect(page.getByTestId('ind-param-kind')).toHaveValue('2');
  await expect(page.getByTestId('ind-param-timeframe')).toHaveValue('0');
});

import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { addIndicators, hook, openApp, waitLoaded } from './phase3-helpers';

const BTC = 'BINANCE:BTCUSDT';

type W = {
  __catpivex: {
    state(): { lastBar: { time: number } | null };
    drawings(): {
      symbol: string | null;
      loading: boolean;
      selectedId: string | null;
      drawings: unknown[];
    };
    xForTime(time: number): number | null;
    timeToX(time: number): number | null;
  };
};

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());

async function chartState(page: Page, time: number) {
  const [x, d] = await page.evaluate((t) => {
    const h = (window as unknown as W).__catpivex;
    return [h.xForTime(t), h.drawings()] as const;
  }, time);
  return { x, selectedId: d.selectedId, count: d.drawings.length };
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
});

test('T7.4 legend row controls: hide/show, settings, remove — without touching the chart', async ({
  page,
}) => {
  // 1D: no new bar arrives mid-test, so the x of a fixed bar only moves if the chart pans.
  await page.getByTestId('tf-1D').click();
  await waitLoaded(page, '1D');
  const panesBefore = await hook(page, (h) => h.paneCount());
  await addIndicators(page, ['sma', 'rsi']);
  await expect.poll(() => hook(page, (h) => h.paneCount())).toBe(panesBefore + 1);
  const [sma, rsi] = await hook(page, (h) => h.indicators().map((i) => i.id));
  await expect
    .poll(() => hook(page, (h) => h.indicators()[0]?.lines.value?.count ?? 0))
    .toBeGreaterThan(400);

  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.keyboard.press('Alt+V');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const lastTime = (await page.evaluate(() => (window as unknown as W).__catpivex.state().lastBar))!
    .time;
  const refTime = lastTime - 30 * 86_400;
  const before = await chartState(page, refTime);
  expect(before.selectedId).not.toBeNull();
  expect(before.x).not.toBeNull();

  const legend = page.getByTestId('legend');
  const smaRow = legend.locator(`[data-testid="legend-row"][data-ind-id="${sma}"]`);
  const rsiRow = legend.locator(`[data-testid="legend-row"][data-ind-id="${rsi}"]`);
  const smaToggle = smaRow.getByTestId('legend-toggle');

  await expect(smaToggle).toBeHidden();
  await smaRow.hover();
  for (const id of ['legend-toggle', 'legend-settings', 'legend-remove'])
    await expect(smaRow.getByTestId(id)).toBeVisible();
  await expect(smaToggle).toHaveAttribute('data-ind-id', sma!);
  await expect(rsiRow.getByTestId('legend-toggle')).toBeHidden();

  await expect(smaToggle).toHaveAttribute('title', 'Hide');
  await smaToggle.click();
  await expect.poll(() => hook(page, (h) => h.indicators().map((i) => i.id))).toEqual([rsi]);
  await expect(smaRow).toHaveAttribute('data-hidden', 'true');
  await expect(smaRow.getByTestId('legend-value')).toHaveCount(0);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.8);
  await expect(smaToggle).toBeVisible();
  await expect(smaToggle).toHaveAttribute('title', 'Show');
  await smaToggle.click();
  await expect
    .poll(() => hook(page, (h) => h.indicators().map((i) => [i.id, i.lines.value?.count ?? 0])))
    .toEqual([
      [sma, expect.any(Number)],
      [rsi, expect.any(Number)],
    ]);
  expect(await hook(page, (h) => h.indicators()[0]!.lines.value!.count)).toBeGreaterThan(400);
  await expect(smaRow).not.toHaveAttribute('data-hidden');
  await expect(smaRow.getByTestId('legend-value')).toHaveCount(1);

  await smaRow.hover();
  await smaRow.getByTestId('legend-settings').click();
  const panel = page.getByTestId('indicator-panel');
  await expect(panel).toBeVisible();
  const item = panel.locator(`[data-testid="ind-instance"][data-ind-id="${sma}"]`);
  await expect(item).toHaveAttribute('data-focused', 'true');
  await expect(panel.locator('[data-focused]')).toHaveCount(1);
  const length = item.getByTestId('ind-param-period');
  await expect(length).toBeFocused();
  await expect(length).toBeInViewport();
  await length.fill('50');
  await expect.poll(() => hook(page, (h) => h.indicators()[0]?.params.period)).toBe(50);
  await expect(smaRow).toContainText('SMA 50');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await rsiRow.hover();
  await rsiRow.getByTestId('legend-remove').click();
  await expect.poll(() => hook(page, (h) => h.paneCount())).toBe(panesBefore);
  await expect.poll(() => hook(page, (h) => h.indicators().map((i) => i.id))).toEqual([sma]);
  await expect(legend.getByTestId('legend-row')).toHaveCount(1);

  expect(await chartState(page, refTime)).toEqual(before);
});

test('T7.4b with a drawing tool armed, a legend click does not place a point', async ({ page }) => {
  await addIndicators(page, ['sma']);
  const smaRow = page.getByTestId('legend-row').first();
  await expect(smaRow).toBeVisible();
  const box = (await page.getByTestId('chart').boundingBox())!;

  await page.keyboard.press('Alt+T');
  await smaRow.hover();
  await smaRow.getByTestId('legend-toggle').click();
  await expect(smaRow).toHaveAttribute('data-hidden', 'true');
  const p1 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const start = (await draws(page)).drawings[0] as { type: string; a: { time: number } };
  expect(start.type).toBe('trendline');
  const ax = await page.evaluate(
    (t) => (window as unknown as W).__catpivex.timeToX(t),
    start.a.time,
  );
  expect(Math.abs(box.x + ax! - p1.x)).toBeLessThan(20);
});

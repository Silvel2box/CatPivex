import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { addIndicators, openApp, waitLoaded } from './phase3-helpers';

interface Profile {
  id: string;
  rowCount: number;
  valueArea: number;
  bars: { from: number; to: number; firstTime: number; lastTime: number; volume: number } | null;
  rows: { low: number; high: number; up: number; down: number }[];
  poc: number | null;
  vaLow: number | null;
  vaHigh: number | null;
  pocPrice: number | null;
}

type W = {
  __catpivex: {
    volumeProfiles(): Profile[];
    indicators(): { id: string; type: string }[];
    xForTime(time: number): number | null;
    priceToY(price: number): number | null;
  };
};

const profiles = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__catpivex.volumeProfiles());

const savedLayout = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/layout`)).json()).layout as {
    indicators?: { type: string; params: Record<string, number>; visible: boolean }[];
  } | null;

async function ready(page: Page, rows: number): Promise<Profile> {
  await expect
    .poll(async () => {
      const [p] = await profiles(page);
      return p?.bars ? p.rows.length : 0;
    })
    .toBe(rows);
  return (await profiles(page))[0]!;
}

function checkProfile(p: Profile) {
  const totals = p.rows.map((r) => r.up + r.down);
  const sum = totals.reduce((a, b) => a + b, 0);
  expect(p.bars!.volume).toBeGreaterThan(0);
  expect(Math.abs(sum - p.bars!.volume) / p.bars!.volume).toBeLessThan(1e-9);
  const max = Math.max(...totals);
  expect(totals[p.poc!]).toBe(max);
  expect(totals.indexOf(max)).toBe(p.poc);
  expect(p.vaLow!).toBeLessThanOrEqual(p.poc!);
  expect(p.vaHigh!).toBeGreaterThanOrEqual(p.poc!);
  const va = totals.slice(p.vaLow!, p.vaHigh! + 1).reduce((a, b) => a + b, 0);
  expect(va).toBeGreaterThanOrEqual((sum * p.valueArea) / 100 - 1e-9 * sum);
  for (let j = 1; j < p.rows.length; j++) expect(p.rows[j].low).toBeGreaterThan(p.rows[j - 1].low);
}

/** Pixels in the POC colour along the left of the candle pane at `price` (default: current POC). */
async function pocPixels(page: Page, price: number | null = null): Promise<number> {
  return page.evaluate((pr) => {
    const h = (window as unknown as W).__catpivex;
    const p = pr ?? h.volumeProfiles()[0]?.pocPrice ?? null;
    const y = p === null ? null : h.priceToY(p);
    const chart = document.querySelector('[data-testid="chart"]')!;
    const box = chart.getBoundingClientRect();
    if (y === null) return 0;
    let hits = 0;
    for (const canvas of chart.querySelectorAll('canvas')) {
      const r = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      if (!ctx || r.width === 0) continue;
      for (let x = 4; x < 200; x += 6) {
        const cx = box.left + x;
        const cy = box.top + y;
        if (cx < r.left || cx >= r.right || cy < r.top || cy >= r.bottom) continue;
        const sx = Math.floor(((cx - r.left) * canvas.width) / r.width);
        const sy = Math.floor(((cy - r.top) * canvas.height) / r.height);
        const [red, g, b, a] = ctx.getImageData(sx, sy, 1, 1).data;
        if (a > 200 && Math.abs(red - 242) < 12 && Math.abs(g - 54) < 12 && Math.abs(b - 69) < 12)
          hits++;
      }
    }
    return hits;
  }, price);
}

test('P9 VRVP: profile of the visible bars, follows scroll/zoom, settings, hide/show, reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openApp(page);
  await page.getByTestId('tf-1D').click();
  await waitLoaded(page, '1D');

  await page.getByTestId('indicators-button').click();
  await expect(page.getByTestId('ind-add-vrvp')).toHaveText('+ Volume Profile (visible range)');
  await page.keyboard.press('Escape');
  await addIndicators(page, ['vrvp']);

  const first = await ready(page, 24);
  expect(first.rowCount).toBe(24);
  expect(first.valueArea).toBe(70);
  checkProfile(first);
  const [x0, x1] = await page.evaluate(
    ([a, b]) => {
      const h = (window as unknown as W).__catpivex;
      return [h.xForTime(a), h.xForTime(b)];
    },
    [first.bars!.firstTime, first.bars!.lastTime],
  );
  const box = (await page.getByTestId('chart').boundingBox())!;
  expect(x0!).toBeGreaterThanOrEqual(0);
  expect(x1!).toBeLessThanOrEqual(box.width);

  const id = first.id;
  const row = page.locator(`[data-testid="legend-row"][data-ind-id="${id}"]`);
  await expect(row).toContainText('VRVP 24 70 30');
  const fmt = (v: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  await expect
    .poll(async () => {
      const [p] = await profiles(page);
      const text = await row.locator('[data-testid="legend-value"][data-line="poc"]').textContent();
      return text === fmt(p!.pocPrice!);
    })
    .toBe(true);
  await expect.poll(() => pocPixels(page)).toBeGreaterThan(0);
  await page.getByTestId('chart').screenshot({ path: test.info().outputPath('vrvp.png') });

  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await profiles(page))[0]?.bars?.firstTime ?? Infinity)
    .toBeLessThan(first.bars!.firstTime);
  const scrolled = (await profiles(page))[0]!;
  checkProfile(scrolled);
  expect(scrolled.rows).not.toEqual(first.rows);

  const span = (p: Profile) => p.bars!.to - p.bars!.from;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => span((await profiles(page))[0]!))
    .toBeLessThan(span(scrolled) * 0.8);
  const zoomed = (await profiles(page))[0]!;
  checkProfile(zoomed);
  expect(zoomed.rows).not.toEqual(scrolled.rows);

  await row.hover();
  await row.getByTestId('legend-settings').click();
  const panel = page.getByTestId('indicator-panel');
  const item = panel.locator(`[data-testid="ind-instance"][data-ind-id="${id}"]`);
  await expect(item).toContainText('VRVP 24 70 30');
  for (const line of ['up', 'down', 'poc']) await expect(item.getByTestId(`ind-color-${line}`)).toHaveCount(1);
  await expect(item.locator('[data-testid^="ind-width-"]')).toHaveCount(0);
  await item.getByTestId('ind-param-rows').fill('50');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  const fifty = await ready(page, 50);
  expect(fifty.rowCount).toBe(50);
  checkProfile(fifty);
  await expect(row).toContainText('VRVP 50 70 30');

  await row.hover();
  await row.getByTestId('legend-toggle').click();
  await expect(row).toHaveAttribute('data-hidden', 'true');
  await expect.poll(async () => (await profiles(page)).length).toBe(0);
  await expect(row.getByTestId('legend-value')).toHaveCount(0);
  await expect.poll(() => pocPixels(page, fifty.pocPrice!)).toBe(0);
  await row.getByTestId('legend-toggle').click();
  await expect(row).not.toHaveAttribute('data-hidden');
  checkProfile(await ready(page, 50));
  await expect(row.locator('[data-testid="legend-value"][data-line="poc"]')).toHaveCount(1);

  await expect
    .poll(async () => {
      const ind = (await savedLayout(page))?.indicators?.[0];
      return ind ? [ind.type, ind.params.rows, ind.visible] : null;
    })
    .toEqual(['vrvp', 50, true]);
  await page.reload();
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitLoaded(page, '1D');
  const restored = await ready(page, 50);
  expect(restored.id).toBe(id);
  checkProfile(restored);
  await expect(page.locator(`[data-testid="legend-row"][data-ind-id="${id}"]`)).toContainText(
    'VRVP 50 70 30',
  );
  await expect.poll(() => pocPixels(page)).toBeGreaterThan(0);
});

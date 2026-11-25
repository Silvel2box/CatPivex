import { expect, test, type Page } from './fixtures';

// Reads the dev-only hook exposed by the frontend (window.__catpivex).
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
type ChartState = {
  symbol: string;
  interval: string;
  barCount: number;
  firstTime: number | null;
  lastBar: Bar | null;
  loading: boolean;
  wsConnected: boolean;
};

declare global {
  interface Window {
    __catpivex?: { state(): ChartState };
  }
}

const state = (page: Page) => page.evaluate(() => window.__catpivex!.state());

async function waitLoaded(page: Page, interval: string, timeout = 15_000) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s.interval === interval && !s.loading && s.barCount > 0;
      },
      { timeout, intervals: [50] },
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitLoaded(page, '1m');
});

test('T1.10a BINANCE:BTCUSDT 1m — last bar updates in realtime within 10s', async ({ page }) => {
  const s0 = await state(page);
  expect(s0.symbol).toBe('BINANCE:BTCUSDT');
  expect(s0.barCount).toBeGreaterThanOrEqual(400);
  await expect.poll(async () => (await state(page)).wsConnected, { timeout: 10_000 }).toBe(true);

  const before = JSON.stringify((await state(page)).lastBar);
  await expect
    .poll(async () => JSON.stringify((await state(page)).lastBar), { timeout: 10_000, intervals: [200] })
    .not.toBe(before);
});

test('T1.10b switch to 1h and 1D — each renders in < 2s with aligned bars', async ({ page }) => {
  for (const [tf, sec] of [
    ['1h', 3600],
    ['1D', 86400],
  ] as const) {
    const t0 = Date.now();
    await page.getByTestId(`tf-${tf}`).click();
    await waitLoaded(page, tf, 2_000);
    const elapsed = Date.now() - t0;
    const s = await state(page);
    console.log(`${tf}: ${elapsed} ms, ${s.barCount} bars`);
    expect(elapsed).toBeLessThan(2_000);
    expect(s.lastBar!.time % sec).toBe(0);
    expect(s.firstTime! % sec).toBe(0);
  }
});

test('T1.10c scrolling to the left edge loads older bars', async ({ page }) => {
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
  const s0 = await state(page);

  const box = (await page.getByTestId('chart').boundingBox())!;
  const y = box.y + box.height / 2;
  // Drag right repeatedly to pan towards older data until more bars arrive.
  await expect
    .poll(
      async () => {
        await page.mouse.move(box.x + box.width * 0.2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, y, { steps: 8 });
        await page.mouse.up();
        return (await state(page)).barCount;
      },
      { timeout: 20_000, intervals: [300] },
    )
    .toBeGreaterThan(s0.barCount);

  const s1 = await state(page);
  expect(s1.firstTime!).toBeLessThan(s0.firstTime!);
});

test('TX.4 Lightweight Charts attribution: no logo on the chart, credit link on the page', async ({
  page,
}) => {
  await expect(page.locator('[data-testid="chart"] a[href*="tradingview.com"]')).toHaveCount(0);
  const link = page.getByTestId('chart-attribution').locator('a[href="https://www.tradingview.com/"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('TradingView Lightweight Charts™');
});

test('T1.12 crosshair horizontal line sits at the cursor, not snapped to the close', async ({
  page,
}) => {
  const box = (await page.getByTestId('chart').boundingBox())!;
  // Near the top of the main pane: above every candle (10% top margin), so a magnet crosshair
  // would draw its horizontal line far below this row, at the hovered bar's close.
  const x = box.x + box.width * 0.6;
  const y = box.y + 15;
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  // Opaque pixels on the cursor's row (±1px), left of the cursor, in the top canvas layer of
  // the pane under the cursor (LWC draws the crosshair there; it is transparent otherwise).
  const opaque = await page.evaluate(
    ([cx, cy]) => {
      const hit = [...document.querySelectorAll<HTMLCanvasElement>('[data-testid="chart"] canvas')]
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom;
        })
        .at(-1)!;
      const r = hit.getBoundingClientRect();
      const sx = hit.width / r.width;
      const sy = hit.height / r.height;
      const px = hit
        .getContext('2d')!
        .getImageData(
          Math.round(5 * sx),
          Math.round((cy - r.top - 1) * sy),
          Math.round((cx - r.left - 35) * sx),
          Math.max(1, Math.round(3 * sy)),
        ).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
      return n;
    },
    [x, y],
  );
  expect(opaque).toBeGreaterThan(50);
});

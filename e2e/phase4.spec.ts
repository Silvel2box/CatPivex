import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { addIndicators, openApp, waitLoaded } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Drawing = { id: string; type: string; price?: number; time?: number; a?: Anchor; b?: Anchor };
type Shape = { type: string; x?: number; y?: number; a?: { x: number; y: number }; b?: { x: number; y: number }; levelYs?: number[] };
type DrawState = {
  hoveredId: string | null;
  priceLabels: string[];
  timeLabels: string[];
  symbol: string | null;
  loading: boolean;
  tool: string | null;
  selectedId: string | null;
  magnet: boolean;
  drawings: Drawing[];
  shapes: { id: string; shape: Shape }[];
};
type W = {
  __catpivex: {
    drawings(): DrawState;
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
    state(): { symbol: string; interval: string };
    indicators(): { type: string; params: Record<string, number> }[];
  };
};

const BTC = 'BINANCE:BTCUSDT';
const ETH = 'BINANCE:ETHUSDT';

const draws = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__catpivex.drawings());

/** Page coordinates of (time, price) on the candle pane. */
async function at(page: Page, time: number, price: number) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const [x, y] = await page.evaluate(
    ([t, p]) => {
      const h = (window as unknown as W).__catpivex;
      return [h.timeToX(t), h.priceToY(p)];
    },
    [time, price],
  );
  expect(x).not.toBeNull();
  expect(y).not.toBeNull();
  return { x: box.x + x!, y: box.y + y! };
}

async function candles(page: Page, symbol: string, interval: string) {
  const res = await page.request.get(
    `${E2E_API}/api/candles?symbol=${symbol}&interval=${interval}&limit=500`,
  );
  return (await res.json()).candles as { time: number; open: number; high: number; low: number; close: number }[];
}

const savedDrawings = async (page: Page, symbol: string) =>
  ((await (await page.request.get(`${E2E_API}/api/drawings/${symbol}`)).json()).drawings ?? []) as Drawing[];

const savedLayout = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/layout`)).json()).layout as Record<string, unknown> | null;

async function waitDrawingsLoaded(page: Page, symbol: string) {
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === symbol && !s.loading;
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  for (const s of [BTC, ETH]) await page.request.delete(`${E2E_API}/api/drawings/${s}`);
  await openApp(page);
  await waitDrawingsLoaded(page, BTC);
});

test('T4.6 draw on 1h → switch to 1D → reload: anchors, drawings, indicators, timeframe, symbol all kept', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
  await addIndicators(page, ['sma']);
  expect((await draws(page)).magnet).toBe(false); // default off: anchors exactly where we click

  const bars = await candles(page, BTC, '1h');
  const i = bars.length - 40;
  const j = bars.length - 12;
  // Start at hh:30, which has no bar on 1h nor on 1D.
  const tA = bars[i]!.time + 1800;
  const pA = bars[i]!.low;
  const pB = bars[j]!.high;
  const a = await at(page, tA, pA);
  const b = await at(page, bars[j]!.time, pB);

  await page.keyboard.press('Alt+T');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Alt+H');
  const h = await at(page, bars[j]!.time, (pA + pB) / 2);
  await page.mouse.click(h.x, h.y);

  await expect.poll(async () => (await draws(page)).drawings.length).toBe(2);
  const drawn = (await draws(page)).drawings;
  await page.getByTestId('magnet-toggle').click(); // the magnet setting is part of the layout
  await expect.poll(async () => (await draws(page)).magnet).toBe(true);
  const trend = drawn.find((d) => d.type === 'trendline')!;
  // The click landed on the intended anchor (pixel rounding: well under one 1h bar).
  expect(Math.abs(trend.a!.time - tA)).toBeLessThan(3600);
  expect(Math.abs(trend.a!.price - pA) / pA).toBeLessThan(0.002);

  // Switch to 1D: anchors are data, they must not change; the shape sits at the interpolated x.
  await page.getByTestId('tf-1D').click();
  await waitLoaded(page, '1D');
  const onDaily = await draws(page);
  expect(onDaily.drawings).toEqual(drawn);
  const shape = onDaily.shapes.find((s) => s.id === trend.id)!.shape;
  const dayStart = Math.floor(trend.a!.time / 86400) * 86400;
  const [xDay, xNext, xA] = await page.evaluate(
    ([d, t]) => {
      const hk = (window as unknown as W).__catpivex;
      return [hk.timeToX(d), hk.timeToX(d + 86400), hk.timeToX(t)];
    },
    [dayStart, trend.a!.time],
  );
  expect(shape.a!.x).toBeCloseTo(xA!, 3);
  expect(xA!).toBeGreaterThan(xDay!);
  expect(xA!).toBeLessThan(xNext!);
  const frac = (trend.a!.time - dayStart) / 86400;
  expect((xA! - xDay!) / (xNext! - xDay!)).toBeCloseTo(frac, 2);

  // Saved (debounced) → reload restores everything.
  await expect.poll(() => savedDrawings(page, BTC)).toEqual(drawn);
  await expect.poll(async () => (await savedLayout(page))?.interval).toBe('1D');
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitLoaded(page, '1D');
  await waitDrawingsLoaded(page, BTC);
  expect((await draws(page)).drawings).toEqual(drawn);
  expect((await draws(page)).magnet).toBe(true);
  const st = await page.evaluate(() => (window as unknown as W).__catpivex.state());
  expect(st).toMatchObject({ symbol: BTC, interval: '1D' });
  const inds = await page.evaluate(() => (window as unknown as W).__catpivex.indicators());
  expect(inds.map((x) => [x.type, x.params])).toEqual([['sma', { period: 20 }]]);
});

test('T4.6b drawings are per symbol; the last symbol comes back after reload', async ({ page }) => {
  const bars = await candles(page, BTC, '1m');
  const p = await at(page, bars[bars.length - 20]!.time, bars[bars.length - 20]!.close);
  await page.keyboard.press('Alt+H');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await savedDrawings(page, BTC)).length).toBe(1);

  await page.getByTestId('symbol-button').click();
  await page.getByTestId('symbol-search-input').fill('ETHUSDT');
  await page.locator(`[data-testid="symbol-result"][data-symbol="${ETH}"]`).click();
  await waitDrawingsLoaded(page, ETH);
  expect((await draws(page)).drawings).toEqual([]);

  await expect.poll(async () => (await savedLayout(page))?.symbol).toBe(ETH);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitDrawingsLoaded(page, ETH);
  expect(await page.evaluate(() => (window as unknown as W).__catpivex.state().symbol)).toBe(ETH);

  await page.getByTestId('symbol-button').click();
  await page.getByTestId('symbol-search-input').fill('BTCUSDT');
  await page.locator(`[data-testid="symbol-result"][data-symbol="${BTC}"]`).click();
  await waitDrawingsLoaded(page, BTC);
  expect((await draws(page)).drawings.map((d) => d.type)).toEqual(['hline']);
});

test('T4.7 shortcuts: Alt+H/V/T/R/F pick tools, Esc cancels, Delete removes the selected drawing, typing opens search', async ({
  page,
}) => {
  const tool = async () => (await draws(page)).tool;
  for (const [key, t] of [
    ['Alt+H', 'hline'],
    ['Alt+V', 'vline'],
    ['Alt+T', 'trendline'],
    ['Alt+R', 'rect'],
    ['Alt+F', 'fib'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(tool).toBe(t);
    await page.keyboard.press('Escape');
    await expect.poll(tool).toBe(null);
  }
  await expect(page.getByTestId('symbol-search-input')).toHaveCount(0); // Alt+letters don't open it

  // Esc during a 2-point drawing drops it.
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.keyboard.press('Alt+T');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.keyboard.press('Escape');
  expect((await draws(page)).drawings).toEqual([]);

  // Draw, it is selected, Delete removes it.
  await page.keyboard.press('Alt+V');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  expect((await draws(page)).selectedId).toBe((await draws(page)).drawings[0]!.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);

  await page.keyboard.press('e');
  await expect(page.getByTestId('symbol-search-input')).toBeVisible();
});

test('T4.9 fib (drag to draw) and dragging a drawing moves it without panning the chart', async ({
  page,
}) => {
  const bars = await candles(page, BTC, '1m');
  const lo = bars[bars.length - 60]!;
  const hi = bars[bars.length - 20]!;
  expect((await draws(page)).magnet).toBe(false);

  // Fib by press-drag-release from the toolbar.
  const a = await at(page, lo.time, lo.low);
  const b = await at(page, hi.time, hi.high);
  await page.getByTestId('draw-tool-fib').click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const s1 = await draws(page);
  const fib = s1.drawings[0]!;
  const fibShape = s1.shapes[0]!.shape;
  expect(fib.type).toBe('fib');
  expect(fibShape.levelYs).toHaveLength(7);
  // Level 1 is anchor a, level 0 is anchor b (TradingView convention).
  expect(fibShape.levelYs![6]).toBeCloseTo(fibShape.a!.y, 1);
  expect(fibShape.levelYs![0]).toBeCloseTo(fibShape.b!.y, 1);

  // Grab the middle of the a–b diagonal and drag: the fib moves, the chart does not scroll.
  const ref = bars[bars.length - 100]!.time;
  const xRefBefore = await page.evaluate((t) => (window as unknown as W).__catpivex.timeToX(t), ref);
  const box = (await page.getByTestId('chart').boundingBox())!;
  const mid = { x: box.x + (fibShape.a!.x + fibShape.b!.x) / 2, y: box.y + (fibShape.a!.y + fibShape.b!.y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x - 80, mid.y + 40, { steps: 8 });
  await page.mouse.up();
  const s2 = await draws(page);
  const moved = s2.drawings[0]!;
  expect(moved.id).toBe(fib.id);
  expect(moved.a!.time).toBeLessThan(fib.a!.time);
  expect(moved.a!.price).toBeLessThan(fib.a!.price);
  expect(moved.b!.time - moved.a!.time).toBe(fib.b!.time - fib.a!.time);
  const xRefAfter = await page.evaluate((t) => (window as unknown as W).__catpivex.timeToX(t), ref);
  expect(xRefAfter).toBeCloseTo(xRefBefore!, 3);

  // Dragging empty space still pans the chart.
  await page.keyboard.press('Escape');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 - 150, box.y + box.height * 0.85, { steps: 8 });
  await page.mouse.up();
  const xRefPanned = await page.evaluate((t) => (window as unknown as W).__catpivex.timeToX(t), ref);
  expect(Math.abs(xRefPanned! - xRefBefore!)).toBeGreaterThan(50);
});

test('T4.11 weak magnet: snaps only within 10 px of an O/H/L/C, otherwise follows the mouse', async ({
  page,
}) => {
  const bars = await candles(page, BTC, '1m');
  // The bar with the longest upper wick among recent ones, so its high is clearly apart from
  // its open/close on screen (otherwise "nearest O/H/L/C" may rightly be the close).
  const bar = bars
    .slice(-60, -10)
    .reduce((best, c) =>
      c.high - Math.max(c.open, c.close) > best.high - Math.max(best.open, best.close) ? c : best,
    );
  const wickPx = await page.evaluate(
    ([h, top]) => {
      const hk = (window as unknown as W).__catpivex;
      return hk.priceToY(top)! - hk.priceToY(h)!;
    },
    [bar.high, Math.max(bar.open, bar.close)],
  );
  expect(wickPx).toBeGreaterThan(15);
  await page.getByTestId('magnet-toggle').click();
  await expect.poll(async () => (await draws(page)).magnet).toBe(true);

  // 5 px below the bar's high (and the high is the nearest of its O/H/L/C): snaps to the high.
  const near = await at(page, bar.time, bar.high);
  await page.keyboard.press('Alt+H');
  await page.mouse.click(near.x, near.y + 5);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  expect((await draws(page)).drawings[0]!.price).toBe(bar.high);

  // 40 px above the high (beyond the radius): the price is wherever the mouse is, not an OHLC.
  await page.keyboard.press('Alt+H');
  await page.mouse.click(near.x, near.y - 40);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(2);
  const free = (await draws(page)).drawings[1]!.price!;
  expect([bar.open, bar.high, bar.low, bar.close]).not.toContain(free);
  expect(free).toBeGreaterThan(bar.high);
});

test('T4.12 hover shows handles; anchor labels on both axes; clicking inside a fib band selects it', async ({
  page,
}) => {
  const bars = await candles(page, BTC, '1m');
  const lo = bars[bars.length - 70]!;
  const hi = bars[bars.length - 30]!;
  const a = await at(page, lo.time, lo.low);
  const b = await at(page, hi.time, hi.high);
  await page.keyboard.press('Alt+F');
  await page.mouse.click(a.x, a.y);
  // While drawing: labels for both anchors on the price and the time axis.
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await expect.poll(async () => (await draws(page)).priceLabels.length).toBe(2);
  expect((await draws(page)).timeLabels).toHaveLength(2);
  await page.mouse.click(b.x, b.y);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const fib = (await draws(page)).drawings[0]!;
  // Selected after drawing: the labels show its anchors' prices.
  const s1 = await draws(page);
  expect(s1.selectedId).toBe(fib.id);
  expect(s1.priceLabels.map((t) => Number(t.replace(/,/g, '')))).toEqual([fib.a!.price, fib.b!.price].map((p) => Number(p.toFixed(2))));

  // Deselect, then hover inside a band, away from every line: highlighted; click: selected.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await draws(page)).selectedId).toBe(null);
  await expect.poll(async () => (await draws(page)).priceLabels).toEqual([]); // next frame
  const shape = (await draws(page)).shapes[0]!.shape;
  const box = (await page.getByTestId('chart').boundingBox())!;
  const ys = shape.levelYs!;
  // Middle of the band between levels 0.5 and 0.618, a quarter of the way across.
  const inside = {
    x: box.x + shape.a!.x + (shape.b!.x - shape.a!.x) * 0.75,
    y: box.y + (ys[3]! + ys[4]!) / 2,
  };
  await page.mouse.move(inside.x, inside.y);
  await expect.poll(async () => (await draws(page)).hoveredId).toBe(fib.id);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(fib.id);

  // Mouse away: no hover.
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.95);
  await expect.poll(async () => (await draws(page)).hoveredId).toBe(null);
});

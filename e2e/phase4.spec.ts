import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { addIndicators, openApp, waitLoaded } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Drawing = {
  id: string;
  type: string;
  price?: number;
  time?: number;
  a?: Anchor;
  b?: Anchor;
  fill?: number;
  extend?: boolean;
};
type Shape = {
  type: string;
  x?: number;
  y?: number;
  a?: { x: number; y: number };
  b?: { x: number; y: number };
  levelYs?: number[];
  extendTo?: number;
};
type DrawState = {
  hoveredId: string | null;
  ghost: Anchor | null;
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

test('T4.13 fib aiming: dot before the click, wick snap (magnet off), big handles, background opacity', async ({
  page,
}) => {
  const bars = await candles(page, BTC, '1m');
  type Bar = (typeof bars)[number];
  const pick = (from: Bar[], score: (c: Bar) => number) =>
    from.reduce((best, c) => (score(c) > score(best) ? c : best));
  // Long wicks, so the tip is clearly apart from open/close on screen.
  const top = pick(bars.slice(-70, -45), (c) => c.high - Math.max(c.open, c.close));
  const bottom = pick(bars.slice(-35, -10), (c) => Math.min(c.open, c.close) - c.low);
  expect((await draws(page)).magnet).toBe(false);

  // No tool: no aiming dot.
  const hi = await at(page, top.time, top.high);
  await page.mouse.move(hi.x, hi.y + 10);
  expect((await draws(page)).ghost).toBeNull();

  // Fib tool: 10 px below the wick tip, the dot already sits on the high.
  await page.keyboard.press('Alt+F');
  await page.mouse.move(hi.x + 2, hi.y + 10);
  await expect.poll(async () => (await draws(page)).ghost).toEqual({ time: top.time, price: top.high });
  expect((await draws(page)).priceLabels).toHaveLength(1); // the dot's price on the axis
  await page.mouse.click(hi.x + 2, hi.y + 10);
  const lo = await at(page, bottom.time, bottom.low);
  await page.mouse.click(lo.x - 2, lo.y - 9);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const fib = (await draws(page)).drawings[0]!;
  expect(fib.a).toEqual({ time: top.time, price: top.high });
  expect(fib.b).toEqual({ time: bottom.time, price: bottom.low });

  // Wick snap is for fib only: an hline at the same offset stays where the mouse is.
  await page.keyboard.press('Alt+H');
  await page.mouse.click(hi.x + 2, hi.y + 10);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(2);
  expect((await draws(page)).drawings[1]!.price).toBeLessThan(top.high);
  await page.keyboard.press('Delete'); // the new hline is selected

  // Grab end point a from 8.5 px away (outside the old 6 px) and drag it: only a moves.
  await page.keyboard.press('Escape');
  const box = (await page.getByTestId('chart').boundingBox())!;
  const shapeA = (await draws(page)).shapes[0]!.shape.a!;
  await page.mouse.move(box.x + shapeA.x + 6, box.y + shapeA.y - 6);
  await page.mouse.down();
  await page.mouse.move(box.x + shapeA.x - 60, box.y + shapeA.y - 30, { steps: 6 });
  await page.mouse.up();
  const moved = (await draws(page)).drawings[0]!;
  expect(moved.a!.time).toBeLessThan(fib.a!.time);
  expect(moved.b).toEqual(fib.b);

  // Background opacity: selected fib -> 50%, saved, and back after reload.
  await expect.poll(async () => (await draws(page)).selectedId).toBe(fib.id);
  await page.getByTestId('drawing-fill').selectOption('0.5');
  await expect.poll(async () => (await draws(page)).drawings[0]!.fill).toBe(0.5);
  await expect.poll(async () => (await savedDrawings(page, BTC))[0]?.fill).toBe(0.5);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitDrawingsLoaded(page, BTC);
  expect((await draws(page)).drawings[0]!.fill).toBe(0.5);
});

test('T4.14 Ctrl+Z / Ctrl+Y (a drag is one step), Shift locks a trend line, right-click menu, fib reverse/extend', async ({
  page,
}) => {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const P = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const n = async () => (await draws(page)).drawings.length;

  // Shift: a trend line drawn at a slight slope comes out exactly horizontal on screen.
  const s0 = P(0.3, 0.35);
  await page.keyboard.press('Alt+T');
  await page.mouse.click(s0.x, s0.y);
  await page.keyboard.down('Shift');
  await page.mouse.move(s0.x + 160, s0.y + 9, { steps: 4 });
  await page.mouse.click(s0.x + 160, s0.y + 9);
  await page.keyboard.up('Shift');
  await expect.poll(n).toBe(1);
  const tl = (await draws(page)).drawings[0]!;
  expect(tl.b!.price).toBeCloseTo(tl.a!.price, 6);

  // Drag the line in 6 moves; Ctrl+Z undoes the whole drag, Ctrl+Y redoes it.
  const mid = { x: s0.x + 80, y: s0.y };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y + 50, { steps: 6 });
  await page.mouse.up();
  const dragged = (await draws(page)).drawings[0]!;
  expect(dragged.a!.price).not.toBe(tl.a!.price);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await draws(page)).drawings[0]).toEqual(tl);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await draws(page)).drawings[0]).toEqual(dragged);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // and the line itself
  await expect.poll(n).toBe(0);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(n).toBe(1);

  // Fib, then right-click it: reverse and extend from the menu.
  const fa = P(0.55, 0.25);
  const fb = P(0.7, 0.55);
  await page.keyboard.press('Alt+F');
  await page.mouse.click(fa.x, fa.y);
  await page.mouse.click(fb.x, fb.y);
  await expect.poll(n).toBe(2);
  const fib = (await draws(page)).drawings[1]!;
  await page.keyboard.press('Escape');
  const inside = P(0.65, 0.4);
  await page.mouse.click(inside.x, inside.y, { button: 'right' });
  await expect(page.getByTestId('drawing-menu')).toBeVisible();
  await page.getByTestId('menu-reverse').click();
  await expect(page.getByTestId('drawing-menu')).toHaveCount(0);
  await expect.poll(async () => (await draws(page)).drawings[1]!.a).toEqual(fib.b);
  await page.mouse.click(inside.x, inside.y, { button: 'right' });
  await page.getByTestId('menu-extend').click();
  await expect.poll(async () => (await draws(page)).drawings[1]!.extend).toBe(true);
  const ext = (await draws(page)).shapes[1]!.shape;
  expect(ext.extendTo).toBeGreaterThan(Math.max(ext.a!.x, ext.b!.x));
  // Clicking far right of the anchors, on the extended area, now grabs the fib.
  await page.keyboard.press('Escape');
  const right = { x: box.x + ext.extendTo! - 20, y: box.y + (ext.levelYs![3]! + ext.levelYs![4]!) / 2 };
  await page.mouse.click(right.x, right.y);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(fib.id);
  // Toolbar buttons do the same: extend off, reverse back.
  await page.getByTestId('drawing-extend').click();
  await page.getByTestId('drawing-reverse').click();
  await expect.poll(async () => (await draws(page)).drawings[1]).toEqual(fib);

  // Right-click menu: Delete. Right-click on empty chart: no drawing menu.
  await page.mouse.click(inside.x, inside.y, { button: 'right' });
  await page.getByTestId('menu-delete').click();
  await expect.poll(n).toBe(1);
  const empty = P(0.15, 0.85);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(page.getByTestId('drawing-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Everything above was saved (debounced) exactly as it ended.
  await expect.poll(async () => (await savedDrawings(page, BTC)).length).toBe(1);
});

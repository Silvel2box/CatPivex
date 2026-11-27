import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp, waitLoaded } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Position = {
  id: string;
  type: string;
  color: string;
  a: Anchor;
  end: number;
  stop: number;
  target: number;
};
type Shape = {
  type: string;
  a: { x: number; y: number };
  x1: number;
  stopY: number;
  targetY: number;
};
type DrawState = {
  symbol: string | null;
  loading: boolean;
  tool: string | null;
  selectedId: string | null;
  drawings: Position[];
  shapes: { id: string; shape: Shape }[];
  priceLabels: string[];
  timeLabels: string[];
};
type Labels = { target: string; stop: string; rr: string };
type W = {
  __catpivex: {
    drawings(): DrawState;
    positions(): { id: string; labels: Labels }[];
    priceToY(p: number): number | null;
  };
};

const BTC = 'BINANCE:BTCUSDT';
const SHOT =
  'C:/Users/work/AppData/Local/Temp/claude/6d9386240e246e2f/7aca7e94-1e40-4733-a71c-2fbabc7cebf7/scratchpad/p8a-position.png';

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const labels = async (page: Page, id: string) =>
  (await page.evaluate(() => (window as unknown as W).__catpivex.positions())).find(
    (p) => p.id === id,
  )?.labels;
const yOf = async (page: Page, price: number) =>
  (await page.evaluate((p) => (window as unknown as W).__catpivex.priceToY(p), price))!;
const saved = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/drawings/${BTC}`)).json()).drawings as Position[];

async function drawingsLoaded(page: Page) {
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
}

async function shapeOf(page: Page, id: string) {
  return (await draws(page)).shapes.find((s) => s.id === id)!.shape;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function place(page: Page, tool: 'long' | 'short', fx: number, fy: number) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const before = (await draws(page)).drawings.length;
  await page.getByTestId(`draw-tool-${tool}`).click();
  await expect.poll(async () => (await draws(page)).tool).toBe(tool);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(before + 1);
  const s = await draws(page);
  return { box, d: s.drawings.at(-1)!, s };
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await drawingsLoaded(page);
});

test('T8.A1 long position: one click, 2R defaults, target drag changes R:R, stop clamps at entry, undo, persists', async ({
  page,
}) => {
  await expect(page.getByTestId('draw-tool-long')).toHaveAttribute('title', 'Long position');
  const { box, d, s } = await place(page, 'long', 0.4, 0.45);
  expect(d.type).toBe('long');
  expect(s.tool).toBeNull();
  expect(s.selectedId).toBe(d.id);
  expect(Math.abs((await yOf(page, d.a.price)) - box.height * 0.45)).toBeLessThanOrEqual(1);

  const risk = d.a.price - d.stop;
  const reward = d.target - d.a.price;
  expect(risk).toBeGreaterThan(0);
  expect(reward / risk).toBeCloseTo(2, 9);
  expect(Math.abs((await yOf(page, d.stop)) - (await yOf(page, d.a.price)) - 40)).toBeLessThan(1);
  expect(d.end - d.a.time).toBe(20 * 60);

  const l0 = (await labels(page, d.id))!;
  expect(l0.rr).toBe('R:R 2.00');
  expect(l0.target).toMatch(/^Target: \S+ \(\+\d+\.\d\d%\)$/);
  expect(l0.stop).toMatch(/^Stop: \S+ \(-\d+\.\d\d%\)$/);
  expect(s.priceLabels).toHaveLength(3);
  expect(s.timeLabels).toHaveLength(2);

  const sh = await shapeOf(page, d.id);
  expect(sh.type).toBe('long');
  expect(sh.targetY).toBeLessThan(sh.a.y);
  expect(sh.stopY).toBeGreaterThan(sh.a.y);
  expect(sh.x1).toBeGreaterThan(sh.a.x);
  await page.screenshot({ path: SHOT });

  await drag(page, { x: box.x + sh.a.x, y: box.y + sh.targetY }, 0, -40);
  const t = (await draws(page)).drawings[0]!;
  expect(t.stop).toBe(d.stop);
  expect(t.a).toEqual(d.a);
  const rr = (t.target - t.a.price) / (t.a.price - t.stop);
  expect(rr).toBeGreaterThan(2.8);
  expect(rr).toBeLessThan(3.2);
  await expect.poll(async () => (await labels(page, d.id))?.rr).toBe(`R:R ${rr.toFixed(2)}`);

  const sh2 = await shapeOf(page, d.id);
  await drag(page, { x: box.x + sh2.a.x, y: box.y + sh2.stopY }, 0, -100);
  const c = (await draws(page)).drawings[0]!;
  expect(c.target).toBe(t.target);
  expect(c.a).toEqual(t.a);
  expect(c.stop).toBeLessThan(c.a.price);
  expect(c.stop).toBeGreaterThan(c.a.price * (1 - 2e-4));
  expect((await labels(page, d.id))!.stop).toMatch(/\(-0\.01%\)$/);

  const sh3 = await shapeOf(page, d.id);
  await drag(page, { x: box.x + sh3.x1, y: box.y + sh3.a.y }, -400, 0);
  const e = (await draws(page)).drawings[0]!;
  expect(e.end).toBe(e.a.time + 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await draws(page)).drawings[0]!.end).toBe(t.end);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await draws(page)).drawings[0]!.stop).toBe(t.stop);
  await expect.poll(async () => (await labels(page, d.id))?.rr).toBe(`R:R ${rr.toFixed(2)}`);
  const kept = (await draws(page)).drawings[0]!;
  expect(kept).toEqual(t);

  await expect.poll(async () => (await saved(page))[0]).toEqual(kept);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitLoaded(page, '1m');
  await drawingsLoaded(page);
  expect((await draws(page)).drawings).toEqual([kept]);
  expect((await labels(page, d.id))?.rr).toBe(`R:R ${rr.toFixed(2)}`);
  expect((await draws(page)).priceLabels).toHaveLength(0);

  const sh4 = await shapeOf(page, d.id);
  await page.mouse.click(box.x + (sh4.a.x + sh4.x1) / 2, box.y + (sh4.a.y + sh4.targetY) / 2);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(d.id);
  await expect(page.getByTestId('drawing-style')).toBeVisible();
  await expect(page.getByTestId('bar-add-alert')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);
});

test('T8.A2 short position: stop above, target below, % from the short side, body drag moves all', async ({
  page,
}) => {
  const { box, d, s } = await place(page, 'short', 0.5, 0.5);
  expect(d.type).toBe('short');
  expect(s.selectedId).toBe(d.id);
  expect(d.target).toBeLessThan(d.a.price);
  expect(d.stop).toBeGreaterThan(d.a.price);
  expect((d.a.price - d.target) / (d.stop - d.a.price)).toBeCloseTo(2, 9);
  expect(Math.abs((await yOf(page, d.a.price)) - (await yOf(page, d.stop)) - 40)).toBeLessThan(1);
  expect(d.end - d.a.time).toBe(20 * 60);

  const l = (await labels(page, d.id))!;
  expect(l.rr).toBe('R:R 2.00');
  expect(l.target).toMatch(/^Target: \S+ \(\+\d+\.\d\d%\)$/);
  expect(l.stop).toMatch(/^Stop: \S+ \(-\d+\.\d\d%\)$/);

  const sh = await shapeOf(page, d.id);
  expect(sh.stopY).toBeLessThan(sh.a.y);
  expect(sh.targetY).toBeGreaterThan(sh.a.y);
  await drag(page, { x: box.x + (sh.a.x + sh.x1) / 2, y: box.y + sh.a.y + 25 }, 60, 30);
  const m = (await draws(page)).drawings[0]!;
  expect(m.a.time).toBeGreaterThan(d.a.time);
  expect(m.end - m.a.time).toBe(d.end - d.a.time);
  const dp = m.a.price - d.a.price;
  expect(dp).toBeLessThan(0);
  expect(m.stop - d.stop).toBeCloseTo(dp, 6);
  expect(m.target - d.target).toBeCloseTo(dp, 6);
  await expect.poll(async () => (await labels(page, d.id))?.rr).toBe('R:R 2.00');

  const sh2 = await shapeOf(page, d.id);
  await drag(page, { x: box.x + sh2.a.x, y: box.y + sh2.targetY }, 0, -200);
  const c = (await draws(page)).drawings[0]!;
  expect(c.target).toBeLessThan(c.a.price);
  expect(c.target).toBeGreaterThan(c.a.price * (1 - 2e-4));
  expect(c.stop).toBe(m.stop);

  await page.mouse.click(box.x + 5, box.y + 5);
  await expect.poll(async () => (await draws(page)).selectedId).toBeNull();
  await expect.poll(async () => (await draws(page)).timeLabels).toHaveLength(0);
});

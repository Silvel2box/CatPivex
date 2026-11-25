import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Alert = { id: number; price: number; drawing_id: string | null };
type DrawState = {
  symbol: string | null;
  loading: boolean;
  tool: string | null;
  hoveredId: string | null;
  drawings: { id: string; type: string; color: string; a?: Anchor }[];
  shapes: { id: string; shape: { type: string; a?: { x: number; y: number } } }[];
  priceLabels: string[];
  timeLabels: string[];
  alertLines: string[];
};
type W = {
  __catpivex: {
    drawings(): DrawState;
    priceToY(p: number): number | null;
    alerts(): { lastEventId: number | null };
  };
};

const BTC = 'BINANCE:BTCUSDT';

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const alerts = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/alerts`)).json()) as Alert[];
const yOf = (page: Page, price: number) =>
  page.evaluate((p) => (window as unknown as W).__catpivex.priceToY(p), price);

async function placeRay(page: Page) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const x = box.x + box.width * 0.4;
  const y = box.y + box.height * 0.4;
  await page.keyboard.press('Alt+J');
  await expect.poll(async () => (await draws(page)).tool).toBe('hray');
  await page.mouse.click(x, y);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  return { box, x, y, ray: (await draws(page)).drawings[0]! };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  for (const a of await alerts(page)) await page.request.delete(`${E2E_API}/api/alerts/${a.id}`);
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__catpivex.alerts().lastEventId))
    .not.toBeNull();
});

test('T6.1a Alt+J + click places a horizontal ray at the click; it starts there and drags', async ({
  page,
}) => {
  const { box, x, y, ray } = await placeRay(page);
  expect(ray.type).toBe('hray');
  expect(ray.color).toBe('#2962ff');
  expect(Math.abs((await yOf(page, ray.a!.price))! - (y - box.y))).toBeLessThanOrEqual(1);
  const s = await draws(page);
  expect(s.tool).toBeNull();
  const shape = s.shapes.find((p) => p.id === ray.id)!.shape;
  expect(shape.type).toBe('hray');
  expect(Math.abs(shape.a!.x - (x - box.x))).toBeLessThanOrEqual(1);
  const labels = async () => {
    const d = await draws(page);
    return [d.priceLabels.length, d.timeLabels.length];
  };
  await expect.poll(labels).toEqual([1, 1]);

  await page.mouse.click(box.x + 5, box.y + 5);
  await expect.poll(labels).toEqual([1, 0]);
  await page.mouse.move(x - 40, y);
  await expect.poll(async () => (await draws(page)).hoveredId).toBeNull();
  await page.mouse.move(x + 200, y);
  await expect.poll(async () => (await draws(page)).hoveredId).toBe(ray.id);

  await drag(page, { x: x + 200, y }, 60, 40);
  const moved = (await draws(page)).drawings[0]!;
  expect(moved.a!.price).toBeLessThan(ray.a!.price);
  expect(moved.a!.time).toBeGreaterThan(ray.a!.time);
  const movedShape = (await draws(page)).shapes[0]!.shape;
  expect(Math.abs(movedShape.a!.x - (x - box.x + 60))).toBeLessThanOrEqual(2);
  expect(Math.abs(movedShape.a!.y - (y - box.y + 40))).toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      const r = await page.request.get(`${E2E_API}/api/drawings/${BTC}`);
      return ((await r.json()).drawings as { a?: Anchor }[])[0]?.a;
    })
    .toEqual(moved.a);
});

test('T6.1b a ray carries a linked alert: bell, follows the ray, goes away with it', async ({
  page,
}) => {
  const { x, y, ray } = await placeRay(page);

  await page.mouse.click(x + 200, y, { button: 'right' });
  await page.getByTestId('menu-add-alert').click();
  await expect.poll(async () => (await alerts(page)).length).toBe(1);
  const created = (await alerts(page))[0]!;
  expect(created.drawing_id).toBe(ray.id);
  expect(created.price).toBe(ray.a!.price);
  await expect.poll(async () => (await draws(page)).alertLines).toEqual([ray.id]);

  await drag(page, { x: x + 200, y }, 0, 50);
  const moved = (await draws(page)).drawings[0]!.a!.price;
  expect(moved).not.toBe(ray.a!.price);
  await expect.poll(async () => (await alerts(page))[0]?.price, { timeout: 5000 }).toBe(moved);

  await page.mouse.click(x + 200, y + 50);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);
  await expect.poll(async () => (await alerts(page)).length, { timeout: 5000 }).toBe(0);
});

import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Pt = { x: number; y: number };
type Alert = {
  id: number;
  price: number;
  enabled: boolean;
  drawing_id: string | null;
  created_at: number;
};
type DrawState = {
  symbol: string | null;
  loading: boolean;
  selectedId: string | null;
  drawings: { id: string; type: string; color: string; a: Anchor; b: Anchor }[];
  shapes: { id: string; shape: { type: string; a: Pt; b: Pt } }[];
  alertLines: string[];
  trendAlerts: { id: string; from: Pt; to: Pt; bell: Pt | null }[];
};
type W = {
  __notes: { title: string; body: string }[];
  __catpivex: {
    state(): { lastBar: { time: number; close: number } | null };
    drawings(): DrawState;
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
    alerts(): { lastEventId: number | null };
  };
};

const SYMBOL = 'TEST:TREND';

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const alerts = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/alerts`)).json()) as Alert[];
const setPrice = (page: Page, price: number) =>
  page.request.put(`${E2E_API}/api/test/price`, { data: { symbol: SYMBOL, price } });
const levelAt = (a: Anchor, b: Anchor, t: number) =>
  a.price + ((b.price - a.price) * (t - a.time)) / (b.time - a.time);

test.beforeEach(async ({ page }) => {
  for (const a of await alerts(page)) await page.request.delete(`${E2E_API}/api/alerts/${a.id}`);
  await page.request.delete(`${E2E_API}/api/drawings/${SYMBOL}`);
  expect((await setPrice(page, 100)).status()).toBe(204);
  const layout = await page.request.put(`${E2E_API}/api/layout`, {
    data: { layout: { version: 1, symbol: SYMBOL, interval: '1m' } },
  });
  expect(layout.ok()).toBe(true);
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__notes = [];
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = () => Promise.resolve('granted');
      constructor(title: string, opts?: { body?: string }) {
        w.__notes.push({ title, body: opts?.body ?? '' });
      }
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
  await openApp(page);
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === SYMBOL && !s.loading;
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__catpivex.alerts().lastEventId))
    .not.toBeNull();
});

test('T9.1 trend line alert: dashed extension + bell, fires when the price crosses the line, goes with the line', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const box = (await page.getByTestId('chart').boundingBox())!;
  const pane = await page.evaluate(() => {
    const h = (window as unknown as W).__catpivex;
    const last = h.state().lastBar!;
    return { x: h.timeToX(last.time)!, y: h.priceToY(last.close)! };
  });
  const a = { x: box.x + pane.x - 200, y: box.y + pane.y + 20 };
  const b = { x: box.x + pane.x - 100, y: box.y + pane.y + 60 };
  await page.keyboard.press('Alt+T');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const line = (await draws(page)).drawings[0]!;
  expect(line.type).toBe('trendline');
  expect(line.b.time).toBeGreaterThan(line.a.time);
  expect(line.b.price).toBeLessThan(line.a.price);
  expect(line.a.price).toBeLessThan(100);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(line.id);

  await page.getByTestId('bar-add-alert').click();
  await expect.poll(async () => (await alerts(page)).length).toBe(1);
  const created = (await alerts(page))[0]!;
  expect(created.drawing_id).toBe(line.id);
  expect(created.enabled).toBe(true);
  expect(created.price).toBeCloseTo(levelAt(line.a, line.b, created.created_at), 6);
  await expect(page.getByTestId('bar-edit-alert')).toBeVisible();

  await expect.poll(async () => (await draws(page)).alertLines).toEqual([line.id]);
  const s = await draws(page);
  const [mark] = s.trendAlerts;
  expect(mark?.id).toBe(line.id);
  const shape = s.shapes.find((p) => p.id === line.id)!.shape;
  expect(mark!.from).toEqual(shape.b);
  expect(mark!.to.x).toBeGreaterThan(shape.b.x + 50);
  expect(Math.abs(mark!.to.x - box.width)).toBeLessThan(120);
  const slope = (shape.b.y - shape.a.y) / (shape.b.x - shape.a.x);
  expect(mark!.to.y).toBeGreaterThan(shape.b.y);
  expect(Math.abs(mark!.to.y - (shape.b.y + slope * (mark!.to.x - shape.b.x)))).toBeLessThan(2);
  expect(mark!.bell).not.toBeNull();
  expect(mark!.bell!.y).toBe(mark!.to.y);

  await page.getByTestId('alerts-button').click();
  const row = page.locator(`[data-testid="alert-row"][data-alert-id="${created.id}"]`);
  await expect(row.getByTestId('alert-linked-badge')).toHaveText('linked to trend line');
  await expect(row.getByTestId('alert-row-condition')).toContainText('trend line');
  await page.keyboard.press('Escape');

  await page.waitForTimeout(3000);
  expect((await page.evaluate(() => (window as unknown as W).__notes)).length).toBe(0);
  const below = Math.round(levelAt(line.a, line.b, Date.now() / 1000) * 0.9 * 100) / 100;
  expect((await setPrice(page, below)).status()).toBe(204);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__notes), { timeout: 30_000 })
    .toHaveLength(1);
  const note = (await page.evaluate(() => (window as unknown as W).__notes))[0]!;
  expect(note.title).toBe(SYMBOL);
  expect(note.body).toContain(`${SYMBOL} crossed trend line `);
  const fired = (await alerts(page))[0]!;
  expect(fired.enabled).toBe(false);
  await expect.poll(async () => (await draws(page)).alertLines).toEqual([]);
  expect((await draws(page)).trendAlerts).toEqual([]);

  await page.getByTestId('alerts-button').click();
  await page.getByTestId('alerts-tab-history').click();
  const event = page.getByTestId('alert-event-row').first();
  await expect(event.getByTestId('alert-event-symbol')).toHaveText(SYMBOL);
  await page.keyboard.press('Escape');

  const now = (await draws(page)).shapes.find((p) => p.id === line.id)!.shape;
  await page.mouse.click(box.x + (now.a.x + now.b.x) / 2, box.y + (now.a.y + now.b.y) / 2);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(line.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);
  await expect.poll(async () => (await alerts(page)).length, { timeout: 5000 }).toBe(0);
});

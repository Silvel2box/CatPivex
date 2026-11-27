import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp, waitLoaded } from './phase3-helpers';

type Drawing = { id: string; type: string; price?: number; color: string; width: number };
type W = {
  __catpivex: {
    drawings(): {
      symbol: string | null;
      loading: boolean;
      tool: string | null;
      selectedId: string | null;
      drawings: Drawing[];
    };
    alerts(): { alerts: { id: number; drawing_id: string | null; price: number }[] };
    state(): { lastBar: { time: number } | null };
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
  };
};

const BTC = 'BINANCE:BTCUSDT';

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const savedLayout = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/layout`)).json()).layout as Record<
    string,
    unknown
  > | null;

async function drawingsLoaded(page: Page) {
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
}

/** Page x of a fixed bar time: changes when the chart pans. */
async function anchorX(page: Page, time: number) {
  return page.evaluate((t) => (window as unknown as W).__catpivex.timeToX(t), time);
}

async function lineY(page: Page, price: number) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const y = await page.evaluate((p) => (window as unknown as W).__catpivex.priceToY(p), price);
  return box.y + y!;
}

test.beforeEach(async ({ page }) => {
  for (const a of await (await page.request.get(`${E2E_API}/api/alerts`)).json())
    await page.request.delete(`${E2E_API}/api/alerts/${a.id}`);
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await drawingsLoaded(page);
});

test('T6.3 floating drawing bar: shows on selection, styles without deselecting or panning, drags, keeps its place, adds a line alert', async ({
  page,
}) => {
  const chart = page.getByTestId('chart');
  const bar = page.getByTestId('drawing-style');
  const box = (await chart.boundingBox())!;
  const x = box.x + box.width * 0.4;

  await page.keyboard.press('Alt+H');
  await page.mouse.click(x, box.y + box.height * 0.5);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const line = (await draws(page)).drawings[0]!;
  expect((await draws(page)).selectedId).toBe(line.id);

  // Default: top centre of the chart, 8 px down, and not part of the left toolbar.
  await expect(bar).toBeVisible();
  const b0 = (await bar.boundingBox())!;
  expect(Math.abs(b0.y - box.y - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(b0.x + b0.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('navigation', { name: 'Drawing tools' }).getByTestId('drawing-color'),
  ).toHaveCount(0);
  await expect(bar.getByTestId('drawing-fill')).toHaveCount(0); // fib only

  // Empty chart click: deselect, bar gone. Click the line again: back.
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8);
  await expect.poll(async () => (await draws(page)).selectedId).toBeNull();
  await expect(bar).toHaveCount(0);
  const y = await lineY(page, line.price!);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await draws(page)).selectedId).toBe(line.id);
  await expect(bar).toBeVisible();

  const t0 = (await page.evaluate(() => (window as unknown as W).__catpivex.state().lastBar))!.time;
  const x0 = (await anchorX(page, t0))!;

  // Style through the bar: the drawing changes and stays selected.
  await page.getByTestId('drawing-color').fill('#ff0000');
  await expect.poll(async () => (await draws(page)).drawings[0]!.color).toBe('#ff0000');
  await page.getByTestId('drawing-width').selectOption('3');
  await expect.poll(async () => (await draws(page)).drawings[0]!.width).toBe(3);
  await bar.click({ position: { x: 2, y: 2 } }); // the bar's own padding
  expect((await draws(page)).selectedId).toBe(line.id);
  await page.getByTestId('drawing-bar-grip').click();
  expect((await draws(page)).selectedId).toBe(line.id);
  await expect(bar).toBeVisible();

  // Drag the grip: the bar moves, the chart does not pan, the drawing stays selected.
  const grip = (await page.getByTestId('drawing-bar-grip').boundingBox())!;
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx - 150, gy + 120, { steps: 8 });
  await page.mouse.move(gx - 250, gy + 200, { steps: 8 });
  await page.mouse.up();
  const b1 = (await bar.boundingBox())!;
  expect(Math.abs(b1.x - (b0.x - 250))).toBeLessThanOrEqual(1);
  expect(Math.abs(b1.y - (b0.y + 200))).toBeLessThanOrEqual(1);
  expect(Math.abs((await anchorX(page, t0))! - x0)).toBeLessThan(20); // a pan would be ~250 px
  expect((await draws(page)).selectedId).toBe(line.id);
  const pos = { x: Math.round(b1.x - box.x), y: Math.round(b1.y - box.y) };
  await expect.poll(async () => (await savedLayout(page))?.drawingBar).toEqual(pos);

  // Dragging past the edge stops at the edge.
  const g1 = (await page.getByTestId('drawing-bar-grip').boundingBox())!;
  await page.mouse.move(g1.x + 4, g1.y + 4);
  await page.mouse.down();
  await page.mouse.move(g1.x - 2000, g1.y - 2000, { steps: 4 });
  await page.mouse.move(g1.x - 2000, g1.y - 2000);
  await page.mouse.up();
  const b2 = (await bar.boundingBox())!;
  expect(b2.x).toBeCloseTo(box.x, 0);
  expect(b2.y).toBeCloseTo(box.y, 0);
  await expect.poll(async () => (await savedLayout(page))?.drawingBar).toEqual({ x: 0, y: 0 });

  // Put it back mid-chart for the reload check.
  await page.mouse.move(b2.x + 6, b2.y + 10);
  await page.mouse.down();
  await page.mouse.move(b2.x + 6 + pos.x, b2.y + 10 + pos.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await savedLayout(page))?.drawingBar).toEqual(pos);

  // Bell on an hline: adds a linked alert, then becomes "Edit alert".
  await expect(page.getByTestId('bar-edit-alert')).toHaveCount(0);
  await page.getByTestId('bar-add-alert').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as W).__catpivex.alerts().alerts.map((a) => [a.drawing_id, a.price]),
      ),
    )
    .toEqual([[line.id, line.price]]);
  await expect(page.getByTestId('bar-add-alert')).toHaveCount(0);
  await page.getByTestId('bar-edit-alert').click();
  await expect(page.getByTestId('alert-form')).toBeVisible();
  await expect(page.getByTestId('alert-price-hint')).toContainText('Linked to a line');
  expect((await draws(page)).selectedId).toBe(line.id);
  expect(Math.abs((await anchorX(page, t0))! - x0)).toBeLessThan(20);
  await page.getByTestId('alert-cancel').click();

  // Reload: nothing selected (no bar); select again -> the saved position.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitLoaded(page, '1m');
  await drawingsLoaded(page);
  await expect(bar).toHaveCount(0);
  await page.mouse.click(x, await lineY(page, line.price!));
  await expect.poll(async () => (await draws(page)).selectedId).toBe(line.id);
  await expect(page.getByTestId('bar-edit-alert')).toBeVisible();
  const b3 = (await bar.boundingBox())!;
  expect(Math.round(b3.x - box.x)).toBe(pos.x);
  expect(Math.round(b3.y - box.y)).toBe(pos.y);

  // A smaller window clamps the bar back inside the chart.
  await page.setViewportSize({ width: 800, height: 420 });
  await expect
    .poll(async () => {
      const c = (await chart.boundingBox())!;
      const r = (await bar.boundingBox())!;
      return (
        r.x >= c.x - 0.5 &&
        r.y >= c.y - 0.5 &&
        r.x + r.width <= c.x + c.width + 0.5 &&
        r.y + r.height <= c.y + c.height + 0.5
      );
    })
    .toBe(true);
  await page.setViewportSize({ width: 1400, height: 800 });

  // Delete from the bar.
  await page.getByTestId('drawing-delete').click();
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);
  await expect(bar).toHaveCount(0);
});

test('T6.3b bar on a selected fib (screenshot)', async ({ page }) => {
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.keyboard.press('Alt+F');
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const bar = page.getByTestId('drawing-style');
  await expect(bar).toBeVisible();
  for (const id of ['drawing-fill', 'drawing-reverse', 'drawing-extend', 'drawing-delete'])
    await expect(bar.getByTestId(id)).toBeVisible();
  await expect(bar.getByTestId('bar-add-alert')).toHaveCount(0); // a fib has no alert level
  await page.screenshot({ path: test.info().outputPath('p6c-bar.png') });
});

test('T6.4 stay in drawing mode: the tool stays after each drawing, Esc leaves it, the setting survives reload', async ({
  page,
}) => {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const lock = page.getByTestId('draw-stay-toggle');
  const x = box.x + box.width * 0.5;
  const n = async () => (await draws(page)).drawings.length;

  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Alt+H');
  for (const fy of [0.3, 0.45, 0.6]) {
    await page.mouse.click(x, box.y + box.height * fy);
  }
  await expect.poll(n).toBe(3);
  let s = await draws(page);
  expect(s.drawings.every((d) => d.type === 'hline')).toBe(true);
  expect(s.tool).toBe('hline');
  expect(s.selectedId).toBeNull();
  await expect(page.getByTestId('drawing-style')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await draws(page)).tool).toBeNull();

  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Alt+H');
  await page.mouse.click(x, box.y + box.height * 0.75);
  await expect.poll(n).toBe(4);
  s = await draws(page);
  expect(s.tool).toBeNull();
  expect(s.selectedId).toBe(s.drawings[3]!.id);

  // Right-click also leaves the tool while the lock is on.
  await lock.click();
  await page.keyboard.press('Alt+H');
  await page.mouse.click(x, box.y + box.height * 0.2);
  await expect.poll(n).toBe(5);
  expect((await draws(page)).tool).toBe('hline');
  await page.mouse.click(x, box.y + box.height * 0.85, { button: 'right' });
  await expect.poll(async () => (await draws(page)).tool).toBeNull();
  expect(await n()).toBe(5);

  await expect.poll(async () => (await savedLayout(page))?.stayInTool).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await drawingsLoaded(page);
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  expect(await n()).toBe(5);
});

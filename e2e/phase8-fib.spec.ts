import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp } from './phase3-helpers';

type Anchor = { time: number; price: number };
type Drawing = { id: string; type: string; a?: Anchor; b?: Anchor; levels?: number[] };
type Shape = {
  type: string;
  a?: { x: number; y: number };
  b?: { x: number; y: number };
  levelYs?: number[];
};
type W = {
  __catpivex: {
    drawings(): {
      symbol: string | null;
      loading: boolean;
      selectedId: string | null;
      drawings: Drawing[];
      shapes: { id: string; shape: Shape }[];
    };
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
  };
};

const BTC = 'BINANCE:BTCUSDT';
const DEFAULTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const fibOf = async (page: Page) => (await draws(page)).drawings[0]!;
const levelsOf = async (page: Page) => (await fibOf(page)).levels ?? DEFAULTS;
const savedDrawings = async (page: Page) =>
  ((await (await page.request.get(`${E2E_API}/api/drawings/${BTC}`)).json()).drawings ??
    []) as Drawing[];

async function drawingsLoaded(page: Page) {
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
}

async function at(page: Page, time: number, price: number) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const [x, y] = await page.evaluate(
    ([t, p]) => {
      const h = (window as unknown as W).__catpivex;
      return [h.timeToX(t), h.priceToY(p)];
    },
    [time, price],
  );
  return { x: box.x + x!, y: box.y + y! };
}

async function selectFib(page: Page) {
  const box = (await page.getByTestId('chart').boundingBox())!;
  const shape = (await draws(page)).shapes[0]!.shape;
  await page.mouse.click(
    box.x + (shape.a!.x + shape.b!.x) / 2,
    box.y + (shape.a!.y + shape.b!.y) / 2,
  );
  const id = (await fibOf(page)).id;
  await expect.poll(async () => (await draws(page)).selectedId).toBe(id);
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await drawingsLoaded(page);
});

test('Phase 8 fib levels: toggle presets, add custom, last level stays, keys, undo, reload', async ({
  page,
}) => {
  const res = await page.request.get(`${E2E_API}/api/candles?symbol=${BTC}&interval=1m&limit=500`);
  const bars = (await res.json()).candles as { time: number; low: number; high: number }[];
  const lo = bars[bars.length - 70]!;
  const hi = bars[bars.length - 30]!;
  const p0 = await at(page, lo.time, lo.low);
  const p1 = await at(page, hi.time, hi.high);
  await page.keyboard.press('Alt+F');
  await page.mouse.click(p0.x, p0.y);
  await page.mouse.click(p1.x, p1.y);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const fib = await fibOf(page);
  expect(fib.type).toBe('fib');
  expect(fib).not.toHaveProperty('levels');
  expect((await draws(page)).selectedId).toBe(fib.id);

  const toggle = page.getByTestId('drawing-fib-levels');
  const panel = page.getByTestId('fib-levels-panel');
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await expect(panel).toBeVisible();
  for (const l of DEFAULTS) await expect(page.getByTestId(`fib-level-${l}`)).toBeChecked();
  for (const l of [1.272, 1.618, 2, 2.618, 3.618, 4.236]) {
    await expect(page.getByTestId(`fib-level-${l}`)).not.toBeChecked();
  }

  await page.getByTestId('fib-level-1.618').check();
  await expect.poll(() => levelsOf(page)).toEqual([...DEFAULTS, 1.618]);
  const a = fib.a!;
  const b = fib.b!;
  const y1618 = await page.evaluate(
    (p) => (window as unknown as W).__catpivex.priceToY(p),
    b.price + (a.price - b.price) * 1.618,
  );
  await expect
    .poll(async () => (await draws(page)).shapes[0]!.shape.levelYs!.length)
    .toBe(DEFAULTS.length + 1);
  expect((await draws(page)).shapes[0]!.shape.levelYs!.at(-1)!).toBeCloseTo(y1618!, 1);

  await page.getByTestId('fib-level-0.5').uncheck();
  await expect.poll(() => levelsOf(page)).toEqual([0, 0.236, 0.382, 0.618, 0.786, 1, 1.618]);
  await expect
    .poll(async () => (await draws(page)).shapes[0]!.shape.levelYs!.length)
    .toBe(DEFAULTS.length);

  const input = page.getByTestId('fib-level-custom');
  await input.fill('99');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('fib-level-add').click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await levelsOf(page)).toEqual([0, 0.236, 0.382, 0.618, 0.786, 1, 1.618]);
  await input.fill('');
  await page.getByTestId('fib-level-add').click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.fill('0.65');
  await expect(input).not.toHaveAttribute('aria-invalid');
  await input.press('Enter');
  await expect.poll(() => levelsOf(page)).toEqual([0, 0.236, 0.382, 0.618, 0.65, 0.786, 1, 1.618]);
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('fib-level-remove-0.65')).toBeVisible();

  await input.fill('12');
  await input.press('Backspace');
  await input.press('Delete');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  expect((await draws(page)).drawings).toHaveLength(1);
  expect((await draws(page)).selectedId).toBe(fib.id);

  await input.press('Escape');
  await expect(panel).toHaveCount(0);
  expect((await draws(page)).selectedId).toBe(fib.id);

  await page.keyboard.press('Control+z');
  await expect.poll(() => levelsOf(page)).toEqual([0, 0.236, 0.382, 0.618, 0.786, 1, 1.618]);
  await page.keyboard.press('Control+y');
  await expect.poll(() => levelsOf(page)).toEqual([0, 0.236, 0.382, 0.618, 0.65, 0.786, 1, 1.618]);

  const expected = [0, 0.236, 0.382, 0.618, 0.65, 0.786, 1, 1.618];
  await expect.poll(async () => (await savedDrawings(page))[0]?.levels).toEqual(expected);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await drawingsLoaded(page);
  expect(await levelsOf(page)).toEqual(expected);
  await expect
    .poll(async () => (await draws(page)).shapes[0]?.shape.levelYs?.length)
    .toBe(expected.length);

  await selectFib(page);
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('fib-level-1.618')).toBeChecked();
  await expect(page.getByTestId('fib-level-0.5')).not.toBeChecked();
  await expect(page.getByTestId('fib-level-remove-0.65')).toBeVisible();

  for (const l of [0.236, 0.382, 0.618, 0.786, 1, 1.618]) {
    await page.getByTestId(`fib-level-${l}`).uncheck();
  }
  await page.getByTestId('fib-level-remove-0.65').click();
  await expect.poll(() => levelsOf(page)).toEqual([0]);
  await expect(page.getByTestId('fib-level-remove-0.65')).toHaveCount(0);
  const last = page.getByTestId('fib-level-0');
  await expect(last).toBeChecked();
  await expect(last).toBeDisabled();
  await last.click({ force: true });
  await expect(last).toBeChecked();
  expect(await levelsOf(page)).toEqual([0]);
  expect((await draws(page)).shapes[0]!.shape.levelYs).toHaveLength(1);

  await toggle.click();
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await expect(panel).toBeVisible();
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.9);
  await expect(panel).toHaveCount(0);

  await selectFib(page);
  await expect(page.getByTestId('drawing-style')).toBeVisible();
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect((await draws(page)).selectedId).toBe(fib.id);
});

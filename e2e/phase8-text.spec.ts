import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp, waitLoaded } from './phase3-helpers';

type Anchor = { time: number; price: number };
type TextDrawing = {
  id: string;
  type: string;
  color: string;
  a: Anchor;
  text: string;
  size: number;
};
type Shape = { type: string; a: { x: number; y: number }; w: number; h: number };
type DrawState = {
  symbol: string | null;
  loading: boolean;
  tool: string | null;
  selectedId: string | null;
  drawings: TextDrawing[];
  shapes: { id: string; shape: Shape }[];
  priceLabels: string[];
  timeLabels: string[];
};
type W = { __catpivex: { drawings(): DrawState } };

const BTC = 'BINANCE:BTCUSDT';

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const shapeOf = async (page: Page, id: string) =>
  (await draws(page)).shapes.find((s) => s.id === id)?.shape;
const saved = async (page: Page) =>
  ((await (await page.request.get(`${E2E_API}/api/drawings/${BTC}`)).json()).drawings ??
    []) as TextDrawing[];

async function drawingsLoaded(page: Page) {
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
}

async function chartBox(page: Page) {
  return (await page.getByTestId('chart').boundingBox())!;
}

async function openEditorAt(page: Page, x: number, y: number) {
  await page.getByTestId('draw-tool-text').click();
  await expect.poll(async () => (await draws(page)).tool).toBe('text');
  await page.mouse.click(x, y);
  await expect(page.getByTestId('text-editor')).toBeFocused();
}

async function createText(page: Page, x: number, y: number, value: string) {
  const before = (await draws(page)).drawings.length;
  await openEditorAt(page, x, y);
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(before + 1);
  return (await draws(page)).drawings.at(-1)!;
}

async function centre(page: Page, id: string) {
  const box = await chartBox(page);
  const s = (await shapeOf(page, id))!;
  return { x: box.x + s.a.x + s.w / 2, y: box.y + s.a.y + s.h / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await drawingsLoaded(page);
});

test('P8.1 text tool: click opens the editor, Shift+Enter adds a line, Enter commits; Esc cancels', async ({
  page,
}) => {
  const box = await chartBox(page);
  const editor = page.getByTestId('text-editor');
  const x = box.x + box.width * 0.35;
  const y = box.y + box.height * 0.4;

  await expect(page.getByTestId('draw-tool-text')).toHaveAttribute('title', 'Text');
  await openEditorAt(page, x, y);
  expect((await draws(page)).drawings).toHaveLength(0);
  const e0 = (await editor.boundingBox())!;
  expect(Math.abs(e0.x - x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(e0.y - y)).toBeLessThanOrEqual(1.5);

  await page.keyboard.type('Line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line two');
  expect((await draws(page)).drawings).toHaveLength(0);
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const s = await draws(page);
  const d = s.drawings[0]!;
  expect(d).toMatchObject({ type: 'text', text: 'Line one\nLine two', size: 14, color: '#2962ff' });
  expect(s.tool).toBeNull();
  expect(s.selectedId).toBe(d.id);
  const shape = (await shapeOf(page, d.id))!;
  expect(shape.type).toBe('text');
  expect(Math.abs(shape.a.x - (x - box.x))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(shape.a.y - (y - box.y))).toBeLessThanOrEqual(1.5);
  expect(shape.h).toBeCloseTo(2 * 14 * 1.25, 5);
  expect(shape.w).toBeGreaterThan(30);
  await expect
    .poll(async () => {
      const l = await draws(page);
      return [l.priceLabels.length, l.timeLabels.length];
    })
    .toEqual([1, 1]);
  await expect(page.getByTestId('drawing-style')).toBeVisible();

  await openEditorAt(page, box.x + box.width * 0.6, box.y + box.height * 0.7);
  await page.keyboard.type('never mind');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  expect((await draws(page)).drawings).toHaveLength(1);
  expect((await draws(page)).tool).toBe('text');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await draws(page)).tool).toBeNull();

  await openEditorAt(page, box.x + box.width * 0.6, box.y + box.height * 0.7);
  await page.keyboard.type('   ');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  expect((await draws(page)).drawings).toHaveLength(1);

  await expect
    .poll(async () => (await saved(page)).map((x) => x.text))
    .toEqual(['Line one\nLine two']);
});

test('P8.2 editing: double-click and the pencil, keys stay in the editor, empty removes, Ctrl+Z undoes', async ({
  page,
}) => {
  const box = await chartBox(page);
  const editor = page.getByTestId('text-editor');
  const d = await createText(page, box.x + box.width * 0.4, box.y + box.height * 0.45, 'abc');

  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85);
  await expect.poll(async () => (await draws(page)).selectedId).toBeNull();

  const c = await centre(page, d.id);
  await page.mouse.dblclick(c.x, c.y);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('abc');
  expect((await draws(page)).selectedId).toBe(d.id);

  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Alt+H');
  expect((await draws(page)).drawings).toHaveLength(1);
  expect((await draws(page)).tool).toBeNull();
  await expect(editor).toHaveValue('ab');

  const before = (await shapeOf(page, d.id))!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await shapeOf(page, d.id))!.a.x).not.toBeCloseTo(before.a.x, 0);
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => {
      const s = (await shapeOf(page, d.id))!;
      const e = (await editor.boundingBox())!;
      return Math.abs(e.x - box.x - s.a.x) <= 1.5 && Math.abs(e.y - box.y - s.a.y) <= 1.5;
    })
    .toBe(true);

  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draws(page)).drawings[0]?.text).toBe('ab');
  expect((await draws(page)).selectedId).toBe(d.id);

  await page.getByTestId('drawing-text-edit').click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('ab');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await draws(page)).drawings[0]?.text).toBe('abc');
  await page.keyboard.press('Control+Y');
  await expect.poll(async () => (await draws(page)).drawings[0]?.text).toBe('ab');

  await page.getByTestId('drawing-text-edit').click();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(0);
  await expect(page.getByTestId('drawing-style')).toHaveCount(0);

  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await draws(page)).drawings[0]?.text).toBe('ab');
  await expect.poll(async () => (await saved(page)).map((x) => x.text)).toEqual(['ab']);
});

test('P8.3 bar sets size, clicking outside commits, drag moves, reload keeps it', async ({
  page,
}) => {
  const box = await chartBox(page);
  const bar = page.getByTestId('drawing-style');
  const editor = page.getByTestId('text-editor');
  const d = await createText(page, box.x + box.width * 0.3, box.y + box.height * 0.3, 'Note');

  await expect(bar).toBeVisible();
  await expect(bar.getByTestId('drawing-width')).toHaveCount(0);
  await expect(bar.getByTestId('drawing-color')).toBeVisible();
  await expect(bar.getByTestId('drawing-delete')).toBeVisible();
  const size = bar.getByTestId('drawing-text-size');
  await expect(size).toHaveValue('14');
  const h14 = (await shapeOf(page, d.id))!;
  await size.selectOption('24');
  await expect.poll(async () => (await draws(page)).drawings[0]?.size).toBe(24);
  const h24 = (await shapeOf(page, d.id))!;
  expect(h24.h).toBeCloseTo(24 * 1.25, 5);
  expect(h24.w).toBeGreaterThan(h14.w);
  await page.getByTestId('drawing-color').fill('#ff0000');
  await expect.poll(async () => (await draws(page)).drawings[0]?.color).toBe('#ff0000');

  const c = await centre(page, d.id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 40, c.y + 25, { steps: 5 });
  await page.mouse.move(c.x + 80, c.y + 50, { steps: 5 });
  await page.mouse.up();
  const moved = (await draws(page)).drawings[0]!;
  expect(moved.a.time).toBeGreaterThan(d.a.time);
  expect(moved.a.price).toBeLessThan(d.a.price);
  const ms = (await shapeOf(page, d.id))!;
  expect(Math.abs(ms.a.x - h24.a.x - 80)).toBeLessThanOrEqual(2);
  expect(Math.abs(ms.a.y - h24.a.y - 50)).toBeLessThanOrEqual(2);

  await openEditorAt(page, box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.keyboard.type('outside');
  const nc = await centre(page, d.id);
  await page.mouse.click(nc.x, nc.y);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(2);
  const s = await draws(page);
  const second = s.drawings[1]!;
  expect(second.text).toBe('outside');
  expect(s.selectedId).toBe(second.id);
  expect(s.tool).toBeNull();
  expect(s.drawings[0]!.a).toEqual(moved.a);

  const want = [
    { text: 'Note', size: 24, color: '#ff0000', a: moved.a },
    { text: 'outside', size: 14, color: '#2962ff', a: second.a },
  ];
  const pick = (ds: TextDrawing[]) =>
    ds.map(({ text, size, color, a }) => ({ text, size, color, a }));
  await expect.poll(async () => pick(await saved(page))).toEqual(want);

  await page.reload();
  await page.waitForFunction(() => (window as unknown as Partial<W>).__catpivex !== undefined);
  await waitLoaded(page, '1m');
  await drawingsLoaded(page);
  expect(pick((await draws(page)).drawings)).toEqual(want);
  await expect.poll(async () => (await draws(page)).shapes.length).toBe(2);
});

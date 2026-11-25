import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp, waitLoaded } from './phase3-helpers';

type Anchor = { time: number; price: number };
type W = {
  __catpivex: {
    drawings(): {
      symbol: string | null;
      loading: boolean;
      tool: string | null;
      measuring: boolean;
      magnet: boolean;
      drawings: { id: string; type: string; a?: Anchor; b?: Anchor }[];
    };
    measure(): { a: Anchor; b: Anchor; lines: string[] } | null;
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
  };
};
type Bar = { time: number; open: number; high: number; low: number; close: number };

const BTC = 'BINANCE:BTCUSDT';
const SPAN = 27;

const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.drawings());
const measure = (page: Page) => page.evaluate(() => (window as unknown as W).__catpivex.measure());

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

async function candles(page: Page, interval: string) {
  const res = await page.request.get(
    `${E2E_API}/api/candles?symbol=${BTC}&interval=${interval}&limit=500`,
  );
  return (await res.json()).candles as Bar[];
}

const savedDrawings = async (page: Page) =>
  ((await (await page.request.get(`${E2E_API}/api/drawings/${BTC}`)).json()).drawings ??
    []) as unknown[];

/** Expected label lines for a measurement from bar a's close to bar b's close. */
function expected(a: Bar, b: Bar, bars: number, duration: string) {
  const diff = b.close - a.close;
  const pct = (diff / Math.abs(a.close)) * 100;
  const sign = (v: number) => (v < 0 ? '-' : '+');
  return [
    `${sign(diff)}${Math.abs(diff).toFixed(2)} (${sign(pct)}${Math.abs(pct).toFixed(2)}%)`,
    `${bars} bars, ${duration}`,
  ];
}
const noCommas = (lines: string[]) => [lines[0]!.replace(/,/g, ''), lines[1]];

/**
 * Two closed bars SPAN apart, each with its close at least 4 px from its open/high/low, so the
 * magnet lands exactly on the close.
 */
async function pickBars(page: Page) {
  const bars = await candles(page, '1h');
  const px = (p: number) =>
    page.evaluate((v) => (window as unknown as W).__catpivex.priceToY(v)!, p);
  const clear = async (c: Bar) => {
    const y = await px(c.close);
    for (const p of [c.open, c.high, c.low]) if (Math.abs((await px(p)) - y) < 4) return false;
    return true;
  };
  for (let j = bars.length - 5; j - SPAN >= bars.length - 120; j--) {
    const i = j - SPAN;
    if (bars[j]!.time - bars[i]!.time !== SPAN * 3600) continue;
    if ((await clear(bars[i]!)) && (await clear(bars[j]!))) return { a: bars[i]!, b: bars[j]! };
  }
  throw new Error('no suitable bars');
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await openApp(page);
  await expect
    .poll(async () => {
      const s = await draws(page);
      return s.symbol === BTC && !s.loading;
    })
    .toBe(true);
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
  await page.getByTestId('magnet-toggle').click();
  await expect.poll(async () => (await draws(page)).magnet).toBe(true);
});

test('T6.2 Shift+drag measures price change, %, bars and time; not a drawing; Esc removes it', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/drawings/') && r.method() !== 'GET') writes.push(r.method());
  });
  const { a, b } = await pickBars(page);
  const pa = await at(page, a.time, a.close);
  const pb = await at(page, b.time, b.close);

  await page.keyboard.down('Shift');
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pb.x, pb.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const m = (await measure(page))!;
  expect(m.a).toEqual({ time: a.time, price: a.close });
  expect(m.b).toEqual({ time: b.time, price: b.close });
  expect(noCommas(m.lines)).toEqual(expected(a, b, SPAN, '1d 3h'));
  const s = await draws(page);
  expect(s.drawings).toEqual([]);
  expect(s.measuring).toBe(false);

  // Stays after the mouse moves away; Esc removes it.
  await page.mouse.move(pa.x - 100, pa.y + 50, { steps: 3 });
  expect((await measure(page))?.lines).toEqual(m.lines);
  await page.keyboard.press('Escape');
  await expect.poll(() => measure(page)).toBeNull();

  // Nothing was saved: the detector does see a real drawing being saved.
  await page.waitForTimeout(1200);
  expect(writes).toEqual([]);
  expect(await savedDrawings(page)).toEqual([]);
  await page.keyboard.press('Alt+H');
  await page.mouse.click(pa.x, pa.y);
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  await expect.poll(async () => (await savedDrawings(page)).length).toBe(1);
});

test('T6.2b toolbar ruler: two clicks (leftwards), one-shot, next press clears it', async ({
  page,
}) => {
  const { a, b } = await pickBars(page);
  const pa = await at(page, a.time, a.close);
  const pb = await at(page, b.time, b.close);
  const button = page.getByTestId('draw-tool-measure');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await draws(page)).measuring).toBe(true);
  await page.mouse.click(pb.x, pb.y);
  await page.mouse.move(pa.x, pa.y, { steps: 5 });
  // While placing, the box follows the mouse.
  await expect.poll(async () => (await measure(page))?.b).toEqual({ time: a.time, price: a.close });
  await page.mouse.click(pa.x, pa.y);

  const m = (await measure(page))!;
  expect(m.a).toEqual({ time: b.time, price: b.close });
  expect(noCommas(m.lines)).toEqual(expected(b, a, -SPAN, '1d 3h'));
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await draws(page)).measuring).toBe(false);
  expect((await draws(page)).drawings).toEqual([]);

  // The next press on the chart clears it (and does not start a new one).
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => measure(page)).toBeNull();

  // Armed ruler and drawing tools cancel each other; right-click cancels a ruler being placed.
  await button.click();
  await page.keyboard.press('Alt+T');
  expect((await draws(page)).tool).toBe('trendline');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  expect((await draws(page)).tool).toBe(null);
  await page.mouse.click(pb.x, pb.y);
  await page.mouse.move(pa.x, pa.y, { steps: 3 });
  expect(await measure(page)).not.toBeNull();
  await page.mouse.click(pa.x, pa.y, { button: 'right' });
  await expect.poll(() => measure(page)).toBeNull();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('T6.2c Shift+press on a trend line still drags it instead of measuring', async ({ page }) => {
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.getByTestId('magnet-toggle').click();
  await expect.poll(async () => (await draws(page)).magnet).toBe(false);
  const s0 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  await page.keyboard.press('Alt+T');
  await page.mouse.click(s0.x, s0.y);
  await page.mouse.click(s0.x + 200, s0.y + 100);
  await expect.poll(async () => (await draws(page)).drawings.length).toBe(1);
  const before = (await draws(page)).drawings[0]!;
  await page.keyboard.press('Escape');

  const mid = { x: s0.x + 100, y: s0.y + 50 };
  await page.keyboard.down('Shift');
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y - 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const after = (await draws(page)).drawings;
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(before.id);
  expect(after[0]!.a!.time).toBeGreaterThan(before.a!.time);
  expect(after[0]!.a!.price).toBeGreaterThan(before.a!.price);
  expect(await measure(page)).toBeNull();
});

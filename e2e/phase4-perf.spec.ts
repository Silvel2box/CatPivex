import { E2E_API } from '../playwright.config';
import { expect, test, type Page } from './fixtures';
import { openApp } from './phase3-helpers';

// Headed window: headless has no real compositor, so its frame rate means nothing.
test.use({ headless: false });

const BTC = 'BINANCE:BTCUSDT';
type W = {
  __catpivex: {
    timeToX(t: number): number | null;
    priceToY(p: number): number | null;
    drawings(): { drawings: unknown[]; selectedId: string | null };
  };
};

/** Counts rAF frames while `move(i)` is called in a loop for 5 s; returns fps. */
async function fpsWhile(page: Page, label: string, move: (i: number) => Promise<void>) {
  // Each run has its own id, so a previous run's pending rAF callback can't keep counting.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __run: number };
    const run = (w.__run ?? 0) + 1;
    w.__run = run;
    w.__frames = 0;
    const tick = () => {
      if (w.__run !== run) return;
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 5_000) await move(i++);
  const seconds = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __run: number };
    w.__run++; // stops this run's loop
    return w.__frames;
  });
  const win = await page.evaluate(
    () => `visibility=${document.visibilityState} focus=${document.hasFocus()}`,
  );
  const fps = frames / seconds;
  const result = `${label}: ${frames} frames, ${i} moves in ${seconds.toFixed(2)} s = ${fps.toFixed(1)} fps (${win})`;
  console.log(result);
  return { fps, result };
}

/** Swings x back and forth across the middle of the chart. */
const swing = (i: number, center: number, amp: number) =>
  center + amp * Math.sin((i / 40) * Math.PI * 2);

test('T4.10 drawing interactions stay ≥ 50 fps: drag a fib, drag an end point, preview while drawing', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bars = (
    await (await page.request.get(`${E2E_API}/api/candles?symbol=${BTC}&interval=1m&limit=500`)).json()
  ).candles as { time: number; high: number; low: number }[];
  const lo = bars[bars.length - 90]!;
  const hi = bars[bars.length - 30]!;
  const t1 = bars[bars.length - 70]!;
  const t2 = bars[bars.length - 50]!;
  await page.request.put(`${E2E_API}/api/drawings/${BTC}`, {
    data: {
      drawings: [
        {
          id: 'fib1',
          type: 'fib',
          color: '#787b86',
          width: 1,
          a: { time: lo.time, price: lo.low },
          b: { time: hi.time, price: hi.high },
        },
        {
          id: 'tl1',
          type: 'trendline',
          color: '#2962ff',
          width: 2,
          a: { time: t1.time, price: t1.low },
          b: { time: t2.time, price: t2.high },
        },
      ],
    },
  });
  await openApp(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__catpivex.drawings().drawings.length))
    .toBe(2);

  const box = (await page.getByTestId('chart').boundingBox())!;
  const px = async (time: number, price: number) => {
    const [x, y] = await page.evaluate(
      ([t, p]) => {
        const h = (window as unknown as W).__catpivex;
        return [h.timeToX(t), h.priceToY(p)];
      },
      [time, price],
    );
    return { x: box.x + x!, y: box.y + y! };
  };
  const results: string[] = [];

  // 1. Drag the fib by its a–b diagonal.
  const fa = await px(lo.time, lo.low);
  const fb = await px(hi.time, hi.high);
  const fmid = { x: (fa.x + fb.x) / 2, y: (fa.y + fb.y) / 2 };
  await page.mouse.move(fmid.x, fmid.y);
  await page.mouse.down();
  const r1 = await fpsWhile(page, 'drag fib', (i) =>
    page.mouse.move(swing(i, fmid.x, 120), fmid.y + 40 * Math.cos((i / 40) * Math.PI * 2)),
  );
  await page.mouse.up();
  results.push(r1.result);

  // 2. Drag the trend line's end point b.
  await page.keyboard.press('Escape');
  const tb = await px(t2.time, t2.high);
  await page.mouse.move(tb.x, tb.y);
  await page.mouse.down();
  const r2 = await fpsWhile(page, 'drag end point', (i) =>
    page.mouse.move(swing(i, tb.x, 100), tb.y + 60 * Math.sin((i / 25) * Math.PI * 2)),
  );
  await page.mouse.up();
  results.push(r2.result);

  // 3. Preview while drawing a new trend line (first click done, mouse moving).
  await page.keyboard.press('Escape');
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.6 };
  await page.keyboard.press('Alt+T');
  await page.mouse.click(start.x, start.y);
  const r3 = await fpsWhile(page, 'drawing preview', (i) =>
    page.mouse.move(swing(i, box.x + box.width * 0.55, 150), box.y + box.height * (0.4 + 0.15 * Math.sin(i / 7))),
  );
  await page.keyboard.press('Escape');
  results.push(r3.result);

  for (const r of [r1, r2, r3]) expect(r.fps, results.join('\n')).toBeGreaterThanOrEqual(50);
});

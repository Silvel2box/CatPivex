import { expect, test, type Page } from './fixtures';
import { addIndicators, openApp, waitLoaded } from './phase3-helpers';

type Pt = { time: number; value?: number; color?: string };
type Sample = { logical: number; a: number; b: number };
type Cloud = {
  id: string;
  from: number | null;
  to: number | null;
  futureBars: number;
  segments: { from: number; to: number; up: boolean; fill: string }[];
  last: Sample | null;
  future: Sample[];
  futureLines: { a: number; b: number };
};
type W = {
  __catpivex: {
    state(): {
      barCount: number;
      lastBar: { time: number; close: number } | null;
    };
    indicators(): {
      id: string;
      type: string;
      params: Record<string, number>;
    }[];
    indicatorSeries(id: string, line: string): { chart: Pt[]; items: Pt[] };
    ichimokuClouds(): Cloud[];
    xForLogical(logical: number): number | null;
    xForTime(time: number): number | null;
    priceToY(price: number): number | null;
  };
};

const LINES = ['tenkan', 'kijun', 'lagging', 'leadA', 'leadB'] as const;

const snapshot = (page: Page) =>
  page.evaluate((lines) => {
    const h = (window as unknown as W).__catpivex;
    const ind = h.indicators().find((i) => i.type === 'ichimoku');
    const series = Object.fromEntries(
      lines.map((l) => [l, ind ? h.indicatorSeries(ind.id, l) : { chart: [], items: [] }]),
    );
    return {
      id: ind?.id ?? null,
      params: ind?.params ?? null,
      state: h.state(),
      series,
      cloud: h.ichimokuClouds().find((c) => c.id === ind?.id) ?? null,
      clouds: h.ichimokuClouds().length,
    };
  }, LINES);

type Snap = Awaited<ReturnType<typeof snapshot>>;

const fmt = (v: number | undefined) =>
  v === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);

/** Shift rules against the unshifted tenkan/kijun (tenkan has a point on every bar from `conversion − 1`). */
function checkShift(s: Snap, d: number) {
  const { conversion, base, spanB } = s.params!;
  const n = s.state.barCount;
  const tenkan = s.series.tenkan.items;
  const kijun = s.series.kijun.items;
  expect(tenkan.length).toBe(n - (conversion - 1));
  const barTime = (i: number) => tenkan[i - (conversion - 1)].time;
  const at = (pts: Pt[], t: number) => pts.find((p) => p.time === t)?.value;

  const lagging = s.series.lagging.items;
  expect(lagging.at(-1)!.time).toBe(barTime(n - d));
  expect(lagging.length).toBe(n - (d - 1));

  const leadA = s.series.leadA.items;
  const leadB = s.series.leadB.items;
  const firstA = Math.max(conversion, base) - 1 + d - 1;
  const firstB = spanB - 1 + d - 1;
  expect(leadA[0].time).toBe(barTime(firstA));
  expect(leadB[0].time).toBe(barTime(firstB));
  expect(leadA.at(-1)!.time).toBe(barTime(n - 1));
  for (const i of [firstA, n - 1]) {
    const src = barTime(i - (d - 1));
    expect(at(leadA, barTime(i))).toBeCloseTo((at(tenkan, src)! + at(kijun, src)!) / 2, 6);
  }

  const c = s.cloud!;
  expect(c.futureBars).toBe(d - 1);
  expect(c.to).toBe(n - 1 + d - 1);
  expect(c.from).toBe(Math.max(firstA, firstB));
  expect(c.future.map((f) => f.logical)).toEqual(Array.from({ length: d - 1 }, (_, i) => n + i));
  expect(c.futureLines).toEqual({ a: d, b: d });
  for (const l of LINES) expect(s.series[l].chart).toEqual(s.series[l].items);
}

/** RGBA of the chart at a pane point, from the first canvas that is opaque there. */
async function pixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const chart = document.querySelector('[data-testid="chart"]')!;
      const box = chart.getBoundingClientRect();
      for (const canvas of chart.querySelectorAll('canvas')) {
        const r = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        const cx = box.left + px;
        const cy = box.top + py;
        if (!ctx || r.width === 0 || cx < r.left || cx >= r.right || cy < r.top || cy >= r.bottom)
          continue;
        const sx = Math.floor(((cx - r.left) * canvas.width) / r.width);
        const sy = Math.floor(((cy - r.top) * canvas.height) / r.height);
        const [red, g, b, a] = ctx.getImageData(sx, sy, 1, 1).data;
        if (a > 200) return [red, g, b];
      }
      return null;
    },
    [x, y],
  );
}

/** Middle of the widest future cloud bar, in pane px, and its side. */
async function futureProbe(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as W).__catpivex;
    const c = h.ichimokuClouds()[0];
    const s = [...c.future].sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b))[0];
    const ya = h.priceToY(s.a)!;
    const yb = h.priceToY(s.b)!;
    return {
      x: h.xForLogical(s.logical)!,
      y: (ya + yb) / 2,
      gap: Math.abs(ya - yb),
      up: s.a >= s.b,
    };
  });
}

test('I6 Ichimoku: five lines, shifted leads/lagging, cloud into the future, settings, hide', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openApp(page);
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
  await addIndicators(page, ['ichimoku']);
  await expect
    .poll(async () => (await snapshot(page)).series.leadB.items.length)
    .toBeGreaterThan(0);

  const s = await snapshot(page);
  expect(s.params).toEqual({
    conversion: 9,
    base: 26,
    spanB: 52,
    displacement: 26,
  });
  checkShift(s, 26);
  const c = s.cloud!;
  expect(c.segments.some((g) => g.up)).toBe(true);
  expect(c.segments.some((g) => !g.up)).toBe(true);
  for (const g of c.segments)
    expect(g.fill).toBe(g.up ? 'rgba(165, 214, 167, 0.25)' : 'rgba(239, 154, 154, 0.25)');

  const row = page.locator(`[data-testid="legend-row"][data-ind-id="${s.id}"]`);
  await expect(row).toContainText('Ichimoku 9 26 52 26');
  const value = (line: string) => row.locator(`[data-testid="legend-value"][data-line="${line}"]`);
  for (const l of LINES) await expect(value(l)).toHaveCount(1);
  const box = (await page.getByTestId('chart').boundingBox())!;
  await page.mouse.move(box.x + box.width + 50, box.y + 10);
  await expect(value('lagging')).toHaveText('—');

  // Hover a bar 40 back: every line has a value there; the legend shows the shifted ones.
  const t = s.series.tenkan.items.at(-40)!.time;
  const x = await page.evaluate((time) => (window as unknown as W).__catpivex.xForTime(time), t);
  await page.mouse.move(box.x + x!, box.y + box.height * 0.4);
  const at = (l: (typeof LINES)[number]) => s.series[l].items.find((p) => p.time === t)?.value;
  for (const l of ['lagging', 'leadA', 'leadB'] as const) {
    expect(at(l)).toBeDefined();
    await expect(value(l)).toHaveText(fmt(at(l)));
  }

  // Drag the chart left to show the space right of the last candle.
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width + 50, box.y + 10);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = (window as unknown as W).__catpivex;
        return h.xForLogical(h.ichimokuClouds()[0].to!);
      }),
    )
    .toBeLessThan(box.width - 120);
  const probe = await futureProbe(page);
  expect(probe.gap).toBeGreaterThan(4);
  // Fill over the background #131722: green > red on the up side, red > green on the down side.
  const score = async (dx: number) => {
    const px = await pixel(page, probe.x + dx, probe.y);
    return px ? (probe.up ? px[1] - px[0] : px[0] - px[1]) : -1;
  };
  await expect
    .poll(async () => Math.max(await score(-2), await score(0), await score(2)))
    .toBeGreaterThan(8);
  await page.getByTestId('chart').screenshot({ path: test.info().outputPath('p10-ichimoku.png') });

  // Realtime ticks keep the chart equal to the fed data and the cloud on the last bar.
  const first = s.state.lastBar!;
  await expect
    .poll(
      async () => {
        const b = (await snapshot(page)).state.lastBar!;
        return b.time !== first.time || b.close !== first.close;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  checkShift(await snapshot(page), 26);

  await row.hover();
  await row.getByTestId('legend-settings').click();
  const item = page
    .getByTestId('indicator-panel')
    .locator(`[data-testid="ind-instance"][data-ind-id="${s.id}"]`);
  await item.getByTestId('ind-param-displacement').fill('10');
  await item.getByTestId('ind-color-leadB').fill('#2962ff');
  await page.keyboard.press('Escape');
  await expect(row).toContainText('Ichimoku 9 26 52 10');
  await expect.poll(async () => (await snapshot(page)).cloud?.futureBars).toBe(9);
  const moved = await snapshot(page);
  checkShift(moved, 10);
  for (const g of moved.cloud!.segments)
    expect(g.fill).toBe(g.up ? 'rgba(165, 214, 167, 0.25)' : 'rgba(41, 98, 255, 0.25)');

  await row.hover();
  await row.getByTestId('legend-toggle').click();
  await expect(row).toHaveAttribute('data-hidden', 'true');
  await expect.poll(async () => (await snapshot(page)).clouds).toBe(0);
  await row.getByTestId('legend-toggle').click();
  await expect.poll(async () => (await snapshot(page)).cloud?.futureBars).toBe(9);
});

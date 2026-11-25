import { expect, test, type Page } from './fixtures';
import { addIndicators, openApp, waitLoaded } from './phase3-helpers';

type Pt = { time: number; value?: number; color?: string };
type Ind = {
  id: string;
  type: string;
  lines: Record<string, { count: number; last: { time: number; value: number } | null }>;
};
type W = {
  __catpivex: {
    state(): { lastBar: { time: number; close: number } | null };
    indicators(): Ind[];
    indicatorSeries(id: string, line: string): { chart: Pt[]; items: Pt[] };
    paneCount(): number;
  };
};

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as W).__catpivex;
    const inds = h.indicators();
    const st = inds.find((i) => i.type === 'supertrend');
    return {
      inds,
      lastBar: h.state().lastBar,
      paneCount: h.paneCount(),
      up: st ? h.indicatorSeries(st.id, 'up') : { chart: [], items: [] },
      down: st ? h.indicatorSeries(st.id, 'down') : { chart: [], items: [] },
    };
  });

const valued = (pts: Pt[]) => pts.filter((p) => p.value !== undefined);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.getByTestId('tf-1h').click();
  await waitLoaded(page, '1h');
});

test('T7.2a ATR gets its own sub pane with a positive last value', async ({ page }) => {
  const before = (await snapshot(page)).paneCount;
  await addIndicators(page, ['atr', 'supertrend']);
  await expect
    .poll(async () => (await snapshot(page)).inds.find((i) => i.type === 'atr')?.lines.value.count)
    .toBeGreaterThan(400);
  const s = await snapshot(page);
  expect(s.paneCount).toBe(before + 1);
  expect(s.inds.find((i) => i.type === 'atr')!.lines.value.last!.value).toBeGreaterThan(0);
});

test('T7.2b Supertrend: last close is on the right side; the chart breaks the line at a flip', async ({
  page,
}) => {
  await addIndicators(page, ['supertrend']);
  await expect
    .poll(async () => {
      const st = (await snapshot(page)).inds[0];
      return (st?.lines.up.count ?? 0) + (st?.lines.down.count ?? 0);
    })
    .toBeGreaterThan(400);
  const s = await snapshot(page);
  const { up, down } = s.inds[0]!.lines;
  const bar = s.lastBar!;
  if (up.last?.time === bar.time) expect(bar.close).toBeGreaterThanOrEqual(up.last.value);
  else {
    expect(down.last?.time).toBe(bar.time);
    expect(bar.close).toBeLessThanOrEqual(down.last!.value);
  }

  // The chart holds exactly the fed points incl. colours (its data() drops whitespace); whitespace
  // is not counted as points and sits where the other line has a value.
  expect(s.up.chart).toEqual(valued(s.up.items));
  expect(s.down.chart).toEqual(valued(s.down.items));
  expect(s.up.chart.length).toBe(up.count);
  expect(s.down.chart.length).toBe(down.count);
  const items = s.up.items;
  const downAt = new Map(s.down.items.map((p) => [p.time, p.value]));
  const flips = items.flatMap((p, i) =>
    i > 0 && p.value === undefined && items[i - 1].value !== undefined ? [i] : [],
  );
  expect(flips.length).toBeGreaterThan(0);
  for (const i of flips) {
    expect(downAt.get(items[i].time)).toBeDefined();
    // Lightweight Charts joins across whitespace; the break is the transparent last segment.
    expect(items[i - 1].color).toBe('transparent');
  }
  expect(s.down.items.some((p) => p.value === undefined)).toBe(true);
  const colored = s.up.chart.filter((p) => p.color === 'transparent').length;
  expect(colored).toBe(flips.length);
});

test('T7.2c Supertrend realtime ticks keep the chart equal to the fed data', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Indicator')) errors.push(m.text());
  });
  await addIndicators(page, ['supertrend']);
  await expect.poll(async () => (await snapshot(page)).up.chart.length).toBeGreaterThan(0);
  const first = (await snapshot(page)).lastBar!;
  await expect
    .poll(async () => {
      const b = (await snapshot(page)).lastBar!;
      return b.time !== first.time || b.close !== first.close;
    }, { timeout: 20_000 })
    .toBe(true);
  const s = await snapshot(page);
  expect(s.up.chart).toEqual(valued(s.up.items));
  expect(s.down.chart).toEqual(valued(s.down.items));
  expect(errors).toEqual([]);
});

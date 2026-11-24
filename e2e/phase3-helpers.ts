import { expect, type Page } from '@playwright/test';

// Dev-only hook (see frontend/src/debug.d.ts).
export type Hook = {
  state(): { symbol: string; interval: string; barCount: number; loading: boolean };
  indicators(): {
    id: string;
    type: string;
    params: Record<string, number>;
    lines: Record<
      string,
      { count: number; last: { time: number; value: number } | null; width?: number }
    >;
  }[];
  xForTime(time: number): number | null;
  paneCount(): number;
};
export const hook = <T>(page: Page, fn: (h: Hook) => T) =>
  page.evaluate(`(${fn.toString()})(window.__catpivex)`) as Promise<T>;

export async function waitLoaded(page: Page, interval: string) {
  await expect
    .poll(
      // Not hook(): it stringifies fn, so a closure over `interval` would be lost.
      () =>
        page.evaluate((iv) => {
          const s = (window as unknown as { __catpivex: Hook }).__catpivex.state();
          return s.interval === iv && !s.loading && s.barCount > 0;
        }, interval),
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
}

export async function addIndicators(page: Page, types: string[]) {
  await page.getByTestId('indicators-button').click();
  for (const t of types) await page.getByTestId(`ind-add-${t}`).click();
  await page.keyboard.press('Escape');
  // No blind 'click outside': x=5 now lands on the drawing toolbar.
  await expect(page.getByTestId('indicator-panel')).toHaveCount(0);
}

export async function openApp(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__catpivex !== undefined);
  await waitLoaded(page, '1m');
}

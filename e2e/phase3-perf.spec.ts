import { expect, test } from '@playwright/test';
import { addIndicators, hook, openApp } from './phase3-helpers';

// Headed window: headless has no real compositor, so its frame rate means nothing.
test.use({ headless: false });

test('T3.5 SMA20 + BB + RSI + MACD on 1m realtime, dragging for 5s stays ≥ 50 fps', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await addIndicators(page, ['sma', 'bb', 'rsi', 'macd']);
  await expect.poll(() => hook(page, (h) => h.indicators().length)).toBe(4);

  const box = (await page.getByTestId('chart').boundingBox())!;
  const y = box.y + box.height * 0.3;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __counting: boolean };
    w.__frames = 0;
    w.__counting = true;
    const tick = () => {
      if (!w.__counting) return;
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  let dir = 1;
  let x = box.width * 0.5;
  while (Date.now() - t0 < 5_000) {
    x += dir * 12;
    if (x > box.width * 0.85 || x < box.width * 0.15) dir = -dir;
    await page.mouse.move(box.x + x, y);
  }
  await page.mouse.up();
  const seconds = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __counting: boolean };
    w.__counting = false;
    return w.__frames;
  });
  const fps = frames / seconds;
  // A covered or unfocused window gets throttled rAF (seen once: 9.2 fps), which is not an app
  // problem, so the result line says whether the window was visible and focused.
  const win = await page.evaluate(() => `visibility=${document.visibilityState} focus=${document.hasFocus()}`);
  const result = `T3.5: ${frames} frames in ${seconds.toFixed(2)} s = ${fps.toFixed(1)} fps (${win})`;
  console.log(result);
  expect(fps, result).toBeGreaterThanOrEqual(50);
});

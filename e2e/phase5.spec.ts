import { E2E_API } from "../playwright.config";
import { expect, test, type Page } from "./fixtures";
import { openApp } from "./phase3-helpers";

type Alert = {
  id: number;
  symbol: string;
  price: number;
  enabled: boolean;
  drawing_id: string | null;
};
type W = {
  __notes: { title: string; body: string }[];
  __catpivex: {
    alerts(): { alerts: Alert[]; lastEventId: number | null };
    drawings(): {
      drawings: { id: string; type: string; price?: number }[];
      alertLines: string[];
    };
    priceToY(p: number): number | null;
  };
};
const BTC = "BINANCE:BTCUSDT";
const TEST = "TEST:E2E";

const alerts = async (page: Page) =>
  (await (await page.request.get(`${E2E_API}/api/alerts`)).json()) as Alert[];
const setPrice = (page: Page, price: number) =>
  page.request.put(`${E2E_API}/api/test/price`, {
    data: { symbol: TEST, price },
  });
const hook = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__catpivex.drawings());

test.beforeEach(async ({ page }) => {
  for (const a of await alerts(page))
    await page.request.delete(`${E2E_API}/api/alerts/${a.id}`);
  await page.request.delete(`${E2E_API}/api/drawings/${BTC}`);
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__notes = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = () => Promise.resolve("granted");
      constructor(title: string, opts?: { body?: string }) {
        w.__notes.push({ title, body: opts?.body ?? "" });
      }
    }
    (window as unknown as { Notification: unknown }).Notification =
      FakeNotification;
  });
  await openApp(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as W).__catpivex.alerts().lastEventId,
      ),
    )
    .not.toBeNull();
});

test("T5.6a a wick through the level triggers within 60 s: browser notification, once-alert disabled, history row", async ({
  page,
}) => {
  test.setTimeout(90_000);
  expect((await setPrice(page, 100)).status()).toBe(204);

  await page.getByTestId("alerts-button").click();
  await page.getByTestId("alert-new").click();
  await page.getByTestId("alert-symbol").fill(TEST);
  await page.getByTestId("alert-condition").selectOption("crosses_above");
  await page.getByTestId("alert-price").fill("105");
  await page.getByTestId("alert-submit").click();
  await expect(
    page.locator(`[data-testid="alert-row"][data-symbol="${TEST}"]`),
  ).toHaveCount(1);

  await page.waitForTimeout(3000); // let a check pass with the price still below
  expect((await alerts(page))[0]!.enabled).toBe(true);
  const t0 = Date.now();
  await setPrice(page, 106);
  await setPrice(page, 101); // back below: only the bar's high touched 105

  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__notes), {
      timeout: 60_000,
    })
    .toHaveLength(1);
  console.log(
    `T5.6a notified after ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  const note = (
    await page.evaluate(() => (window as unknown as W).__notes)
  )[0]!;
  expect(note.title).toBe(TEST);
  expect(note.body).toContain("crossed above 105");
  expect((await alerts(page))[0]!.enabled).toBe(false);

  await page.getByTestId("alerts-tab-history").click();
  const row = page.getByTestId("alert-event-row").first();
  await expect(row.getByTestId("alert-event-symbol")).toHaveText(TEST);
  await expect(row.getByTestId("alert-event-level")).toContainText("105");
});

test("T5.6b alert from a horizontal line follows the line and goes away with it", async ({
  page,
}) => {
  const box = (await page.getByTestId("chart").boundingBox())!;
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.4;
  await page.keyboard.press("Alt+H");
  await page.mouse.click(x, y);
  await expect.poll(async () => (await hook(page)).drawings.length).toBe(1);
  const line = (await hook(page)).drawings[0]!;

  await page.mouse.click(x, y, { button: "right" });
  await page.getByTestId("menu-add-alert").click();
  await expect.poll(async () => (await alerts(page)).length).toBe(1);
  const created = (await alerts(page))[0]!;
  expect(created.drawing_id).toBe(line.id);
  expect(created.price).toBe(line.price);
  await expect
    .poll(async () => (await hook(page)).alertLines)
    .toEqual([line.id]);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 5 });
  await page.mouse.move(x, y + 60, { steps: 5 });
  await page.mouse.up();
  const moved = (await hook(page)).drawings[0]!.price!;
  expect(moved).not.toBe(line.price);
  await expect
    .poll(async () => (await alerts(page))[0]?.price, { timeout: 5000 })
    .toBe(moved);

  await page.mouse.click(x, y + 60);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await hook(page)).drawings.length).toBe(0);
  await expect
    .poll(async () => (await alerts(page)).length, { timeout: 5000 })
    .toBe(0);
});

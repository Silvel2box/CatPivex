import { test as base } from '@playwright/test';
import { E2E_API } from '../playwright.config';

export { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Every test starts from the default layout (BTC 1m, no indicators): the app restores the saved
 * layout on load, so one test's symbol/indicators would otherwise leak into the next.
 */
export const test = base.extend<{ resetLayout: void }>({
  resetLayout: [
    async ({ request }, use) => {
      const res = await request.put(`${E2E_API}/api/layout`, { data: { layout: {} } });
      if (!res.ok()) throw new Error(`layout reset failed: HTTP ${res.status()}`);
      await use();
    },
    { auto: true },
  ],
});

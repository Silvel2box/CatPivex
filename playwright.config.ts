import { defineConfig } from "@playwright/test";

// E2E runs its own servers on separate ports with a separate DB (backend/e2e.db), so it never
// touches a dev session you have open on 8000/5173 or your real watchlist. Data is real (Binance/Yahoo).
// Uses the installed Edge, no browser download.
const API_PORT = process.env.CATPIVEX_E2E_API_PORT ?? "8100";
const WEB_PORT = process.env.CATPIVEX_E2E_WEB_PORT ?? "5180";
export const E2E_API = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "msedge",
    viewport: { width: 1400, height: 800 },
  },
  webServer: [
    {
      command: `cd backend && .venv\\Scripts\\python -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      url: `${E2E_API}/api/health`,
      env: {
        CATPIVEX_DB_PATH: "e2e.db",
        CATPIVEX_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        CATPIVEX_TEST_FEED: "1",
        CATPIVEX_ALERT_INTERVAL_S: "2",
        // Never send real Telegram/LINE messages from e2e, even if backend/.env has tokens.
        TELEGRAM_BOT_TOKEN: "",
        LINE_CHANNEL_TOKEN: "",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `cd frontend && npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_BASE: E2E_API },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

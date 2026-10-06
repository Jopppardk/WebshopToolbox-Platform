// Portal smoke test: runs the customer portal in Chromium against a local server with fixture data.
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/portal',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8791',
    viewport: { width: 1366, height: 900 },
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
  },
  // PORTAL_BROWSER=msedge (or chrome) uses an installed browser instead of Playwright's own Chromium.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        ...(process.env.PORTAL_BROWSER
          ? { channel: process.env.PORTAL_BROWSER }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'node scripts/portal-smoke-server.mjs',
    url: 'http://127.0.0.1:8791/login',
    timeout: 180000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

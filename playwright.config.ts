import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke test: real server + real client in headless Chromium.
 * Run with `pnpm e2e`. Set PW_CHROMIUM_PATH to use a pre-installed browser.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @eyespy/server build && PORT=2567 node packages/server/dist/index.js',
      url: 'http://localhost:2567/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @eyespy/client exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

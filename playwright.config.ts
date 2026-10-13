import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build: the game server serves the built
 * client on one port, exactly as deployed. Run with `pnpm e2e`. Set PW_CHROMIUM_PATH to
 * use a pre-installed browser. VITE_E2E=1 enables the read-only `window.__raterobbers`
 * state hook in the client bundle.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:2567',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command:
      'VITE_E2E=1 pnpm --filter @raterobbers/client build && pnpm --filter @raterobbers/server build && PORT=2567 node packages/server/dist/index.js',
    url: 'http://localhost:2567/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

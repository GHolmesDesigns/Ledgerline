import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.LEDGERLINE_TEST_API_PORT ?? '4174';
const webPort = process.env.LEDGERLINE_TEST_WEB_PORT ?? '5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${webPort}` },
  webServer: [
    {
      command: 'npm run dev --workspace @ledgerline/api',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { API_PORT: apiPort },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev --workspace @ledgerline/web -- --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      env: { API_PORT: apiPort },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

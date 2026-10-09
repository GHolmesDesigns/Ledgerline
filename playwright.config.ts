import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test servers use their own ports, database, and settings file, so a test run never reaches
// the app on 4174/5173, the real database, or a saved provider key.
const apiPort = process.env.LEDGERLINE_TEST_API_PORT ?? '4175';
const webPort = process.env.LEDGERLINE_TEST_WEB_PORT ?? '5174';
const apiDataDirectory = join(tmpdir(), `ledgerline-e2e-api-${apiPort}`);

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
      env: {
        API_PORT: apiPort,
        LEDGERLINE_DATA_PATH: join(apiDataDirectory, 'ledgerline.sqlite'),
        LEDGERLINE_CONFIG_PATH: join(apiDataDirectory, '.env'),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev --workspace @ledgerline/web -- --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      env: { API_PORT: apiPort },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

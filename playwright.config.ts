import {defineConfig} from '@playwright/test';

const configuredPort = process.env.STRUIINFO_E2E_PORT ?? '41731';
if (!/^\d{1,5}$/u.test(configuredPort)) {
  throw new Error('STRUIINFO_E2E_PORT must be a numeric TCP port.');
}
const liveBaseUrl = `http://127.0.0.1:${configuredPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: {timeout: 5_000},
  outputDir: 'test-results/playwright',
  reporter: [['list']],
  use: {
    baseURL: liveBaseUrl,
    browserName: 'chromium',
    channel: process.env.STRUIINFO_BROWSER_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${configuredPort} --strictPort`,
    url: liveBaseUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

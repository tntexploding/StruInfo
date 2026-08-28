import {defineConfig} from '@playwright/test';

const configuredPort = process.env.STRUIINFO_E2E_PORT ?? '4173';
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
    channel: 'chrome',
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    {
      name: 'm1c-product-shell',
      testMatch: '**/m1c-product-workspaces.spec.ts',
      use: {baseURL: liveBaseUrl},
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${configuredPort} --strictPort`,
    url: liveBaseUrl,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

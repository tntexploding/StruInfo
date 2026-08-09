import {defineConfig} from '@playwright/test';

const liveBaseUrl = 'http://127.0.0.1:4173';
const mockBaseUrl = 'http://127.0.0.1:4174';

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
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    {
      name: 'live-runtime',
      testMatch: '**/operational-health-shell.spec.ts',
      use: {baseURL: liveBaseUrl},
    },
    {
      name: 'mock-runtime',
      testMatch: '**/operational-health-mock.spec.ts',
      use: {baseURL: mockBaseUrl},
    },
  ],
  webServer: [
    {
      command:
        'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4173 --strictPort',
      env: {
        VITE_STRUIINFO_API_BASE_URL:
          'http://127.0.0.1:4173/__struinfo-e2e-api/',
      },
      url: liveBaseUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command:
        'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4174 --strictPort',
      env: {VITE_STRUIINFO_API_BASE_URL: ''},
      url: mockBaseUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});

import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'apps/**', 'packages/**'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    isolate: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    sequence: {
      shuffle: {files: true, tests: true},
      seed: 1_397_980_757,
    },
  },
});

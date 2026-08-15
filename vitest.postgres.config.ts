import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/postgres/**/*.tm2.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    isolate: true,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: {
      shuffle: false,
      seed: 1_397_980_757,
    },
  },
});

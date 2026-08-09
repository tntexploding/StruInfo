import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/**/src/**/*.test.{ts,tsx}',
      'packages/**/src/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: false,
    sequence: {concurrent: false},
  },
});

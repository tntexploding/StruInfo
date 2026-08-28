import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typeScriptFiles = ['**/*.ts', '**/*.tsx'];
const firstPartySourceFiles = [
  'apps/*/src/**/*.ts',
  'apps/*/src/**/*.tsx',
  'packages/*/src/**/*.ts',
  'packages/*/src/**/*.tsx',
];

export default tseslint.config(
  {
    ignores: [
      '.agents/**',
      '.pnpm-store/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.cache/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'docs/dependencies/licenses/**',
      'docs/dependencies/sbom/**',
      'apps/server/test_support/postgres_tm2/**',
      'tests/postgres/**',
      'vitest.postgres.config.ts',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      sourceType: 'module',
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.tools.json',
          './tsconfig.tests.json',
          './apps/server/tsconfig.json',
          './apps/web/tsconfig.json',
          './packages/contracts/tsconfig.json',
          './packages/test_support/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {fixStyle: 'inline-type-imports'},
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      'no-var': 'error',
    },
  },
  {
    files: firstPartySourceFiles,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'First-party application modules use named exports.',
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'apps/**',
                '**/apps/**',
                '@struinfo/server',
                '@struinfo/web',
              ],
              message: 'Shared packages must not import application packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/**/*.ts'],
    languageOptions: {globals: globals.node},
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/web/**', '**/apps/web/**', '@struinfo/web'],
              message: 'Server code must not import web application code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    languageOptions: {globals: globals.browser},
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'apps/server/**',
                '**/apps/server/**',
                '@struinfo/server',
              ],
              message: 'Web code must not import server internals.',
            },
          ],
        },
      ],
    },
  },
);

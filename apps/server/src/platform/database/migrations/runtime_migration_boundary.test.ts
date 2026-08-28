import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {parseRuntimeConfig} from '../../../config/runtime_config.js';
import {DATABASE_READINESS_SQL} from '../../../database/database_readiness.js';
import {createPgBossOptions} from '../../../queue/pg_boss_runtime.js';
import type {PostgresPoolBoundary} from '../postgresql/postgres_pool.js';

const SYNTHETIC_POOL: PostgresPoolBoundary = {
  query: () => Promise.resolve({rows: [], rowCount: 0}),
  connect: () => Promise.reject(new Error('unexpected acquisition')),
  end: () => Promise.resolve(),
};

const RUNTIME_SOURCE_URLS = [
  new URL('../../../entrypoints/api.ts', import.meta.url),
  new URL('../../../entrypoints/scheduler.ts', import.meta.url),
  new URL('../../../entrypoints/worker.ts', import.meta.url),
  new URL('../../../entrypoints/all.ts', import.meta.url),
  new URL('../../../composition/run_process.ts', import.meta.url),
  new URL('../../../composition/start_role_runtime.ts', import.meta.url),
];

describe('ordinary runtime migration boundary', () => {
  it('does not import or invoke the migration runner from ordinary roles', async () => {
    const sourceFiles = await Promise.all(
      RUNTIME_SOURCE_URLS.map((url) =>
        readFile(fileURLToPath(url), {encoding: 'utf8'}),
      ),
    );

    for (const source of sourceFiles) {
      expect(source).not.toContain('platform/database/migrations');
      expect(source).not.toContain('entrypoints/migrate');
      expect(source).not.toContain('runMigrationProcess');
      expect(source).not.toContain('executeMigrations');
    }
  });

  it('keeps runtime SQL read-only and pg-boss automatic DDL disabled', () => {
    const databaseUrl =
      'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo';
    const options = createPgBossOptions(
      parseRuntimeConfig('worker', {
        DATABASE_URL: databaseUrl,
        STRUIINFO_DATA_ROOT: join(tmpdir(), 'struinfo-synthetic-data'),
        STRUIINFO_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
      }),
      SYNTHETIC_POOL,
    );

    expect(DATABASE_READINESS_SQL).toBe('SELECT 1 AS ready');
    expect(DATABASE_READINESS_SQL).not.toMatch(
      /\b(?:ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/iu,
    );
    expect(options.migrate).toBe(false);
    expect(options.createSchema).toBe(false);
  });
});

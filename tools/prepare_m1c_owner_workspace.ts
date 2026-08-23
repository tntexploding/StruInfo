import {createHash} from 'node:crypto';
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import {loadRuntimeConfig} from '../apps/server/src/config/external_runtime_config.js';
import {
  importMarkdownEvidence,
  type ImportMarkdownEvidenceResult,
} from '../apps/server/src/modules/evidence/index.js';
import {parseMigrationConfig} from '../apps/server/src/platform/database/migrations/migration_config.js';
import {NodeMigrationFileSystem} from '../apps/server/src/platform/database/migrations/migration_files.js';
import type {MigrationLogger} from '../apps/server/src/platform/database/migrations/migration_log.js';
import {executeMigrations} from '../apps/server/src/platform/database/migrations/migration_runner.js';
import {PgMigrationConnector} from '../apps/server/src/platform/database/migrations/postgres_migration_connection.js';
import {
  createNodePostgresPool,
  createPostgresKnowledgeRepositories,
  type PostgresKnowledgeRepositorySet,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {createLocalStorageServices} from '../apps/server/src/platform/storage/local_storage_services.js';
import {M1cWorkspaceTransfer} from '../apps/server/src/workspace_transfer/m1c_workspace_transfer.js';

const SOURCE_ROOT_VARIABLE = 'STRUIINFO_OWNER_SOURCE_ROOT';
const CONFIG_DIRECTORY_VARIABLE = 'STRUIINFO_OWNER_CONFIG_DIRECTORY';
const DATA_ROOT_VARIABLE = 'STRUIINFO_OWNER_DATA_ROOT';
const WORKSPACE_ID_VARIABLE = 'STRUIINFO_OWNER_WORKSPACE_ID';
const HTTP_PORT_VARIABLE = 'STRUIINFO_OWNER_HTTP_PORT';
const REPLACE_RUNTIME_CONFIG_VARIABLE =
  'STRUIINFO_OWNER_REPLACE_RUNTIME_CONFIG';
const FIXED_COMMIT = 'cf5e367d98e5141fb3381816f2ac8c5dd1bdb69f';
const CAPTURED_AT = '2026-08-16T00:00:00Z';
const EXPECTED_FRAGMENT_COUNT = 2_639;
const EXPECTED_INTAKE_UNIT_COUNT = 345;

const FIXED_ISSUES = Object.freeze([
  [
    398,
    20_053,
    'bb31bb9bc19c6bd3d195cece035e63fb3af168e0eb62cfd41e981e1f67429e95',
  ],
  [
    399,
    21_679,
    '145ef6ae68c0edf2fbd342f6911cca681997dfde57b77ee31cd9a6960cb03bf0',
  ],
  [
    400,
    18_192,
    '39ba0aea31e978829308c5a5d8fd366c6cf33bb3f3f67ea8e6a68b27d3226016',
  ],
  [
    401,
    21_224,
    '824985b55c3d701250aa37a153f131853e2f4b151fc1e1372818223ef0abf9cb',
  ],
  [
    402,
    21_265,
    '2ad16322f4d976c1fa7ea6b7056e16ac999d922f38eaa1db6c1e1a93df00a821',
  ],
  [
    403,
    19_593,
    'a600a1347a89410e636a3c6124533affe779b7f0f92c28af5cd990f651929630',
  ],
  [
    404,
    20_106,
    'b6fb82f79db8ae259d089dae0b4a452f7ab008642aef6ef07c4c51391af8ba7e',
  ],
  [
    405,
    19_432,
    'f85743906806dabd1ebcfcd5ba8c9ea084bd9bd5a01f5c89ca13b40618d0ef0e',
  ],
  [
    406,
    21_244,
    'b6b19107c466c8740f903d482e98bae90fcd6ec70592cd62ff4e6752ee3ef528',
  ],
  [
    407,
    19_014,
    'c0bfbbb259b1894bbd6f631522d1a16679fa011dac573cb208650cefe89ea28a',
  ],
] as const);

interface FixedSource {
  readonly issue: number;
  readonly bytes: Uint8Array;
}

async function main(): Promise<void> {
  const sourceRoot = required(SOURCE_ROOT_VARIABLE);
  const configDirectory = resolve(required(CONFIG_DIRECTORY_VARIABLE));
  const dataRoot = resolve(required(DATA_ROOT_VARIABLE));
  const workspaceId = required(WORKSPACE_ID_VARIABLE);
  const httpPort = optionalPort(process.env[HTTP_PORT_VARIABLE]);
  const databaseUrl = required('DATABASE_URL');
  const migrationDatabaseUrl = required('STRUIINFO_MIGRATION_DATABASE_URL');

  await Promise.all([
    mkdir(configDirectory, {recursive: true}),
    mkdir(dataRoot, {recursive: true}),
  ]);
  const configPath = join(configDirectory, 'runtime.env');
  const secretPath = join(configDirectory, 'database.env');
  await writeIdempotently(
    configPath,
    `STRUIINFO_DATA_ROOT=${JSON.stringify(dataRoot)}\n` +
      `STRUIINFO_WORKSPACE_ID=${workspaceId}\n` +
      'STRUIINFO_HOST=127.0.0.1\n' +
      `STRUIINFO_PORT=${String(httpPort)}\n` +
      'STRUIINFO_LOG_LEVEL=info\n',
    {replace: process.env[REPLACE_RUNTIME_CONFIG_VARIABLE] === '1'},
  );
  await writeIdempotently(
    secretPath,
    `DATABASE_URL=${JSON.stringify(databaseUrl)}\n` +
      `STRUIINFO_MIGRATION_DATABASE_URL=${JSON.stringify(migrationDatabaseUrl)}\n`,
  );
  await chmod(secretPath, 0o600);

  const config = loadRuntimeConfig('api', {
    DATABASE_URL: databaseUrl,
    STRUIINFO_CONFIG_PATH: configPath,
  });
  const migrations = await migrate(migrationDatabaseUrl);
  const sources = await readFixedSources(sourceRoot);
  const storage = await createLocalStorageServices(config.dataRoot);
  const pool = createNodePostgresPool(config.database);
  try {
    const repositories = createPostgresKnowledgeRepositories(pool);
    const hydration = await hydrateSources(
      repositories,
      storage.blobStore,
      sources,
      workspaceId,
    );
    const counts = await readCounts(pool);
    assertEqual(counts.snapshots, 10, 'Snapshot count');
    assertEqual(counts.fragments, EXPECTED_FRAGMENT_COUNT, 'Fragment count');
    const transfer = new M1cWorkspaceTransfer({
      repository: repositories.workspaceTransfer,
      blobStore: storage.blobStore,
      fileStore: storage.workspaceBundleFiles,
      reviewPreferences: storage.reviewPreferences,
    });
    const bundle = await transfer.exportWorkspace(workspaceId);
    process.stdout.write(
      `${JSON.stringify({
        event: 'm1c_owner_workspace_prepared',
        workspaceId,
        configPath,
        secretPath,
        dataRoot: config.dataRoot,
        sources: sources.length,
        created: hydration.created,
        existing: hydration.existing,
        fragments: hydration.fragments,
        intakeUnits: hydration.intakeUnits,
        snapshots: counts.snapshots,
        migrations: counts.migrations,
        newlyAppliedMigrations: migrations,
        bundleFile: bundle.fileName,
        bundleBytes: bundle.byteLength,
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

async function migrate(databaseUrl: string): Promise<readonly string[]> {
  const logger: MigrationLogger = {write: () => undefined};
  const result = await executeMigrations({
    config: parseMigrationConfig({
      STRUIINFO_MIGRATION_DATABASE_URL: databaseUrl,
    }),
    migrationRoots: [resolve('apps/server/migrations')],
    fileSystem: new NodeMigrationFileSystem(),
    connector: new PgMigrationConnector(),
    logger,
  });
  return result.appliedVersions;
}

async function readFixedSources(root: string): Promise<readonly FixedSource[]> {
  const sources: FixedSource[] = [];
  for (const [issue, expectedBytes, expectedSha256] of FIXED_ISSUES) {
    const bytes = Uint8Array.from(
      await readFile(resolve(root, `issue-${issue.toString()}.md`)),
    );
    assertEqual(
      bytes.byteLength,
      expectedBytes,
      `issue ${String(issue)} byte length`,
    );
    assertEqual(
      digest(bytes),
      expectedSha256,
      `issue ${String(issue)} SHA-256`,
    );
    sources.push(Object.freeze({issue, bytes}));
  }
  return Object.freeze(sources);
}

async function hydrateSources(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
  blobStore: Parameters<typeof importMarkdownEvidence>[0]['blobStore'],
  sources: readonly FixedSource[],
  workspaceId: string,
): Promise<
  Readonly<{
    created: number;
    existing: number;
    fragments: number;
    intakeUnits: number;
  }>
> {
  let created = 0;
  let existing = 0;
  let fragments = 0;
  let intakeUnits = 0;
  for (const source of sources) {
    const result = await importOne(
      repositories,
      blobStore,
      source,
      workspaceId,
    );
    if (result.status === 'created') created += 1;
    else if (result.status === 'existing') existing += 1;
    else throw new Error(`Issue ${source.issue.toString()} hydration failed.`);
    fragments += result.fragmentIds.length;
    intakeUnits += result.intakeTargetFragmentIds.length;
  }
  assertEqual(fragments, EXPECTED_FRAGMENT_COUNT, 'hydrated Fragment count');
  assertEqual(
    intakeUnits,
    EXPECTED_INTAKE_UNIT_COUNT,
    'hydrated intake unit count',
  );
  return Object.freeze({created, existing, fragments, intakeUnits});
}

function importOne(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
  blobStore: Parameters<typeof importMarkdownEvidence>[0]['blobStore'],
  source: FixedSource,
  workspaceId: string,
): Promise<ImportMarkdownEvidenceResult> {
  const suffix = source.issue.toString().padStart(12, '0');
  const issuePath = `docs/issue-${source.issue.toString()}.md`;
  const documentUri = `https://github.com/ruanyf/weekly/blob/${FIXED_COMMIT}/${issuePath}`;
  const resourceId = `10000000-0000-4000-8000-${suffix}`;
  const snapshotId = `20000000-0000-4000-8000-${suffix}`;
  return importMarkdownEvidence(
    {blobStore, evidenceRepository: repositories.evidence},
    {
      workspaceId,
      commandIdempotencyKey: `m1c-expand-import-${source.issue.toString()}`,
      resource: {
        workspaceId,
        resourceId,
        resourceKind: 'git_file',
        sourceKey: `git:github.com/ruanyf/weekly:${issuePath}`,
        canonicalUri: documentUri,
      },
      gitResource: {
        workspaceId,
        resourceId,
        canonicalRepositoryUri: 'https://github.com/ruanyf/weekly',
        repositoryRelativePath: issuePath,
      },
      snapshot: {
        workspaceId,
        snapshotId,
        resourceId,
        capturedAt: CAPTURED_AT,
        mediaType: 'text/markdown',
      },
      gitObservations: [
        {
          workspaceId,
          observationId: `30000000-0000-4000-8000-${suffix}`,
          resourceId,
          snapshotId,
          repositoryRef: 'refs/heads/master',
          commit: {algorithm: 'sha1', digest: FIXED_COMMIT},
          observedAt: CAPTURED_AT,
        },
      ],
      profile: 'ruanyf-weekly-v1',
      sourceUtf8: Uint8Array.from(source.bytes),
      documentBaseUri: documentUri,
    },
  );
}

async function readCounts(
  pool: PostgresPoolBoundary,
): Promise<
  Readonly<{migrations: number; snapshots: number; fragments: number}>
> {
  const result = await pool.query<{
    readonly migrations: string;
    readonly snapshots: string;
    readonly fragments: string;
  }>(
    'SELECT ' +
      '(SELECT count(*)::text FROM struinfo_meta.schema_migrations) AS migrations, ' +
      '(SELECT count(*)::text FROM struinfo.snapshot) AS snapshots, ' +
      '(SELECT count(*)::text FROM struinfo.fragment) AS fragments',
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new Error('Workspace count query returned no row.');
  return Object.freeze({
    migrations: Number(row.migrations),
    snapshots: Number(row.snapshots),
    fragments: Number(row.fragments),
  });
}

async function writeIdempotently(
  path: string,
  value: string,
  options: Readonly<{replace?: boolean}> = {},
): Promise<void> {
  try {
    const existing = await readFile(path, 'utf8');
    if (existing !== value) {
      if (options.replace === true) {
        await writeFile(path, value, {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600,
        });
        return;
      }
      throw new Error(
        'External owner configuration already exists with different content.',
      );
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      await writeFile(path, value, {encoding: 'utf8', flag: 'wx', mode: 0o600});
      return;
    }
    throw error;
  }
}

function optionalPort(value: string | undefined): number {
  const port = value === undefined ? 3_000 : Number(value);
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    String(port) !== (value ?? '3000')
  ) {
    throw new Error(
      `${HTTP_PORT_VARIABLE} must be an integer from 1 through 65535.`,
    );
  }
  return port;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is required.`);
  return value;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} did not match.`);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}

void main();

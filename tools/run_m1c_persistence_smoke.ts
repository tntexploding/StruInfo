import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {loadRuntimeConfig} from '../apps/server/src/config/external_runtime_config.js';
import {
  importMarkdownEvidence,
  type ImportMarkdownEvidenceInput,
} from '../apps/server/src/modules/evidence/index.js';
import {
  createNodePostgresPool,
  createPostgresKnowledgeRepositories,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {createLocalStorageServices} from '../apps/server/src/platform/storage/local_storage_services.js';
import type {BlobIdentity} from '../apps/server/src/storage/blob_store.js';

const DATABASE_VARIABLE = 'STRUIINFO_M1C_SMOKE_DATABASE_URL';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const OBSERVATION_ID = '55555555-5555-4555-8555-555555555555';
const COMMAND_KEY = 'm1c-synthetic-markdown-import-v1';

interface OpenWorkspace {
  readonly workspaceId: string;
  readonly pool: PostgresPoolBoundary;
  readonly blobStore: Awaited<
    ReturnType<typeof createLocalStorageServices>
  >['blobStore'];
}

async function main(): Promise<void> {
  const databaseUrl = process.env[DATABASE_VARIABLE];
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write(
      `${JSON.stringify({event: 'm1c_persistence_not_ready', variable: DATABASE_VARIABLE})}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const taskRoot = await mkdtemp(join(tmpdir(), 'struinfo-m1c-persist-'));
  const pools: PostgresPoolBoundary[] = [];
  try {
    const first = await openWorkspace(
      taskRoot,
      'a',
      WORKSPACE_A,
      databaseUrl,
      pools,
    );
    const second = await openWorkspace(
      taskRoot,
      'b',
      WORKSPACE_B,
      databaseUrl,
      pools,
    );
    const sourceA = markdownSource('Workspace A body.');
    const sourceB = markdownSource('Workspace B body.');

    const createdA = await importInto(first, sourceA);
    assertStatus(createdA.status, 'created', 'first workspace creation');
    const replayA = await importInto(first, sourceA);
    assertStatus(replayA.status, 'existing', 'first workspace replay');
    const conflictA = await importInto(
      first,
      markdownSource('Changed same-key body.'),
    );
    assertStatus(conflictA.status, 'conflict', 'changed same-key command');

    const createdB = await importInto(second, sourceB);
    assertStatus(createdB.status, 'created', 'second workspace creation');

    await verifyDatabase(first.pool, WORKSPACE_A, sourceA);
    await verifyDatabase(second.pool, WORKSPACE_B, sourceB);
    await verifyBlobIsolation(first, second, sourceA, sourceB);

    await first.pool.end();
    pools.splice(pools.indexOf(first.pool), 1);
    const reopened = await openWorkspace(
      taskRoot,
      'a',
      WORKSPACE_A,
      databaseUrl,
      pools,
    );
    const restartReplay = await importInto(reopened, sourceA);
    assertStatus(
      restartReplay.status,
      'existing',
      'restart-safe command replay',
    );
    await verifyDatabase(reopened.pool, WORKSPACE_A, sourceA);

    process.stdout.write(
      `${JSON.stringify({
        event: 'm1c_persistence_smoke_passed',
        workspaces: 2,
        snapshotsPerWorkspace: 1,
        commandsPerWorkspace: 1,
        restartReplay: 'existing',
        blobRootsIsolated: true,
      })}\n`,
    );
  } finally {
    for (const pool of pools.reverse()) {
      try {
        await pool.end();
      } catch {
        // Preserve the primary smoke result while still attempting all cleanup.
      }
    }
    await rm(taskRoot, {recursive: true, force: true});
  }
}

async function openWorkspace(
  taskRoot: string,
  name: string,
  workspaceId: string,
  databaseUrl: string,
  pools: PostgresPoolBoundary[],
): Promise<OpenWorkspace> {
  const configDirectory = join(taskRoot, `config-${name}`);
  const dataRoot = join(taskRoot, `data-${name}`);
  await mkdir(configDirectory, {recursive: true});
  await mkdir(dataRoot, {recursive: true});
  const configPath = join(configDirectory, 'runtime.env');
  await writeFile(
    configPath,
    `STRUIINFO_DATA_ROOT=${JSON.stringify(dataRoot.replaceAll('\\', '/'))}\n` +
      `STRUIINFO_WORKSPACE_ID=${workspaceId}\n`,
    {encoding: 'utf8'},
  );
  const config = loadRuntimeConfig('api', {
    DATABASE_URL: databaseUrl,
    STRUIINFO_CONFIG_PATH: configPath,
  });
  assertStatus(config.workspaceId, workspaceId, 'workspace selector');
  const pool = createNodePostgresPool(config.database);
  pools.push(pool);
  const storage = await createLocalStorageServices(config.dataRoot);
  return Object.freeze({
    workspaceId: config.workspaceId,
    pool,
    blobStore: storage.blobStore,
  });
}

function importInto(workspace: OpenWorkspace, source: string) {
  const repository = createPostgresKnowledgeRepositories(workspace.pool);
  return importMarkdownEvidence(
    {blobStore: workspace.blobStore, evidenceRepository: repository.evidence},
    importInput(workspace.workspaceId, source),
  );
}

function importInput(
  workspaceId: string,
  source: string,
): ImportMarkdownEvidenceInput {
  return {
    workspaceId,
    commandIdempotencyKey: COMMAND_KEY,
    resource: {
      workspaceId,
      resourceId: RESOURCE_ID,
      resourceKind: 'git_file',
      sourceKey: 'git:synthetic/weekly/issue.md',
      canonicalUri: 'https://example.invalid/synthetic/issue.md',
    },
    gitResource: {
      workspaceId,
      resourceId: RESOURCE_ID,
      canonicalRepositoryUri: 'https://example.invalid/synthetic/repository',
      repositoryRelativePath: 'docs/issue.md',
    },
    snapshot: {
      workspaceId,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      capturedAt: '2040-01-02T03:04:05Z',
      mediaType: 'text/markdown',
    },
    gitObservations: [
      {
        workspaceId,
        observationId: OBSERVATION_ID,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        repositoryRef: 'refs/heads/main',
        commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
        observedAt: '2040-01-02T03:04:05Z',
      },
    ],
    profile: 'ruanyf-weekly-v1',
    sourceUtf8: new TextEncoder().encode(source),
    documentBaseUri: 'https://example.invalid/synthetic/issue.md',
  };
}

async function verifyDatabase(
  pool: PostgresPoolBoundary,
  workspaceId: string,
  source: string,
): Promise<void> {
  const result = await pool.query<{
    command_count: number;
    fragment_count: number;
    raw_sha256: string;
    snapshot_count: number;
  }>(
    `SELECT
      (SELECT count(*)::integer FROM struinfo.evidence_capture_command
        WHERE workspace_id = $1) AS command_count,
      (SELECT count(*)::integer FROM struinfo.snapshot
        WHERE workspace_id = $1) AS snapshot_count,
      (SELECT count(*)::integer FROM struinfo.fragment
        WHERE workspace_id = $1) AS fragment_count,
      (SELECT raw_sha256 FROM struinfo.snapshot
        WHERE workspace_id = $1 AND snapshot_id = $2) AS raw_sha256`,
    [workspaceId, SNAPSHOT_ID],
  );
  const row = result.rows[0];
  if (
    row?.command_count !== 1 ||
    row.snapshot_count !== 1 ||
    row.fragment_count < 1 ||
    row.raw_sha256 !== digest(source)
  ) {
    throw new Error(
      'M1C database projection did not match the imported graph.',
    );
  }
}

async function verifyBlobIsolation(
  first: OpenWorkspace,
  second: OpenWorkspace,
  sourceA: string,
  sourceB: string,
): Promise<void> {
  const identityA = blobIdentity(sourceA);
  const identityB = blobIdentity(sourceB);
  const readA = await first.blobStore.read(identityA);
  const readB = await second.blobStore.read(identityB);
  assertStatus(new TextDecoder().decode(readA), sourceA, 'workspace A Blob');
  assertStatus(new TextDecoder().decode(readB), sourceB, 'workspace B Blob');
  await expectBlobAbsent(first, identityB);
  await expectBlobAbsent(second, identityA);
}

async function expectBlobAbsent(
  workspace: OpenWorkspace,
  identity: Readonly<BlobIdentity>,
): Promise<void> {
  try {
    await workspace.blobStore.read(identity);
  } catch {
    return;
  }
  throw new Error('A Blob leaked across external workspace data roots.');
}

function blobIdentity(source: string): Readonly<BlobIdentity> {
  const bytes = new TextEncoder().encode(source);
  return Object.freeze({
    algorithm: 'sha256' as const,
    digest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  });
}

function digest(source: string): string {
  return blobIdentity(source).digest;
}

function markdownSource(body: string): string {
  return `# Synthetic weekly\n\n## 工具\n\n1、Synthetic entry\n\n${body}\n\n![Diagram](https://example.invalid/image.png)\n`;
}

function assertStatus(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} did not produce the expected result.`);
  }
}

await main();

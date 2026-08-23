import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

import {
  executeApplyManualCuration,
  type ApplyManualCurationResult,
} from '../apps/server/src/modules/curation/index.js';
import {
  importMarkdownEvidence,
  type ImportMarkdownEvidenceResult,
} from '../apps/server/src/modules/evidence/index.js';
import {
  executeApplyManualKnowledgeChangeSet,
  executeDeterministicKnowledgeSearch,
  type ApplyManualKnowledgeChangeSetResult,
  type DeterministicKnowledgeSearchResult,
} from '../apps/server/src/modules/knowledge/index.js';
import {parseMigrationConfig} from '../apps/server/src/platform/database/migrations/migration_config.js';
import {NodeMigrationFileSystem} from '../apps/server/src/platform/database/migrations/migration_files.js';
import type {MigrationLogger} from '../apps/server/src/platform/database/migrations/migration_log.js';
import {executeMigrations} from '../apps/server/src/platform/database/migrations/migration_runner.js';
import {PgMigrationConnector} from '../apps/server/src/platform/database/migrations/postgres_migration_connection.js';
import {
  createNodePostgresPool,
  createPostgresKnowledgeRepositories,
  decodePostgresConnectionUrl,
  type PostgresPoolBoundary,
  type PostgresKnowledgeRepositorySet,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {createLocalStorageServices} from '../apps/server/src/platform/storage/local_storage_services.js';
import {M1cWorkspaceTransfer} from '../apps/server/src/workspace_transfer/m1c_workspace_transfer.js';

const SOURCE_ROOT_VARIABLE = 'STRUIINFO_M1C_EXPAND_SOURCE_ROOT';
const DATA_ROOT_VARIABLE = 'STRUIINFO_M1C_EXPAND_DATA_ROOT';
const SOURCE_DATABASE_VARIABLE = 'STRUIINFO_M1C_EXPAND_SOURCE_DATABASE_URL';
const RESTORE_DATABASE_VARIABLE = 'STRUIINFO_M1C_EXPAND_RESTORE_DATABASE_URL';
const SOURCE_MIGRATION_VARIABLE =
  'STRUIINFO_M1C_EXPAND_SOURCE_MIGRATION_DATABASE_URL';
const RESTORE_MIGRATION_VARIABLE =
  'STRUIINFO_M1C_EXPAND_RESTORE_MIGRATION_DATABASE_URL';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_A = '40000000-0000-4000-8000-000000000001';
const ITEM_B = '40000000-0000-4000-8000-000000000002';
const RELATION = '50000000-0000-4000-8000-000000000001';
const FIXED_COMMIT = 'cf5e367d98e5141fb3381816f2ac8c5dd1bdb69f';
const CAPTURED_AT = '2026-08-16T00:00:00Z';
const EXPORTED_AT = '2026-08-16T00:00:01.000Z';
const EXPECTED_FRAGMENT_COUNT = 2_639;
const EXPECTED_INTAKE_UNIT_COUNT = 345;

const FIXED_ISSUES = Object.freeze([
  Object.freeze({
    issue: 398,
    byteLength: 20_053,
    sha256: 'bb31bb9bc19c6bd3d195cece035e63fb3af168e0eb62cfd41e981e1f67429e95',
  }),
  Object.freeze({
    issue: 399,
    byteLength: 21_679,
    sha256: '145ef6ae68c0edf2fbd342f6911cca681997dfde57b77ee31cd9a6960cb03bf0',
  }),
  Object.freeze({
    issue: 400,
    byteLength: 18_192,
    sha256: '39ba0aea31e978829308c5a5d8fd366c6cf33bb3f3f67ea8e6a68b27d3226016',
  }),
  Object.freeze({
    issue: 401,
    byteLength: 21_224,
    sha256: '824985b55c3d701250aa37a153f131853e2f4b151fc1e1372818223ef0abf9cb',
  }),
  Object.freeze({
    issue: 402,
    byteLength: 21_265,
    sha256: '2ad16322f4d976c1fa7ea6b7056e16ac999d922f38eaa1db6c1e1a93df00a821',
  }),
  Object.freeze({
    issue: 403,
    byteLength: 19_593,
    sha256: 'a600a1347a89410e636a3c6124533affe779b7f0f92c28af5cd990f651929630',
  }),
  Object.freeze({
    issue: 404,
    byteLength: 20_106,
    sha256: 'b6fb82f79db8ae259d089dae0b4a452f7ab008642aef6ef07c4c51391af8ba7e',
  }),
  Object.freeze({
    issue: 405,
    byteLength: 19_432,
    sha256: 'f85743906806dabd1ebcfcd5ba8c9ea084bd9bd5a01f5c89ca13b40618d0ef0e',
  }),
  Object.freeze({
    issue: 406,
    byteLength: 21_244,
    sha256: 'b6b19107c466c8740f903d482e98bae90fcd6ec70592cd62ff4e6752ee3ef528',
  }),
  Object.freeze({
    issue: 407,
    byteLength: 19_014,
    sha256: 'c0bfbbb259b1894bbd6f631522d1a16679fa011dac573cb208650cefe89ea28a',
  }),
]);

interface FixedSource {
  readonly issue: number;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

async function main(): Promise<void> {
  const environment = requiredEnvironment();
  const sources = await readFixedSources(environment.sourceRoot);
  await migrate(environment.sourceMigrationUrl);
  await migrate(environment.restoreMigrationUrl);

  const sourcePool = createNodePostgresPool(
    decodePostgresConnectionUrl(environment.sourceDatabaseUrl, 'runtime'),
  );
  const restorePool = createNodePostgresPool(
    decodePostgresConnectionUrl(environment.restoreDatabaseUrl, 'runtime'),
  );
  try {
    const storage = await createLocalStorageServices(environment.dataRoot);
    const sourceRepositories = createPostgresKnowledgeRepositories(sourcePool);
    const restoreRepositories =
      createPostgresKnowledgeRepositories(restorePool);
    const fragmentIds = await importFixedSources(
      sourceRepositories,
      storage.blobStore,
      sources,
    );
    await verifyImport(sourcePool, sources);
    await verifyReviewQueueReadModel(sourceRepositories);
    await createRepresentativeDomainState(sourceRepositories, fragmentIds);
    const searchBefore = await search(sourceRepositories);
    assertSearch(searchBefore, 'source search');

    const transfer = new M1cWorkspaceTransfer({
      repository: sourceRepositories.workspaceTransfer,
      blobStore: storage.blobStore,
      fileStore: storage.workspaceBundleFiles,
      reviewPreferences: storage.reviewPreferences,
      now: () => EXPORTED_AT,
    });
    const exported = await transfer.exportWorkspace(WORKSPACE_ID);
    assertEqual(exported.tableCounts.snapshot, 10, 'Bundle snapshot count');
    assertEqual(
      exported.tableCounts.fragment,
      EXPECTED_FRAGMENT_COUNT,
      'Bundle Fragment count',
    );
    await assertBundleOmitsSourceBytes(
      storage.workspaceBundleFiles,
      exported.fileName,
      sources,
    );

    const restoreTransfer = new M1cWorkspaceTransfer({
      repository: restoreRepositories.workspaceTransfer,
      blobStore: storage.blobStore,
      fileStore: storage.workspaceBundleFiles,
      reviewPreferences: storage.reviewPreferences,
      now: () => EXPORTED_AT,
    });
    const restored = await restoreTransfer.restoreWorkspace(
      WORKSPACE_ID,
      exported.fileName,
    );
    assertEqual(restored.tableCounts.snapshot, 10, 'restored snapshot count');
    await assertDomainSnapshotsEqual(sourceRepositories, restoreRepositories);
    await verifyImport(restorePool, sources);
    await verifyReviewQueueReadModel(restoreRepositories);

    const searchAfter = await search(restoreRepositories);
    assertSearch(searchAfter, 'restored search');
    assertEqual(
      JSON.stringify(searchAfter),
      JSON.stringify(searchBefore),
      'restored search parity',
    );
    const firstSource = sources[0];
    if (firstSource === undefined) {
      throw new Error('The fixed M1C source set must not be empty.');
    }
    const replay = await importOne(
      restoreRepositories,
      storage.blobStore,
      firstSource,
    );
    assertImportStatus(replay, 'existing', 'restored command replay');

    process.stdout.write(
      `${JSON.stringify({
        event: 'm1c_expand_smoke_passed',
        issues: sources.length,
        snapshots: 10,
        fragments: EXPECTED_FRAGMENT_COUNT,
        intakeUnits: EXPECTED_INTAKE_UNIT_COUNT,
        curationTargets: 1,
        knowledgeItems: 2,
        knowledgeRelations: 1,
        searchResults: searchAfter.totalCount,
        bundleFile: exported.fileName,
        bundleBytes: exported.byteLength,
        bundleBlobs: exported.blobCount,
        restoredTableParity: true,
        restoredReplay: 'existing',
      })}\n`,
    );
  } finally {
    await Promise.allSettled([sourcePool.end(), restorePool.end()]);
  }
}

function requiredEnvironment(): Readonly<{
  sourceRoot: string;
  dataRoot: string;
  sourceDatabaseUrl: string;
  restoreDatabaseUrl: string;
  sourceMigrationUrl: string;
  restoreMigrationUrl: string;
}> {
  return Object.freeze({
    sourceRoot: required(SOURCE_ROOT_VARIABLE),
    dataRoot: required(DATA_ROOT_VARIABLE),
    sourceDatabaseUrl: required(SOURCE_DATABASE_VARIABLE),
    restoreDatabaseUrl: required(RESTORE_DATABASE_VARIABLE),
    sourceMigrationUrl: required(SOURCE_MIGRATION_VARIABLE),
    restoreMigrationUrl: required(RESTORE_MIGRATION_VARIABLE),
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`M1C-EXPAND requires ${name}.`);
  }
  return value;
}

async function readFixedSources(root: string): Promise<readonly FixedSource[]> {
  const sources: FixedSource[] = [];
  for (const expected of FIXED_ISSUES) {
    const bytes = Uint8Array.from(
      await readFile(resolve(root, `issue-${expected.issue.toString()}.md`)),
    );
    const sha256 = digest(bytes);
    assertEqual(bytes.byteLength, expected.byteLength, 'fixed source bytes');
    assertEqual(sha256, expected.sha256, 'fixed source digest');
    sources.push(Object.freeze({issue: expected.issue, bytes, sha256}));
  }
  return Object.freeze(sources);
}

async function migrate(databaseUrl: string): Promise<void> {
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
  assertEqual(result.appliedVersions.length, 7, 'migration count');
}

async function importFixedSources(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
  blobStore: Parameters<typeof importMarkdownEvidence>[0]['blobStore'],
  sources: readonly FixedSource[],
): Promise<readonly string[]> {
  const fragmentIds: string[] = [];
  const intakeTargetFragmentIds: string[] = [];
  for (const source of sources) {
    const result = await importOne(repositories, blobStore, source);
    assertImportStatus(result, 'created', `issue ${source.issue.toString()}`);
    if (result.status !== 'created') throw new Error('Import receipt missing.');
    fragmentIds.push(...result.fragmentIds);
    intakeTargetFragmentIds.push(...result.intakeTargetFragmentIds);
  }
  assertEqual(fragmentIds.length, EXPECTED_FRAGMENT_COUNT, 'Fragment count');
  assertEqual(
    intakeTargetFragmentIds.length,
    EXPECTED_INTAKE_UNIT_COUNT,
    'intake unit count',
  );
  const firstSource = sources[0];
  if (firstSource === undefined) {
    throw new Error('The fixed M1C source set must not be empty.');
  }
  const replay = await importOne(repositories, blobStore, firstSource);
  assertImportStatus(replay, 'existing', 'source replay');
  return Object.freeze(intakeTargetFragmentIds);
}

function importOne(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
  blobStore: Parameters<typeof importMarkdownEvidence>[0]['blobStore'],
  source: FixedSource,
): Promise<ImportMarkdownEvidenceResult> {
  const suffix = source.issue.toString().padStart(12, '0');
  const issuePath = `docs/issue-${source.issue.toString()}.md`;
  const documentUri = `https://github.com/ruanyf/weekly/blob/${FIXED_COMMIT}/${issuePath}`;
  return importMarkdownEvidence(
    {blobStore, evidenceRepository: repositories.evidence},
    {
      workspaceId: WORKSPACE_ID,
      commandIdempotencyKey: `m1c-expand-import-${source.issue.toString()}`,
      resource: {
        workspaceId: WORKSPACE_ID,
        resourceId: `10000000-0000-4000-8000-${suffix}`,
        resourceKind: 'git_file',
        sourceKey: `git:github.com/ruanyf/weekly:${issuePath}`,
        canonicalUri: documentUri,
      },
      gitResource: {
        workspaceId: WORKSPACE_ID,
        resourceId: `10000000-0000-4000-8000-${suffix}`,
        canonicalRepositoryUri: 'https://github.com/ruanyf/weekly',
        repositoryRelativePath: issuePath,
      },
      snapshot: {
        workspaceId: WORKSPACE_ID,
        snapshotId: `20000000-0000-4000-8000-${suffix}`,
        resourceId: `10000000-0000-4000-8000-${suffix}`,
        capturedAt: CAPTURED_AT,
        mediaType: 'text/markdown',
      },
      gitObservations: [
        {
          workspaceId: WORKSPACE_ID,
          observationId: `30000000-0000-4000-8000-${suffix}`,
          resourceId: `10000000-0000-4000-8000-${suffix}`,
          snapshotId: `20000000-0000-4000-8000-${suffix}`,
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

async function createRepresentativeDomainState(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
  fragmentIds: readonly string[],
): Promise<void> {
  const fragmentId = fragmentIds[0];
  if (fragmentId === undefined) {
    throw new Error('At least one Fragment is required.');
  }
  const curation = await executeApplyManualCuration(
    repositories.curation,
    {
      effectiveWorkspaceId: WORKSPACE_ID,
      commandIdempotencyKey: 'm1c-expand-curation-1',
      authority: 'manual_user',
    },
    {
      target: {kind: 'fragment', fragmentId},
      expectedTargetVersion: 0,
      operations: [
        {
          kind: 'set_intake_decision',
          action: 'full',
          reasonCodes: ['worth_exploring'],
        },
      ],
    },
  );
  assertDomainStatus(curation, 'curation');

  const provenance = {
    citations: [fragmentId],
    fragmentDerivations: [],
    knowledgeDerivations: [],
  } as const;
  const knowledge = await executeApplyManualKnowledgeChangeSet(
    repositories.knowledge,
    {
      effectiveWorkspaceId: WORKSPACE_ID,
      commandIdempotencyKey: 'm1c-expand-knowledge-1',
      authority: 'manual_user',
    },
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          kind: 'put_item',
          itemId: ITEM_A,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'concept',
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
            title: 'M1C expansion concept A',
            body: 'Source-backed validation item A.',
          },
          provenance,
        },
        {
          kind: 'put_item',
          itemId: ITEM_B,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'framework',
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
            title: 'M1C expansion concept B',
            body: 'Source-backed validation item B.',
          },
          provenance,
        },
        {
          kind: 'put_relation',
          relationId: RELATION,
          expectedRevision: 0,
          value: {
            subjectItemId: ITEM_A,
            relationTypeKey: 'm1c.related',
            objectItemId: ITEM_B,
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
          },
          provenance,
        },
      ],
    },
  );
  assertDomainStatus(knowledge, 'knowledge');
}

function search(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
): Promise<DeterministicKnowledgeSearchResult> {
  return executeDeterministicKnowledgeSearch(
    repositories.retrieval,
    {effectiveWorkspaceId: WORKSPACE_ID, authority: 'manual_user'},
    {
      text: {
        value: 'M1C expansion',
        mode: 'substring',
        fields: ['title'],
      },
      filters: {
        knowledgeKinds: [],
        epistemicRoles: [],
        reviewStates: [],
        source: {kind: 'any'},
        relation: {kind: 'any'},
      },
      page: {limit: 25},
    },
  );
}

function assertSearch(
  result: DeterministicKnowledgeSearchResult,
  label: string,
): asserts result is Extract<
  DeterministicKnowledgeSearchResult,
  {status: 'ok'}
> {
  if (result.status !== 'ok' || result.totalCount !== 2) {
    throw new Error(`${label} did not return the two expected items.`);
  }
}

async function verifyImport(
  pool: PostgresPoolBoundary,
  sources: readonly FixedSource[],
): Promise<void> {
  const counts = await pool.query<{
    commands: number;
    fragments: number;
    snapshots: number;
  }>(
    `SELECT
      (SELECT count(*)::integer FROM struinfo.evidence_capture_command WHERE workspace_id = $1) AS commands,
      (SELECT count(*)::integer FROM struinfo.fragment WHERE workspace_id = $1) AS fragments,
      (SELECT count(*)::integer FROM struinfo.snapshot WHERE workspace_id = $1) AS snapshots`,
    [WORKSPACE_ID],
  );
  assertEqual(counts.rows[0]?.commands, 10, 'capture command count');
  assertEqual(counts.rows[0]?.snapshots, 10, 'snapshot count');
  assertEqual(
    counts.rows[0]?.fragments,
    EXPECTED_FRAGMENT_COUNT,
    'database Fragment count',
  );
  const snapshots = await pool.query<{
    snapshot_id: string;
    raw_sha256: string;
  }>(
    'SELECT snapshot_id, raw_sha256 FROM struinfo.snapshot WHERE workspace_id = $1 ORDER BY snapshot_id',
    [WORKSPACE_ID],
  );
  assertEqual(snapshots.rows.length, sources.length, 'snapshot digest rows');
  for (const source of sources) {
    const snapshotId = `20000000-0000-4000-8000-${source.issue.toString().padStart(12, '0')}`;
    const row = snapshots.rows.find(
      (candidate) => candidate.snapshot_id === snapshotId,
    );
    assertEqual(row?.raw_sha256, source.sha256, 'restored source digest');
  }
}

async function verifyReviewQueueReadModel(
  repositories: Readonly<PostgresKnowledgeRepositorySet>,
): Promise<void> {
  const snapshots = await repositories.evidenceRead.listSnapshots(WORKSPACE_ID);
  assertEqual(snapshots.length, FIXED_ISSUES.length, 'review source count');
  let fragmentCount = 0;
  let sectionCount = 0;
  for (const summary of snapshots) {
    const snapshot = await repositories.evidenceRead.loadSnapshot(
      WORKSPACE_ID,
      summary.snapshotId,
    );
    if (snapshot === undefined) {
      throw new Error('The review read model omitted a listed Snapshot.');
    }
    for (const structure of snapshot.structures) {
      fragmentCount += structure.fragments.length;
      sectionCount += structure.fragments.filter(
        (fragment) => fragment.nodeKind === 'section',
      ).length;
    }
  }
  assertEqual(fragmentCount, EXPECTED_FRAGMENT_COUNT, 'review Fragment count');
  assertEqual(
    sectionCount,
    EXPECTED_INTAKE_UNIT_COUNT,
    'persisted review queue count',
  );
}

async function assertDomainSnapshotsEqual(
  source: Readonly<PostgresKnowledgeRepositorySet>,
  restored: Readonly<PostgresKnowledgeRepositorySet>,
): Promise<void> {
  const [left, right] = await Promise.all([
    source.workspaceTransfer.exportWorkspace(WORKSPACE_ID),
    restored.workspaceTransfer.exportWorkspace(WORKSPACE_ID),
  ]);
  assertEqual(
    JSON.stringify(right),
    JSON.stringify(left),
    'restored domain snapshot',
  );
}

async function assertBundleOmitsSourceBytes(
  fileStore: Awaited<
    ReturnType<typeof createLocalStorageServices>
  >['workspaceBundleFiles'],
  fileName: string,
  sources: readonly FixedSource[],
): Promise<void> {
  const encoded = new TextDecoder().decode(await fileStore.read(fileName));
  for (const source of sources) {
    const sourceText = new TextDecoder().decode(source.bytes);
    if (encoded.includes(sourceText.slice(0, 256))) {
      throw new Error('A workspace Bundle embedded source Blob bytes.');
    }
  }
}

function assertImportStatus(
  result: ImportMarkdownEvidenceResult,
  expected: 'created' | 'existing',
  label: string,
): void {
  if (result.status !== expected) {
    throw new Error(`${label} returned ${result.status}.`);
  }
}

function assertDomainStatus(
  result: ApplyManualCurationResult | ApplyManualKnowledgeChangeSetResult,
  label: string,
): void {
  if (result.status !== 'applied') {
    throw new Error(`${label} did not produce an applied domain result.`);
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} did not match its expected value.`);
  }
}

await main();

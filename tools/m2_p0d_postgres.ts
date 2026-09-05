import {verifyMarkdownExportCandidate} from './markdown_export_candidate.js';
import {spawn} from 'node:child_process';
import {verifyCurrentReadCandidate} from './current_read_candidate.js';
import {verifyIncrementalIndexCandidate} from './incremental_index_candidate.js';
import {verifySourceReviewCandidate} from './source_review_candidate.js';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {arch, platform, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

import {
  buildInformationEntryKnowledgeGraph,
  InformationEntryRetrievalService,
  type InformationEntryAssociationIncrementalRepositoryPort,
  type InformationEntryAssociationProjection,
} from '../apps/server/src/modules/entries/index.js';
import {importMarkdownEvidence} from '../apps/server/src/modules/evidence/index.js';
import {
  BulkIngestionAdjudicationService,
  BulkIngestionEnrichmentService,
  BulkIngestionService,
} from '../apps/server/src/modules/processing/index.js';
import {preparePgBossSchema} from '../apps/server/src/queue/prepare_pg_boss_schema.js';
import {SystemPgBossFactory} from '../apps/server/src/queue/pg_boss_runtime.js';
import type {
  BlobIdentity,
  BlobStore,
} from '../apps/server/src/storage/blob_store.js';
import {LocalFilesystemBlobStore} from '../apps/server/src/platform/storage/local_filesystem_blob_store.js';
import {initializeLocalDataRoot} from '../apps/server/src/platform/storage/local_data_root.js';
import {LocalReviewPreferencesStore} from '../apps/server/src/platform/storage/local_review_preferences_store.js';
import {NodeMigrationFileSystem} from '../apps/server/src/platform/database/migrations/migration_files.js';
import {
  MigrationFailure,
  type MigrationLogger,
  type MigrationLogEvent,
} from '../apps/server/src/platform/database/migrations/migration_log.js';
import {PgMigrationConnector} from '../apps/server/src/platform/database/migrations/postgres_migration_connection.js';
import {executeMigrations} from '../apps/server/src/platform/database/migrations/migration_runner.js';
import {
  createNodePostgresPool,
  createPostgresRepositories,
  decodePostgresConnectionUrl,
  PostgresOperationalStatusReader,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';

export const M2_P0D_REPORT_SCHEMA =
  'struinfo.m2-p0d-postgres-report.v4' as const;
export const M2_P0D_POSTGRES_IMAGE = 'postgres:18.6' as const;

export type M2P0dFailureCode =
  | 'docker_setup_failed'
  | 'migration_failed'
  | 'queue_prepare_failed'
  | 'runtime_grant_failed'
  | 'runtime_connection_failed'
  | 'evidence_import_failed'
  | 'p0a_plan_failed'
  | 'p0a_initial_execution_failed'
  | 'p0a_initial_assertion_failed'
  | 'p0a_retry_failed'
  | 'p0a_replay_failed'
  | 'p0a_recovery_assertion_failed'
  | 'p0b_recovery_failed'
  | 'p0c_adjudication_failed'
  | 'p5d_product_flow_failed'
  | 'persistence_verification_failed'
  | 'cleanup_failed';

export class M2P0dWorkloadError extends Error {
  public readonly code: M2P0dFailureCode;
  public readonly migrationEvent: MigrationLogEvent | undefined;
  public readonly migrationVersion: string | undefined;
  public readonly failureName: string | undefined;
  public readonly failureCode: string | undefined;
  public readonly failureBoundary: string | undefined;

  public constructor(
    code: M2P0dFailureCode,
    migrationEvent?: MigrationLogEvent,
    migrationVersion?: string,
    failureName?: string,
    failureCode?: string,
    failureBoundary?: string,
  ) {
    super('The M2-P0D workload failed.');
    this.name = 'M2P0dWorkloadError';
    this.code = code;
    this.migrationEvent = migrationEvent;
    this.migrationVersion = migrationVersion;
    this.failureName = failureName;
    this.failureCode = failureCode;
    this.failureBoundary = failureBoundary;
  }
}

export interface M2P0dWorkloadOptions {
  readonly snapshotCount: number;
  readonly entriesPerSnapshot: number;
  readonly noTagEvery: number;
  readonly image: string;
}

export const M2_P0D_STANDARD_WORKLOAD: Readonly<M2P0dWorkloadOptions> =
  Object.freeze({
    snapshotCount: 500,
    entriesPerSnapshot: 30,
    noTagEvery: 10,
    image: M2_P0D_POSTGRES_IMAGE,
  });

export const M2_P0D_SMOKE_WORKLOAD: Readonly<M2P0dWorkloadOptions> =
  Object.freeze({
    snapshotCount: 4,
    entriesPerSnapshot: 8,
    noTagEvery: 4,
    image: M2_P0D_POSTGRES_IMAGE,
  });

export interface M2P0dReport {
  readonly schemaVersion: typeof M2_P0D_REPORT_SCHEMA;
  readonly evidenceScope: 'synthetic_disposable_postgres';
  readonly runtime: Readonly<{
    node: string;
    platform: string;
    architecture: string;
    postgresImage: string;
    postgresMajor: 18;
  }>;
  readonly workloadSha256: string;
  readonly workload: Readonly<{
    snapshotCount: number;
    entriesPerSnapshot: number;
    entryCount: number;
    expectedExceptionCount: number;
    sourceByteCount: number;
  }>;
  readonly migrations: Readonly<{
    appliedCount: number;
    replayOutcome: 'noop';
  }>;
  readonly recovery: Readonly<{
    p0aFailedOnce: true;
    p0aRetrySucceeded: true;
    p0aReplaySucceeded: true;
    p0bFailedOnce: true;
    p0bRetrySucceeded: true;
    p0bReplaySucceeded: true;
    adjudicationCountGuardRejected: true;
  }>;
  readonly persisted: Readonly<{
    resources: number;
    snapshots: number;
    intakeFragments: number;
    entries: number;
    currentEntryVersions: number;
    ruleKeywords: number;
    associationProjections: number;
    exceptions: number;
    acceptedAdjudications: number;
    searchProjections: number;
  }>;
  readonly readCandidate: Awaited<
    ReturnType<typeof verifyCurrentReadCandidate>
  >;
  readonly incrementalIndex: Awaited<
    ReturnType<typeof verifyIncrementalIndexCandidate>
  >;
  readonly markdownExport: Awaited<
    ReturnType<typeof verifyMarkdownExportCandidate>
  >;
  readonly sourceReview: Awaited<
    ReturnType<typeof verifySourceReviewCandidate>
  >;
  readonly productFlow: Readonly<{
    indexedEntries: number;
    lexicalMatchCount: number;
    exactSourceInputCount: number;
    knowledgeNodeCount: number;
    knowledgeEdgeCount: number;
    operationalCurrentEntryCount: number;
    operationalSearchProjectionCount: number;
  }>;
  readonly measurements: Readonly<{
    containerSetupMilliseconds: number;
    migrationAndGrantMilliseconds: number;
    evidenceImportMilliseconds: number;
    p0aInitialAndRecoveryMilliseconds: number;
    p0bInitialAndRecoveryMilliseconds: number;
    p0cAdjudicationMilliseconds: number;
    productFlowMilliseconds: number;
    readCandidateMilliseconds: number;
    incrementalIndexMilliseconds: number;
    totalMilliseconds: number;
    completedEntriesPerSecond: number;
  }>;
  readonly cleanup: 'container_and_external_data_removed';
  readonly limitation: string;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Timings {
  containerSetupMilliseconds: number;
  migrationAndGrantMilliseconds: number;
  evidenceImportMilliseconds: number;
  p0aInitialAndRecoveryMilliseconds: number;
  p0bInitialAndRecoveryMilliseconds: number;
  p0cAdjudicationMilliseconds: number;
  productFlowMilliseconds: number;
  readCandidateMilliseconds: number;
  incrementalIndexMilliseconds: number;
}

export function parseM2P0dArguments(
  arguments_: readonly string[],
): Readonly<M2P0dWorkloadOptions> {
  const normalized =
    arguments_.length > 0 && arguments_[0] === '--'
      ? arguments_.slice(1)
      : arguments_;
  if (
    normalized.length === 0 ||
    (normalized.length === 1 && normalized[0] === '--full')
  ) {
    return M2_P0D_STANDARD_WORKLOAD;
  }
  if (normalized.length === 1 && normalized[0] === '--smoke') {
    return M2_P0D_SMOKE_WORKLOAD;
  }
  throw new Error('M2-P0D arguments are invalid.');
}

export function createM2P0dSyntheticMarkdown(
  snapshotOrdinal: number,
  options: Readonly<
    Pick<M2P0dWorkloadOptions, 'entriesPerSnapshot' | 'noTagEvery'>
  >,
): string {
  if (
    !Number.isSafeInteger(snapshotOrdinal) ||
    snapshotOrdinal < 1 ||
    !Number.isSafeInteger(options.entriesPerSnapshot) ||
    options.entriesPerSnapshot < 1 ||
    !Number.isSafeInteger(options.noTagEvery) ||
    options.noTagEvery < 2
  ) {
    throw new Error('M2-P0D synthetic fixture options are invalid.');
  }
  const snapshotKey = snapshotOrdinal.toString().padStart(4, '0');
  const lines = [`# 合成批次 ${snapshotKey}`, '', '## 科技动态', ''];
  for (let index = 1; index <= options.entriesPerSnapshot; index += 1) {
    const globalOrdinal =
      (snapshotOrdinal - 1) * options.entriesPerSnapshot + index;
    if (globalOrdinal % options.noTagEvery === 0) {
      lines.push(
        `${index.toString()}、内容`,
        '',
        '这是一段完全合成的普通说明文字，用来验证规则不能确定标签时的复核路径。',
        '',
      );
      continue;
    }
    const entryKey = globalOrdinal.toString().padStart(5, '0');
    lines.push(
      `${index.toString()}、TypeScript 教程合成条目 ${entryKey}`,
      '',
      `本条只用于基准，使用 \`Cluster-${snapshotKey}\`、\`TypeScript\` 和 \`PostgreSQL\` 验证确定性标签与增量联系。`,
      '',
    );
  }
  return lines.join('\n');
}

export async function runM2P0dPostgresWorkload(
  options: Readonly<M2P0dWorkloadOptions>,
): Promise<Readonly<M2P0dReport>> {
  assertWorkload(options);
  const started = performance.now();
  const timings: Timings = {
    containerSetupMilliseconds: 0,
    migrationAndGrantMilliseconds: 0,
    evidenceImportMilliseconds: 0,
    p0aInitialAndRecoveryMilliseconds: 0,
    p0bInitialAndRecoveryMilliseconds: 0,
    p0cAdjudicationMilliseconds: 0,
    productFlowMilliseconds: 0,
    readCandidateMilliseconds: 0,
    incrementalIndexMilliseconds: 0,
  };
  const containerName = `struinfo-m2-p0d-${randomUUID()}`;
  const dataRoot = await mkdtemp(join(tmpdir(), 'struinfo-m2-p0d-'));
  let containerStarted = false;
  let runtimePool: PostgresPoolBoundary | undefined;
  let cleanupSucceeded: boolean;
  let result: Omit<M2P0dReport, 'cleanup'> | undefined;
  let stage: M2P0dFailureCode = 'docker_setup_failed';
  let failure: M2P0dFailureCode | undefined;
  let migrationEvent: MigrationLogEvent | undefined;
  let migrationVersion: string | undefined;
  let failureName: string | undefined;
  let failureCode: string | undefined;
  let activeBoundary: string | undefined;
  try {
    const setupStarted = performance.now();
    await ensureDockerImage(options.image);
    const password = randomBytes(24).toString('hex');
    await runRequiredProcess(
      'docker',
      [
        'run',
        '--detach',
        '--name',
        containerName,
        '--publish',
        '127.0.0.1::5432',
        '--env',
        `POSTGRES_USER=${MIGRATOR_ROLE}`,
        '--env',
        `POSTGRES_PASSWORD=${password}`,
        '--env',
        `POSTGRES_DB=${DATABASE_NAME}`,
        options.image,
      ],
      undefined,
      120_000,
    );
    containerStarted = true;
    const port = await publishedPostgresPort(containerName);
    await waitForPostgres(containerName);
    timings.containerSetupMilliseconds = elapsed(setupStarted);

    stage = 'migration_failed';
    const migrationStarted = performance.now();
    activeBoundary = 'createSyntheticRuntimeRole';
    await createRuntimeRole(containerName, password);
    const migratorUrl = connectionUrl(MIGRATOR_ROLE, password, port);
    const runtimeUrl = connectionUrl(RUNTIME_ROLE, password, port);
    const migrationOptions = {
      config: Object.freeze({
        connection: decodePostgresConnectionUrl(migratorUrl, 'migrator'),
      }),
      migrationRoots: Object.freeze([
        resolve(process.cwd(), 'apps/server/migrations'),
      ]),
      fileSystem: new NodeMigrationFileSystem(),
      connector: new PgMigrationConnector(),
      logger: SILENT_MIGRATION_LOGGER,
    };
    activeBoundary = 'applySyntheticMigrations';
    const migrated = await executeMigrations(migrationOptions);
    const migrationReplay = await executeMigrations(migrationOptions);
    if (migrated.outcome !== 'applied' || migrationReplay.outcome !== 'noop') {
      throw new Error('M2-P0D migration identity was not repeatable.');
    }
    const migratorPool = createNodePostgresPool(
      decodePostgresConnectionUrl(migratorUrl, 'migrator'),
    );
    stage = 'queue_prepare_failed';
    try {
      await preparePgBossSchema({
        factory: new SystemPgBossFactory(),
        pool: migratorPool,
      });
    } finally {
      await migratorPool.end();
    }
    stage = 'runtime_grant_failed';
    await applyRuntimeGrants(containerName);
    stage = 'runtime_connection_failed';
    runtimePool = createNodePostgresPool(
      decodePostgresConnectionUrl(runtimeUrl, 'runtime'),
    );
    const server = await runtimePool.query<{server_version_num: string}>(
      'SHOW server_version_num',
    );
    if (
      Number.parseInt(server.rows[0]?.server_version_num ?? '', 10) < 180_000
    ) {
      throw new Error('M2-P0D requires PostgreSQL 18.');
    }
    timings.migrationAndGrantMilliseconds = elapsed(migrationStarted);

    stage = 'evidence_import_failed';
    const layout = await initializeLocalDataRoot(dataRoot);
    const blobStore = await LocalFilesystemBlobStore.open(
      layout.areaRoots.blobs,
    );
    const preferences = new LocalReviewPreferencesStore(
      layout.areaRoots.preferences,
    );
    const repositories = createPostgresRepositories(runtimePool);
    const observedBulkIngestion = observePort(
      repositories.bulkIngestion,
      (operation) => {
        activeBoundary = `bulkIngestion.${operation}`;
      },
    );
    const observedEnrichment = observePort(
      repositories.bulkIngestionEnrichment,
      (operation) => {
        activeBoundary = `bulkIngestionEnrichment.${operation}`;
      },
    );
    const observedAdjudication = observePort(
      repositories.bulkIngestionAdjudication,
      (operation) => {
        activeBoundary = `bulkIngestionAdjudication.${operation}`;
      },
    );
    const importStarted = performance.now();
    let sourceByteCount = 0;
    for (let ordinal = 1; ordinal <= options.snapshotCount; ordinal += 1) {
      const source = createM2P0dSyntheticMarkdown(ordinal, options);
      const sourceUtf8 = new TextEncoder().encode(source);
      sourceByteCount += sourceUtf8.byteLength;
      const imported = await importMarkdownEvidence(
        {blobStore, evidenceRepository: repositories.evidence},
        syntheticImport(ordinal, sourceUtf8),
      );
      if (imported.status !== 'created') {
        throw new Error('M2-P0D synthetic Evidence import failed.');
      }
    }
    timings.evidenceImportMilliseconds = elapsed(importStarted);

    stage = 'p0a_plan_failed';
    const p0aStarted = performance.now();
    const planService = new BulkIngestionService({
      workspaceId: WORKSPACE_ID,
      repository: observedBulkIngestion,
      evidence: repositories.evidenceRead,
      entries: repositories.informationEntries,
      blobStore: new OneShotReadFailureBlobStore(blobStore),
    });
    const planned = await planService.plan({
      idempotencyKey: 'm2-p0d-synthetic-batch-v1',
      privacyScope: 'public_only',
      limit: options.snapshotCount,
    });
    if (planned.outcome === 'empty') {
      throw new Error('M2-P0D produced an empty P0A plan.');
    }
    stage = 'p0a_initial_execution_failed';
    const firstP0a = await planService.execute({
      batchId: planned.batch.batchId,
      mode: 'run',
      maxItems: options.snapshotCount,
    });
    stage = 'p0a_initial_assertion_failed';
    if (
      firstP0a.outcome !== 'failed' ||
      firstP0a.batch.failedSnapshotCount !== 1
    ) {
      throw new Error('M2-P0D did not observe the controlled P0A failure.');
    }
    const recoveredP0a = new BulkIngestionService({
      workspaceId: WORKSPACE_ID,
      repository: observedBulkIngestion,
      evidence: repositories.evidenceRead,
      entries: repositories.informationEntries,
      blobStore,
    });
    stage = 'p0a_retry_failed';
    const retryP0a = await recoveredP0a.execute({
      batchId: planned.batch.batchId,
      mode: 'retry',
      maxItems: options.snapshotCount,
    });
    stage = 'p0a_replay_failed';
    const replayP0a = await recoveredP0a.execute({
      batchId: planned.batch.batchId,
      mode: 'resume',
      maxItems: options.snapshotCount,
    });
    const entryCount = options.snapshotCount * options.entriesPerSnapshot;
    stage = 'p0a_recovery_assertion_failed';
    if (
      retryP0a.outcome !== 'succeeded' ||
      retryP0a.batch.succeededEntryCount !== entryCount ||
      replayP0a.outcome !== 'succeeded'
    ) {
      throw new Error('M2-P0D P0A recovery or replay failed.');
    }
    timings.p0aInitialAndRecoveryMilliseconds = elapsed(p0aStarted);

    stage = 'p0b_recovery_failed';
    const p0bStarted = performance.now();
    const failingEnrichment = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository: observedEnrichment,
      entries: repositories.informationEntries,
      associations: new OneShotAssociationFailureRepository(
        repositories.informationEntryAssociations,
      ),
      preferences,
    });
    const firstP0b = await failingEnrichment.execute({
      batchId: planned.batch.batchId,
      mode: 'run',
      maxItems: options.snapshotCount,
    });
    if (firstP0b.outcome !== 'failed') {
      throw new Error('M2-P0D did not observe the controlled P0B failure.');
    }
    const recoveredEnrichment = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository: observedEnrichment,
      entries: repositories.informationEntries,
      associations: repositories.informationEntryAssociations,
      preferences,
    });
    const retryP0b = await recoveredEnrichment.execute({
      batchId: planned.batch.batchId,
      mode: 'retry',
      maxItems: options.snapshotCount,
    });
    const replayP0b = await recoveredEnrichment.execute({
      batchId: planned.batch.batchId,
      mode: 'resume',
      maxItems: options.snapshotCount,
    });
    if (retryP0b.outcome !== 'succeeded' || replayP0b.outcome !== 'succeeded') {
      throw new Error('M2-P0D P0B recovery or replay failed.');
    }
    timings.p0bInitialAndRecoveryMilliseconds = elapsed(p0bStarted);

    stage = 'p0c_adjudication_failed';
    const p0cStarted = performance.now();
    const adjudication = new BulkIngestionAdjudicationService({
      workspaceId: WORKSPACE_ID,
      prerequisite: observedEnrichment,
      repository: observedAdjudication,
    });
    const beforeAdjudication = await adjudication.summarize(
      planned.batch.batchId,
    );
    const expectedExceptionCount = Math.floor(entryCount / options.noTagEvery);
    if (
      beforeAdjudication.currentExceptionCount !== expectedExceptionCount ||
      beforeAdjudication.pendingCount !== expectedExceptionCount
    ) {
      throw new Error('M2-P0D exception count did not match its fixture.');
    }
    const firstGroup = beforeAdjudication.groups.find(
      (group) => group.pendingCount > 0,
    );
    if (firstGroup === undefined) {
      throw new Error('M2-P0D expected a pending exception group.');
    }
    const guarded = await adjudication.decide({
      batchId: planned.batch.batchId,
      exceptionCode: firstGroup.exceptionCode,
      fromStatus: 'pending',
      toStatus: 'accepted',
      expectedCount: firstGroup.pendingCount + 1,
    });
    if (guarded.outcome !== 'stale' || guarded.appliedCount !== 0) {
      throw new Error('M2-P0D adjudication count guard failed.');
    }
    for (const group of guarded.summary.groups) {
      if (group.pendingCount === 0) continue;
      const decided = await adjudication.decide({
        batchId: planned.batch.batchId,
        exceptionCode: group.exceptionCode,
        fromStatus: 'pending',
        toStatus: 'accepted',
        expectedCount: group.pendingCount,
      });
      if (decided.outcome !== 'applied') {
        throw new Error('M2-P0D adjudication transition failed.');
      }
    }
    const adjudicated = await adjudication.summarize(planned.batch.batchId);
    if (
      !adjudicated.reviewComplete ||
      adjudicated.acceptedCount !== expectedExceptionCount
    ) {
      throw new Error('M2-P0D adjudication did not complete.');
    }
    timings.p0cAdjudicationMilliseconds = elapsed(p0cStarted);

    stage = 'p5d_product_flow_failed';
    const productFlowStarted = performance.now();
    const retrieval = new InformationEntryRetrievalService({
      workspaceId: WORKSPACE_ID,
      entries: repositories.informationEntries,
      associations: repositories.informationEntryAssociations,
      index: repositories.informationEntrySearchIndex,
    });
    const indexStatus = await retrieval.rebuild();
    const search = await retrieval.search({
      text: 'TypeScript',
      retrievalMode: 'lexical',
      textMode: 'substring',
      textFields: Object.freeze(['body', 'tags'] as const),
      includePrivate: false,
      onlyPrivate: false,
      limit: 10,
    });
    let exactSourceInputCount = 0;
    const sourceFragmentsBySnapshot = new Map<string, ReadonlySet<string>>();
    for (const item of search.items) {
      let sourceFragments = sourceFragmentsBySnapshot.get(
        item.entry.snapshotId,
      );
      if (sourceFragments === undefined) {
        const snapshot = await repositories.evidenceRead.loadSnapshot(
          WORKSPACE_ID,
          item.entry.snapshotId,
        );
        if (snapshot === undefined || snapshot.isPrivate === true) {
          throw new Error('M2-P5D search source Snapshot is unavailable.');
        }
        sourceFragments = new Set(
          snapshot.structures.flatMap((structure) =>
            structure.fragments.map((fragment) => fragment.fragmentId),
          ),
        );
        sourceFragmentsBySnapshot.set(item.entry.snapshotId, sourceFragments);
      }
      if (
        item.entry.value.fragmentIds.length < 1 ||
        item.entry.value.fragmentIds.some(
          (fragmentId) => !sourceFragments.has(fragmentId),
        )
      ) {
        throw new Error('M2-P5D exact Fragment source return is incomplete.');
      }
      exactSourceInputCount += item.entry.value.fragmentIds.length;
    }
    const [graphEntries, graphAssociations] = await Promise.all([
      repositories.informationEntries.loadCurrentEntries(WORKSPACE_ID, false),
      repositories.informationEntryAssociations.loadAssociationSnapshot(
        WORKSPACE_ID,
        false,
      ),
    ]);
    const associatedEntryIds = new Set(
      graphAssociations.projections.flatMap((projection) => [
        projection.entryLowId,
        projection.entryHighId,
      ]),
    );
    const graphCenterId = search.items.find((item) =>
      associatedEntryIds.has(item.entry.entryId),
    )?.entry.entryId;
    const graph =
      graphCenterId === undefined
        ? undefined
        : buildInformationEntryKnowledgeGraph(
            graphCenterId,
            graphEntries,
            graphAssociations,
          );
    const operational = await new PostgresOperationalStatusReader(
      runtimePool,
      WORKSPACE_ID,
    ).read(60);
    if (
      indexStatus.currentProjectionCount !== entryCount ||
      search.totalCount < 1 ||
      search.items.length < 1 ||
      exactSourceInputCount < search.items.length ||
      graph === undefined ||
      graph.nodes.length < 2 ||
      graph.edges.length < 1 ||
      operational.currentEntryCount !== entryCount ||
      operational.currentSearchProjectionCount !== entryCount ||
      operational.missingSearchProjectionCount !== 0
    ) {
      throw new Error('M2-P5D product-flow regression is incomplete.');
    }
    const productFlow = Object.freeze({
      indexedEntries: indexStatus.currentProjectionCount,
      lexicalMatchCount: search.totalCount,
      exactSourceInputCount,
      knowledgeNodeCount: graph.nodes.length,
      knowledgeEdgeCount: graph.edges.length,
      operationalCurrentEntryCount: operational.currentEntryCount,
      operationalSearchProjectionCount:
        operational.currentSearchProjectionCount,
    });
    timings.productFlowMilliseconds = elapsed(productFlowStarted);

    stage = 'persistence_verification_failed';
    const persisted = await readPersistedCounts(runtimePool);
    assertPersistedCounts(
      persisted,
      options,
      entryCount,
      expectedExceptionCount,
    );
    const readCandidateStarted = performance.now();
    const readCandidate = await verifyCurrentReadCandidate(
      runtimePool,
      WORKSPACE_ID,
    );
    timings.readCandidateMilliseconds = elapsed(readCandidateStarted);
    const incrementalStarted = performance.now();
    const incrementalIndex = await verifyIncrementalIndexCandidate(
      runtimePool,
      WORKSPACE_ID,
    );
    timings.incrementalIndexMilliseconds = elapsed(incrementalStarted);
    activeBoundary = 'verifySourceReviewCandidate';
    const sourceReview = await verifySourceReviewCandidate(
      runtimePool,
      WORKSPACE_ID,
    );
    activeBoundary = 'verifyMarkdownExportCandidate';
    const markdownExport = await verifyMarkdownExportCandidate(
      runtimePool,
      WORKSPACE_ID,
      blobStore,
      layout.areaRoots.exports,
    );
    const totalMilliseconds = elapsed(started);
    result = Object.freeze({
      schemaVersion: M2_P0D_REPORT_SCHEMA,
      evidenceScope: 'synthetic_disposable_postgres' as const,
      runtime: Object.freeze({
        node: process.version,
        platform: platform(),
        architecture: arch(),
        postgresImage: options.image,
        postgresMajor: 18 as const,
      }),
      workloadSha256: workloadDigest(options),
      workload: Object.freeze({
        snapshotCount: options.snapshotCount,
        entriesPerSnapshot: options.entriesPerSnapshot,
        entryCount,
        expectedExceptionCount,
        sourceByteCount,
      }),
      migrations: Object.freeze({
        appliedCount: migrated.appliedVersions.length,
        replayOutcome: 'noop' as const,
      }),
      recovery: Object.freeze({
        p0aFailedOnce: true as const,
        p0aRetrySucceeded: true as const,
        p0aReplaySucceeded: true as const,
        p0bFailedOnce: true as const,
        p0bRetrySucceeded: true as const,
        p0bReplaySucceeded: true as const,
        adjudicationCountGuardRejected: true as const,
      }),
      persisted,
      productFlow,
      readCandidate,
      incrementalIndex,
      sourceReview,
      markdownExport,
      measurements: Object.freeze({
        ...roundedTimings(timings),
        totalMilliseconds: round(totalMilliseconds),
        completedEntriesPerSecond: round(
          totalMilliseconds === 0
            ? 0
            : (entryCount * 1_000) / totalMilliseconds,
        ),
      }),
      limitation:
        'Synthetic disposable PostgreSQL evidence only; it measures product-path throughput and recovery but does not authorize or measure owner data, Provider calls, human review, or a production SLO.',
    });
  } catch (error) {
    failure = stage;
    failureName = safeFailureName(error);
    failureCode = safeFailureCode(error);
    if (stage === 'migration_failed' && error instanceof MigrationFailure) {
      migrationEvent = error.record.event;
      migrationVersion = error.record.version;
    }
  } finally {
    if (runtimePool !== undefined) {
      await runtimePool.end().catch(() => undefined);
    }
    const containerRemoved =
      !containerStarted || (await removeContainer(containerName));
    const dataRemoved = await removeTemporaryDataRoot(dataRoot);
    cleanupSucceeded = containerRemoved && dataRemoved;
  }
  if (!cleanupSucceeded) {
    throw new M2P0dWorkloadError('cleanup_failed');
  }
  if (failure !== undefined || result === undefined) {
    throw new M2P0dWorkloadError(
      failure ?? 'persistence_verification_failed',
      migrationEvent,
      migrationVersion,
      failureName,
      failureCode,
      activeBoundary,
    );
  }
  return Object.freeze({
    ...result,
    cleanup: 'container_and_external_data_removed',
  });
}

function observePort<Port extends object>(
  delegate: Port,
  onCall: (operation: string) => void,
): Port {
  return new Proxy(delegate, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function') {
        return value;
      }
      return (...parameters: readonly unknown[]) => {
        onCall(property);
        return Reflect.apply(
          value as (...arguments_: readonly unknown[]) => unknown,
          target,
          parameters,
        );
      };
    },
  });
}

function safeFailureName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : undefined;
}

function safeFailureCode(error: unknown): string | undefined {
  if (
    (typeof error !== 'object' && typeof error !== 'function') ||
    error === null
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    return undefined;
  }
  return /^[0-9A-Za-z_]{3,64}$/u.test(descriptor.value)
    ? descriptor.value
    : undefined;
}

function syntheticImport(ordinal: number, sourceUtf8: Uint8Array) {
  const resourceId = syntheticUuid('2', ordinal);
  const snapshotId = syntheticUuid('3', ordinal);
  const key = ordinal.toString().padStart(6, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    commandIdempotencyKey: `m2-p0d-import-${key}`,
    resource: Object.freeze({
      workspaceId: WORKSPACE_ID,
      resourceId,
      resourceKind: 'manual_text' as const,
      sourceKey: `synthetic:m2-p0d:${key}`,
      canonicalUri: `https://example.invalid/m2-p0d/${key}`,
    }),
    snapshot: Object.freeze({
      workspaceId: WORKSPACE_ID,
      snapshotId,
      resourceId,
      capturedAt: '2040-01-01T00:00:00.000Z',
      mediaType: 'text/markdown',
    }),
    gitObservations: Object.freeze([]),
    profile: 'ruanyf-weekly-v1' as const,
    sourceUtf8,
  });
}

class OneShotReadFailureBlobStore implements BlobStore {
  readonly #delegate: BlobStore;
  #failed = false;

  public constructor(delegate: BlobStore) {
    this.#delegate = delegate;
  }

  public put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>> {
    return this.#delegate.put(bytes);
  }

  public read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    if (!this.#failed) {
      this.#failed = true;
      return Promise.reject(new Error('synthetic one-shot Blob read failure'));
    }
    return this.#delegate.read(identity);
  }
}

class OneShotAssociationFailureRepository implements InformationEntryAssociationIncrementalRepositoryPort {
  readonly #delegate: InformationEntryAssociationIncrementalRepositoryPort;
  #failed = false;

  public constructor(
    delegate: InformationEntryAssociationIncrementalRepositoryPort,
  ) {
    this.#delegate = delegate;
  }

  public replaceAssociationProjectionsForEntries(
    workspaceId: string,
    sourceEntryIds: readonly string[],
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
    includePrivate: boolean,
  ): Promise<number> {
    if (!this.#failed) {
      this.#failed = true;
      return Promise.reject(
        new Error('synthetic one-shot association failure'),
      );
    }
    return this.#delegate.replaceAssociationProjectionsForEntries(
      workspaceId,
      sourceEntryIds,
      projections,
      includePrivate,
    );
  }
}

async function readPersistedCounts(pool: PostgresPoolBoundary) {
  const count = async (table: string, predicate = ''): Promise<number> => {
    const result = await pool.query<{count: string}>(
      `SELECT count(*)::text AS count FROM struinfo.${table} WHERE workspace_id = $1${predicate}`,
      [WORKSPACE_ID],
    );
    const value = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('M2-P0D persisted count is invalid.');
    }
    return value;
  };
  const intakeFragments = await pool.query<{count: string}>(
    [
      'SELECT count(*)::text AS count',
      'FROM struinfo.fragment AS fragment',
      'JOIN struinfo.document_node AS node',
      '  ON node.workspace_id = fragment.workspace_id',
      ' AND node.resource_id = fragment.resource_id',
      ' AND node.snapshot_id = fragment.snapshot_id',
      ' AND node.structure_id = fragment.structure_id',
      ' AND node.node_id = fragment.node_id',
      "WHERE fragment.workspace_id = $1 AND node.node_kind = 'section'",
    ].join('\n'),
    [WORKSPACE_ID],
  );
  const intakeFragmentCount = Number(intakeFragments.rows[0]?.count);
  if (!Number.isSafeInteger(intakeFragmentCount) || intakeFragmentCount < 0) {
    throw new Error('M2-P0D persisted Fragment count is invalid.');
  }
  return Object.freeze({
    resources: await count('resource'),
    snapshots: await count('snapshot'),
    intakeFragments: intakeFragmentCount,
    entries: await count('information_entry', ' AND is_current_structure'),
    currentEntryVersions: await count(
      'information_entry',
      ' AND current_revision >= 1',
    ),
    ruleKeywords: await count(
      'information_entry_content_keyword',
      " AND origin = 'rule'",
    ),
    associationProjections: await count(
      'information_entry_association_projection',
    ),
    exceptions: await count('processing_bulk_ingestion_exception'),
    acceptedAdjudications: await count(
      'processing_bulk_ingestion_adjudication',
      " AND status = 'accepted'",
    ),
    searchProjections: await count('information_entry_search_projection'),
  });
}

function assertPersistedCounts(
  persisted: M2P0dReport['persisted'],
  options: Readonly<M2P0dWorkloadOptions>,
  entryCount: number,
  exceptionCount: number,
): void {
  if (
    persisted.resources !== options.snapshotCount ||
    persisted.snapshots !== options.snapshotCount ||
    persisted.intakeFragments !== entryCount ||
    persisted.entries !== entryCount ||
    persisted.currentEntryVersions !== entryCount ||
    persisted.ruleKeywords < entryCount - exceptionCount ||
    persisted.associationProjections <= 0 ||
    persisted.exceptions !== exceptionCount ||
    persisted.acceptedAdjudications !== exceptionCount ||
    persisted.searchProjections !== entryCount
  ) {
    throw new Error('M2-P0D persisted product state is incomplete.');
  }
}

async function ensureDockerImage(image: string): Promise<void> {
  await runRequiredProcess('docker', [
    'version',
    '--format',
    '{{.Server.Version}}',
  ]);
  const inspected = await runProcess(
    'docker',
    ['image', 'inspect', image],
    undefined,
    30_000,
  );
  if (inspected.exitCode !== 0) {
    await runRequiredProcess('docker', ['pull', image], undefined, 1_200_000);
  }
}

async function publishedPostgresPort(containerName: string): Promise<number> {
  const result = await runRequiredProcess('docker', [
    'port',
    containerName,
    '5432/tcp',
  ]);
  const match = /127\.0\.0\.1:(\d{1,5})/u.exec(result.stdout);
  const port = Number(match?.[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('M2-P0D Docker port projection is invalid.');
  }
  return port;
}

async function waitForPostgres(containerName: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await runProcess(
      'docker',
      [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        MIGRATOR_ROLE,
        '-d',
        DATABASE_NAME,
      ],
      undefined,
      5_000,
    );
    if (result.exitCode === 0) return;
    await new Promise<void>((resolvePromise) =>
      setTimeout(resolvePromise, 250),
    );
  }
  throw new Error('M2-P0D PostgreSQL readiness deadline elapsed.');
}

async function createRuntimeRole(
  containerName: string,
  password: string,
): Promise<void> {
  await runRequiredProcess('docker', [
    'exec',
    containerName,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    MIGRATOR_ROLE,
    '-d',
    DATABASE_NAME,
    '-c',
    `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  ]);
}

async function applyRuntimeGrants(containerName: string): Promise<void> {
  const sql = await readFile(
    resolve(process.cwd(), 'deploy/postgresql/apply-runtime-grants.sql'),
    'utf8',
  );
  await runRequiredProcess(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-U',
      MIGRATOR_ROLE,
      '-d',
      DATABASE_NAME,
    ],
    sql,
    120_000,
  );
}

async function removeContainer(containerName: string): Promise<boolean> {
  if (!/^struinfo-m2-p0d-[0-9a-f-]{36}$/u.test(containerName)) return false;
  const removed = await runProcess(
    'docker',
    ['rm', '--force', containerName],
    undefined,
    60_000,
  );
  return removed.exitCode === 0;
}

async function removeTemporaryDataRoot(dataRoot: string): Promise<boolean> {
  const parent = resolve(tmpdir());
  const target = resolve(dataRoot);
  if (!target.startsWith(`${parent}\\struinfo-m2-p0d-`)) return false;
  try {
    await rm(target, {recursive: true, force: true});
    return true;
  } catch {
    return false;
  }
}

async function runRequiredProcess(
  command: string,
  arguments_: readonly string[],
  input?: string,
  timeoutMs = 60_000,
): Promise<Readonly<ProcessResult>> {
  const result = await runProcess(command, arguments_, input, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error('M2-P0D external process failed.');
  }
  return result;
}

function runProcess(
  command: string,
  arguments_: readonly string[],
  input?: string,
  timeoutMs = 60_000,
): Promise<Readonly<ProcessResult>> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...arguments_], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString('utf8')}`.slice(-MAXIMUM_PROCESS_OUTPUT);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      if (!settled) child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref();
    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(Object.freeze({exitCode: -1, stdout: '', stderr: ''}));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(Object.freeze({exitCode: code ?? -1, stdout, stderr}));
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input, 'utf8');
  });
}

function connectionUrl(user: string, password: string, port: number): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port.toString()}/${DATABASE_NAME}`;
}

function syntheticUuid(prefix: string, ordinal: number): string {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${ordinal.toString().padStart(12, '0')}`;
}

function assertWorkload(options: Readonly<M2P0dWorkloadOptions>): void {
  const entryCount = options.snapshotCount * options.entriesPerSnapshot;
  if (
    !Number.isSafeInteger(options.snapshotCount) ||
    options.snapshotCount < 1 ||
    options.snapshotCount > 500 ||
    !Number.isSafeInteger(options.entriesPerSnapshot) ||
    options.entriesPerSnapshot < 1 ||
    options.entriesPerSnapshot > 100 ||
    !Number.isSafeInteger(entryCount) ||
    entryCount > 50_000 ||
    !Number.isSafeInteger(options.noTagEvery) ||
    options.noTagEvery < 2 ||
    options.noTagEvery > entryCount ||
    options.image !== M2_P0D_POSTGRES_IMAGE
  ) {
    throw new Error('M2-P0D workload options are invalid.');
  }
}

function workloadDigest(options: Readonly<M2P0dWorkloadOptions>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 'struinfo.m2-p0d-workload.v1',
        entriesPerSnapshot: options.entriesPerSnapshot,
        noTagEvery: options.noTagEvery,
        snapshotCount: options.snapshotCount,
      }),
      'utf8',
    )
    .digest('hex');
}

function roundedTimings(timings: Timings): Timings {
  return {
    containerSetupMilliseconds: round(timings.containerSetupMilliseconds),
    migrationAndGrantMilliseconds: round(timings.migrationAndGrantMilliseconds),
    evidenceImportMilliseconds: round(timings.evidenceImportMilliseconds),
    p0aInitialAndRecoveryMilliseconds: round(
      timings.p0aInitialAndRecoveryMilliseconds,
    ),
    p0bInitialAndRecoveryMilliseconds: round(
      timings.p0bInitialAndRecoveryMilliseconds,
    ),
    p0cAdjudicationMilliseconds: round(timings.p0cAdjudicationMilliseconds),
    productFlowMilliseconds: round(timings.productFlowMilliseconds),
    readCandidateMilliseconds: round(timings.readCandidateMilliseconds),
    incrementalIndexMilliseconds: round(timings.incrementalIndexMilliseconds),
  };
}

function elapsed(started: number): number {
  return performance.now() - started;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DATABASE_NAME = 'struinfo_m2_p0d';
const MIGRATOR_ROLE = 'struinfo_tm2_migrator';
const RUNTIME_ROLE = 'struinfo_tm2_runtime';
const MAXIMUM_PROCESS_OUTPUT = 1024 * 1024;
const SILENT_MIGRATION_LOGGER: MigrationLogger = Object.freeze({
  write: () => undefined,
});

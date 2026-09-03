import type {RuntimeConfig} from '../config/runtime_config.js';
import {createRuntimeDatabase} from '../database/database_readiness.js';
import {NodeTimerScheduler, SystemDeadline} from '../lifecycle/deadline.js';
import {createPostgresRepositories} from '../platform/database/postgresql/postgres_repository_factory.js';
import {PostgresOperationalStatusReader} from '../platform/database/postgresql/postgres_operational_status.js';
import {
  BulkIngestionAdjudicationService,
  BulkIngestionCodexApplyService,
  BulkIngestionCodexReviewService,
  BulkIngestionEnrichmentService,
  BulkIngestionPipelineService,
  BulkIngestionService,
  BulkIngestionTypeCompletionService,
  EntryTypeLearningCodexService,
  type DecideBulkIngestionAdjudicationRequest,
  type ExecuteBulkIngestionEnrichmentRequest,
  type ExecuteBulkIngestionRequest,
  type ExportBulkIngestionCodexReviewRequest,
  type ApplyBulkIngestionTypeCompletionRequest,
  type PlanBulkIngestionRequest,
  type PreviewBulkIngestionTypeCompletionRequest,
  type SampleBulkIngestionAdjudicationRequest,
  type StartBulkIngestionPipelineRequest,
  type ExportEntryTypeLearningCodexRequest,
} from '../modules/processing/index.js';
import {LocalFilesystemBlobStore} from '../platform/storage/local_filesystem_blob_store.js';
import {LocalBulkIngestionCodexReviewFileStore} from '../platform/storage/local_bulk_ingestion_codex_review_file_store.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {LocalWorkspaceBundleFileStore} from '../platform/storage/local_workspace_bundle_file_store.js';
import {observeLocalFilesystemCapacity} from '../platform/storage/local_filesystem_capacity.js';
import {
  ensurePrivateSubdirectory,
  initializeLocalDataRoot,
} from '../platform/storage/local_data_root.js';
import {M1cWorkspaceTransfer} from '../workspace_transfer/m1c_workspace_transfer.js';
import type {M1mMaintenanceRuntimePort} from './m1m_maintenance.js';
import {
  observeM2P5cOperationalStatus,
  type M2P5cOperationalStatusThresholds,
} from './m2_p5c_operational_status.js';

export async function createM1mMaintenanceRuntime(
  config: Readonly<RuntimeConfig>,
): Promise<M1mMaintenanceRuntimePort> {
  const layout = await initializeLocalDataRoot(config.dataRoot);
  const blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
  const reviewPreferences = new LocalReviewPreferencesStore(
    layout.areaRoots.preferences,
  );
  const backupFiles = new LocalWorkspaceBundleFileStore(
    layout.areaRoots.backups,
  );
  const codexReviewFiles = new LocalBulkIngestionCodexReviewFileStore(
    await ensurePrivateSubdirectory(layout.areaRoots.exports, 'codex-work'),
  );
  const database = createRuntimeDatabase(
    config,
    new SystemDeadline(new NodeTimerScheduler()),
  );
  const repositories = createPostgresRepositories(database.pool);
  const operationalStatus = new PostgresOperationalStatusReader(
    database.pool,
    config.workspaceId,
  );
  const transfer = new M1cWorkspaceTransfer({
    repository: repositories.workspaceTransfer,
    blobStore,
    reviewPreferences,
    fileStore: backupFiles,
  });
  const bulkIngestion = new BulkIngestionService({
    workspaceId: config.workspaceId,
    repository: repositories.bulkIngestion,
    evidence: repositories.evidenceRead,
    entries: repositories.informationEntries,
    blobStore,
  });
  const bulkIngestionEnrichment = new BulkIngestionEnrichmentService({
    workspaceId: config.workspaceId,
    repository: repositories.bulkIngestionEnrichment,
    entries: repositories.informationEntries,
    associations: repositories.informationEntryAssociations,
    preferences: reviewPreferences,
  });
  const bulkIngestionAdjudication = new BulkIngestionAdjudicationService({
    workspaceId: config.workspaceId,
    prerequisite: repositories.bulkIngestionEnrichment,
    repository: repositories.bulkIngestionAdjudication,
  });
  const bulkIngestionCodexReview = new BulkIngestionCodexReviewService({
    workspaceId: config.workspaceId,
    adjudication: bulkIngestionAdjudication,
    entries: repositories.informationEntries,
    fileStore: codexReviewFiles,
  });
  const bulkIngestionCodexApply = new BulkIngestionCodexApplyService({
    workspaceId: config.workspaceId,
    fileStore: codexReviewFiles,
    entries: repositories.informationEntries,
    adjudication: bulkIngestionAdjudication,
    associations: repositories.informationEntryAssociations,
    preferences: reviewPreferences,
  });
  const bulkIngestionPipeline = new BulkIngestionPipelineService({
    ingestion: bulkIngestion,
    enrichment: bulkIngestionEnrichment,
    adjudication: bulkIngestionAdjudication,
  });
  const bulkIngestionTypeCompletion = new BulkIngestionTypeCompletionService({
    workspaceId: config.workspaceId,
    entries: repositories.informationEntries,
    adjudication: repositories.bulkIngestionAdjudication,
    enrichment: bulkIngestionEnrichment,
    preferences: reviewPreferences,
  });
  const entryTypeLearning = new EntryTypeLearningCodexService({
    workspaceId: config.workspaceId,
    entries: repositories.informationEntries,
    preferences: reviewPreferences,
    fileStore: codexReviewFiles,
  });
  return Object.freeze({
    checkReadiness: () => database.readiness.check(),
    observeOperationalStatus: (
      thresholds: Readonly<M2P5cOperationalStatusThresholds>,
    ) =>
      observeM2P5cOperationalStatus(thresholds, {
        checkDatabase: () => database.readiness.check(),
        observeDatabase: (maxRunningAgeMinutes) =>
          operationalStatus.read(maxRunningAgeMinutes),
        observeFilesystem: () => observeLocalFilesystemCapacity(layout.root),
        listBackups: () => backupFiles.list(config.workspaceId, 1),
      }),
    backup: () => transfer.exportWorkspace(config.workspaceId),
    listBackups: (limit: number) => backupFiles.list(config.workspaceId, limit),
    verifyBackup: (fileName: string) =>
      transfer.verifyWorkspace(config.workspaceId, fileName),
    previewBackupRetention: (keepLatest: number) =>
      backupFiles.previewRetention(config.workspaceId, keepLatest),
    restore: (fileName: string) =>
      transfer.restoreWorkspace(config.workspaceId, fileName),
    planIngestion: (input: Readonly<PlanBulkIngestionRequest>) =>
      bulkIngestion.plan(input),
    executeIngestion: (input: Readonly<ExecuteBulkIngestionRequest>) =>
      bulkIngestion.execute(input),
    pauseIngestion: (batchId: string) => bulkIngestion.requestPause(batchId),
    loadIngestion: (batchId: string) => bulkIngestion.load(batchId),
    executeIngestionEnrichment: (
      input: Readonly<ExecuteBulkIngestionEnrichmentRequest>,
    ) => bulkIngestionEnrichment.execute(input),
    loadIngestionEnrichment: (batchId: string) =>
      bulkIngestionEnrichment.load(batchId),
    summarizeIngestionExceptions: (batchId: string) =>
      bulkIngestionAdjudication.summarize(batchId),
    sampleIngestionExceptions: (
      input: Readonly<SampleBulkIngestionAdjudicationRequest>,
    ) => bulkIngestionAdjudication.sample(input),
    adjudicateIngestionExceptions: (
      input: Readonly<DecideBulkIngestionAdjudicationRequest>,
    ) => bulkIngestionAdjudication.decide(input),
    exportIngestionReviewPacket: (
      input: Readonly<ExportBulkIngestionCodexReviewRequest>,
    ) => bulkIngestionCodexReview.export(input),
    applyIngestionReviewResult: (packetId: string) =>
      bulkIngestionCodexApply.apply({packetId}),
    previewIngestionTypeCompletion: (
      input: Readonly<PreviewBulkIngestionTypeCompletionRequest>,
    ) => bulkIngestionTypeCompletion.preview(input),
    applyIngestionTypeCompletion: (
      input: Readonly<ApplyBulkIngestionTypeCompletionRequest>,
    ) => bulkIngestionTypeCompletion.apply(input),
    exportEntryTypeLearningPacket: (
      input: Readonly<ExportEntryTypeLearningCodexRequest>,
    ) => entryTypeLearning.export(input),
    applyEntryTypeLearningResult: (packetId: string) =>
      entryTypeLearning.apply(packetId),
    activateEntryTypeLearning: (expectedProfileRevision: number) =>
      entryTypeLearning.activate(expectedProfileRevision),
    startIngestionPipeline: (
      input: Readonly<StartBulkIngestionPipelineRequest>,
    ) => bulkIngestionPipeline.start(input),
    advanceIngestionPipeline: (batchId: string, maxItems: number) =>
      bulkIngestionPipeline.advance({batchId, maxItems}),
    loadIngestionPipelineStatus: (batchId: string) =>
      bulkIngestionPipeline.status(batchId),
    close: () => database.close(),
  });
}

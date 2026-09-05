import {describe, expect, it, vi} from 'vitest';

import {
  decodeM1mMaintenanceRequest,
  executeM1mMaintenance,
  M1mMaintenanceError,
  type M1mMaintenanceRuntimePort,
} from './m1m_maintenance.js';
import type {
  BulkIngestionAdjudicationSummary,
  BulkIngestionBatch,
  BulkIngestionEnrichmentBatch,
  BulkIngestionTypeCompletionPreview,
} from '../modules/processing/index.js';
import type {M2P5cOperationalStatusThresholds} from './m2_p5c_operational_status.js';

const SUMMARY = Object.freeze({
  fileName:
    '11111111-1111-4111-8111-111111111111-20400102030405000-11111111-1111-4111-8111-111111111111.personal-data.json',
  byteLength: 1234,
  sha256: 'a'.repeat(64),
  exportedAt: '2040-01-02T03:04:05.000Z',
  blobCount: 2,
  personalDataIncluded: true,
  tableCounts: Object.freeze({first: 3, second: 4}),
});
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const PACKET_ID = '77777777-7777-4777-8777-777777777777';
const BATCH: Readonly<BulkIngestionBatch> = Object.freeze({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  batchId: BATCH_ID,
  idempotencyKey: 'synthetic-batch-001',
  requestSha256: 'b'.repeat(64),
  planSha256: 'c'.repeat(64),
  privacyScope: 'public_only',
  status: 'planned',
  attempt: 0,
  snapshotCount: 1,
  plannedEntryCount: 2,
  succeededSnapshotCount: 0,
  succeededEntryCount: 0,
  failedSnapshotCount: 0,
  version: 1,
  createdAt: '2040-01-02T03:04:05.000Z',
  updatedAt: '2040-01-02T03:04:05.000Z',
  items: Object.freeze([
    Object.freeze({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      batchId: BATCH_ID,
      ordinal: 0,
      snapshotId: SNAPSHOT_ID,
      canonicalContentSha256: 'd'.repeat(64),
      isPrivate: false,
      plannedEntryCount: 2,
      status: 'pending',
      attempt: 0,
      version: 1,
    }),
  ]),
});
const ENRICHMENT_BATCH: Readonly<BulkIngestionEnrichmentBatch> = Object.freeze({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  batchId: BATCH_ID,
  privacyScope: 'public_only',
  status: 'planned',
  attempt: 0,
  snapshotCount: 1,
  plannedEntryCount: 2,
  succeededSnapshotCount: 0,
  succeededEntryCount: 0,
  revisedEntryCount: 0,
  addedTagCount: 0,
  associationProjectionCount: 0,
  exceptionEntryCount: 0,
  failedSnapshotCount: 0,
  pendingSnapshotCount: 1,
  runningSnapshotCount: 0,
  items: Object.freeze([
    Object.freeze({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      batchId: BATCH_ID,
      ordinal: 0,
      snapshotId: SNAPSHOT_ID,
      isPrivate: false,
      plannedEntryCount: 2,
      status: 'pending',
      attempt: 0,
      version: 1,
      exceptions: Object.freeze([]),
    }),
  ]),
});
const ADJUDICATION_SUMMARY: Readonly<BulkIngestionAdjudicationSummary> =
  Object.freeze({
    batchId: BATCH_ID,
    totalExceptionCount: 2,
    currentExceptionCount: 2,
    staleExceptionCount: 0,
    pendingCount: 2,
    acceptedCount: 0,
    manualReviewCount: 0,
    deferredCount: 0,
    reviewComplete: false,
    groups: Object.freeze([
      Object.freeze({
        exceptionCode: 'no_deterministic_tags',
        totalCount: 2,
        currentCount: 2,
        staleCount: 0,
        pendingCount: 2,
        acceptedCount: 0,
        manualReviewCount: 0,
        deferredCount: 0,
      }),
    ]),
  });
const TYPE_COMPLETION_PREVIEW: Readonly<BulkIngestionTypeCompletionPreview> =
  Object.freeze({
    batchId: BATCH_ID,
    privacyScope: 'public_only',
    ruleVersion: 'struinfo.entry-classification.deterministic.v3',
    profileRevision: 0,
    candidateExceptionCount: 2,
    staleExceptionCount: 0,
    protectedDecisionCount: 0,
    scopeExcludedCount: 0,
    staleEntryCount: 0,
    alreadyClassifiedCount: 0,
    missingTypeCount: 2,
    assignableCount: 1,
    unresolvedCount: 1,
    byPredictedType: Object.freeze([
      Object.freeze({typeKeyword: 'factual_material', count: 1}),
    ]),
    byReason: Object.freeze([
      Object.freeze({reason: 'assigned', count: 1}),
      Object.freeze({reason: 'no_signal', count: 1}),
    ]),
    byExceptionCode: Object.freeze([
      Object.freeze({exceptionCode: 'classification_type_missing', count: 2}),
    ]),
    samples: Object.freeze([]),
    nextAction: 'apply_type_completion',
  });

describe('M1M maintenance command', () => {
  it('decodes transfer and bounded bulk-ingestion requests', () => {
    expect(decodeM1mMaintenanceRequest(['preflight'])).toEqual({
      operation: 'preflight',
    });
    expect(decodeM1mMaintenanceRequest(['backup'])).toEqual({
      operation: 'backup',
    });
    expect(decodeM1mMaintenanceRequest(['status'])).toEqual({
      operation: 'operational_status',
      maxBackupAgeHours: 168,
      minimumFreePercent: 10,
      maxRunningAgeMinutes: 60,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'status',
        '--max-backup-age-hours',
        '24',
        '--minimum-free-percent',
        '15',
        '--max-running-age-minutes',
        '30',
      ]),
    ).toEqual({
      operation: 'operational_status',
      maxBackupAgeHours: 24,
      minimumFreePercent: 15,
      maxRunningAgeMinutes: 30,
    });
    expect(decodeM1mMaintenanceRequest(['backup', 'list'])).toEqual({
      operation: 'backup_list',
      limit: 20,
    });
    expect(
      decodeM1mMaintenanceRequest(['backup', 'list', '--limit', '50']),
    ).toEqual({operation: 'backup_list', limit: 50});
    expect(
      decodeM1mMaintenanceRequest([
        'backup',
        'verify',
        '--file',
        SUMMARY.fileName,
      ]),
    ).toEqual({operation: 'backup_verify', fileName: SUMMARY.fileName});
    expect(
      decodeM1mMaintenanceRequest([
        'backup',
        'retention-preview',
        '--keep-latest',
        '7',
      ]),
    ).toEqual({operation: 'backup_retention_preview', keepLatest: 7});
    expect(
      decodeM1mMaintenanceRequest(['restore', '--file', SUMMARY.fileName]),
    ).toEqual({operation: 'restore', fileName: SUMMARY.fileName});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'plan',
        '--key',
        'synthetic-batch-001',
        '--scope',
        'include_private',
        '--limit',
        '250',
      ]),
    ).toEqual({
      operation: 'ingest_plan',
      idempotencyKey: 'synthetic-batch-001',
      privacyScope: 'include_private',
      limit: 250,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'retry',
        '--batch',
        BATCH_ID,
        '--max-items',
        '25',
      ]),
    ).toEqual({
      operation: 'ingest_execute',
      mode: 'retry',
      batchId: BATCH_ID,
      maxItems: 25,
    });
    expect(
      decodeM1mMaintenanceRequest(['ingest', 'report', '--batch', BATCH_ID]),
    ).toEqual({operation: 'ingest_report', batchId: BATCH_ID});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'enrich-retry',
        '--batch',
        BATCH_ID,
        '--max-items',
        '40',
      ]),
    ).toEqual({
      operation: 'ingest_enrich_execute',
      mode: 'retry',
      batchId: BATCH_ID,
      maxItems: 40,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'enrich-refresh',
        '--batch',
        BATCH_ID,
        '--max-items',
        '500',
      ]),
    ).toEqual({
      operation: 'ingest_enrich_execute',
      mode: 'refresh',
      batchId: BATCH_ID,
      maxItems: 500,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'enrich-report',
        '--batch',
        BATCH_ID,
      ]),
    ).toEqual({operation: 'ingest_enrich_report', batchId: BATCH_ID});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'exceptions-summary',
        '--batch',
        BATCH_ID,
      ]),
    ).toEqual({operation: 'ingest_exception_summary', batchId: BATCH_ID});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'exceptions-sample',
        '--batch',
        BATCH_ID,
        '--code',
        'no_deterministic_tags',
        '--status',
        'pending',
        '--scope',
        'stale',
        '--limit',
        '12',
      ]),
    ).toEqual({
      operation: 'ingest_exception_sample',
      batchId: BATCH_ID,
      exceptionCode: 'no_deterministic_tags',
      status: 'pending',
      scope: 'stale',
      limit: 12,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'exceptions-adjudicate',
        '--batch',
        BATCH_ID,
        '--code',
        'no_deterministic_tags',
        '--from',
        'pending',
        '--to',
        'accepted',
        '--expected-count',
        '2',
      ]),
    ).toEqual({
      operation: 'ingest_exception_adjudicate',
      batchId: BATCH_ID,
      exceptionCode: 'no_deterministic_tags',
      fromStatus: 'pending',
      toStatus: 'accepted',
      expectedCount: 2,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'review-export',
        '--batch',
        BATCH_ID,
        '--code',
        'no_deterministic_tags',
        '--include-private',
        'false',
        '--limit',
        '12',
      ]),
    ).toEqual({
      operation: 'ingest_review_export',
      batchId: BATCH_ID,
      exceptionCode: 'no_deterministic_tags',
      includePrivate: false,
      limit: 12,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'review-export',
        '--batch',
        BATCH_ID,
        '--code',
        'classification_type_missing',
      ]),
    ).toEqual({
      operation: 'ingest_review_export',
      batchId: BATCH_ID,
      exceptionCode: 'classification_type_missing',
      includePrivate: false,
      limit: 100,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'review-apply',
        '--packet',
        PACKET_ID,
      ]),
    ).toEqual({operation: 'ingest_review_apply', packetId: PACKET_ID});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'pipeline-start',
        '--key',
        'synthetic-pipeline',
        '--scope',
        'public_only',
        '--limit',
        '500',
        '--max-items',
        '25',
      ]),
    ).toEqual({
      operation: 'ingest_pipeline_start',
      idempotencyKey: 'synthetic-pipeline',
      privacyScope: 'public_only',
      limit: 500,
      maxItems: 25,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'pipeline-status',
        '--batch',
        BATCH_ID,
      ]),
    ).toEqual({operation: 'ingest_pipeline_status', batchId: BATCH_ID});
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'type-completion-preview',
        '--batch',
        BATCH_ID,
        '--scope',
        'public_only',
        '--sample-limit',
        '25',
      ]),
    ).toEqual({
      operation: 'ingest_type_completion_preview',
      batchId: BATCH_ID,
      privacyScope: 'public_only',
      sampleLimit: 25,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'ingest',
        'type-completion-apply',
        '--batch',
        BATCH_ID,
        '--max-items',
        '250',
      ]),
    ).toEqual({
      operation: 'ingest_type_completion_apply',
      batchId: BATCH_ID,
      maxItems: 250,
      sampleLimit: 20,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'type-learning',
        'export',
        '--include-private',
        'false',
        '--limit',
        '80',
      ]),
    ).toEqual({
      operation: 'entry_type_learning_export',
      includePrivate: false,
      limit: 80,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'type-learning',
        'apply',
        '--packet',
        PACKET_ID,
      ]),
    ).toEqual({
      operation: 'entry_type_learning_apply',
      packetId: PACKET_ID,
    });
    expect(
      decodeM1mMaintenanceRequest([
        'type-learning',
        'activate',
        '--expected-revision',
        '3',
      ]),
    ).toEqual({
      operation: 'entry_type_learning_activate',
      expectedProfileRevision: 3,
    });
    for (const candidate of [
      [],
      ['restore'],
      ['restore', '--file', '../outside.personal-data.json'],
      ['backup', '--force'],
      ['status', '--minimum-free-percent', '0'],
      ['status', '--unknown', '1'],
      ['backup', 'list', '--limit', '0'],
      ['backup', 'verify', '--file', '../outside.personal-data.json'],
      ['backup', 'retention-preview'],
      ['backup', 'retention-preview', '--keep-latest', '0'],
      ['ingest', 'plan', '--key', ' synthetic'],
      ['ingest', 'plan', '--key', 'synthetic', '--limit', '501'],
      ['ingest', 'run', '--batch', BATCH_ID, '--max-items', '0'],
      ['ingest', 'enrich', '--batch', BATCH_ID, '--max-items', '501'],
      ['ingest', 'enrich-status', '--batch', 'not-a-uuid'],
      [
        'ingest',
        'review-export',
        '--batch',
        BATCH_ID,
        '--include-private',
        'yes',
      ],
      [
        'ingest',
        'review-export',
        '--batch',
        BATCH_ID,
        '--code',
        'no_deterministic_tags',
        '--limit',
        '21',
      ],
      [
        'ingest',
        'review-export',
        '--batch',
        BATCH_ID,
        '--code',
        'classification_domain_missing',
        '--limit',
        '101',
      ],
      ['ingest', 'review-apply', '--packet', 'not-a-uuid'],
      [
        'ingest',
        'type-completion-preview',
        '--batch',
        BATCH_ID,
        '--sample-limit',
        '51',
      ],
      [
        'ingest',
        'type-completion-apply',
        '--batch',
        BATCH_ID,
        '--max-items',
        '0',
      ],
      ['ingest', 'pipeline-start', '--key', 'synthetic', '--limit', '501'],
      [
        'ingest',
        'exceptions-adjudicate',
        '--batch',
        BATCH_ID,
        '--code',
        'no_deterministic_tags',
        '--from',
        'pending',
        '--to',
        'pending',
        '--expected-count',
        '2',
      ],
      [
        'ingest',
        'exceptions-sample',
        '--batch',
        BATCH_ID,
        '--scope',
        'unknown',
      ],
      ['ingest', 'pause', '--batch', BATCH_ID, '--extra', '1'],
    ]) {
      expect(() => decodeM1mMaintenanceRequest(candidate)).toThrow(
        expect.objectContaining({code: 'usage_invalid'}),
      );
    }
  });

  it('reports Codex work and unified pipeline state without Entry content', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance(
        {
          operation: 'ingest_review_export',
          batchId: BATCH_ID,
          includePrivate: false,
          limit: 12,
        },
        runtime,
      ),
    ).resolves.toEqual({
      event: 'm2_p0e_review_packet_empty',
      outcome: 'empty',
    });
    const applied = await executeM1mMaintenance(
      {operation: 'ingest_review_apply', packetId: PACKET_ID},
      runtime,
    );
    expect(applied).toMatchObject({
      event: 'm2_p0f_review_result_applied',
      outcome: 'unchanged',
      result: {packetId: PACKET_ID, itemCount: 1},
    });
    const pipeline = await executeM1mMaintenance(
      {operation: 'ingest_pipeline_status', batchId: BATCH_ID},
      runtime,
    );
    expect(pipeline).toMatchObject({
      event: 'm2_p0g_pipeline_status',
      outcome: 'complete',
      status: {stage: 'complete', nextAction: 'none'},
    });
    expect(JSON.stringify([applied, pipeline])).not.toMatch(
      /body|titlePath|sourceKey/iu,
    );
  });

  it('previews and applies high-confidence type completion without content', async () => {
    const runtime = createRuntime();
    const preview = await executeM1mMaintenance(
      {
        operation: 'ingest_type_completion_preview',
        batchId: BATCH_ID,
        privacyScope: 'public_only',
        sampleLimit: 20,
      },
      runtime,
    );
    expect(preview).toEqual({
      event: 'm2_p2g_type_completion_previewed',
      outcome: 'ready',
      preview: TYPE_COMPLETION_PREVIEW,
    });
    const applied = await executeM1mMaintenance(
      {
        operation: 'ingest_type_completion_apply',
        batchId: BATCH_ID,
        maxItems: 100,
        sampleLimit: 20,
      },
      runtime,
    );
    expect(applied).toMatchObject({
      event: 'm2_p2g_type_completion_applied',
      outcome: 'unchanged',
      result: {nextAction: 'export_codex_review'},
    });
    expect(JSON.stringify([preview, applied])).not.toMatch(
      /body|titlePath|sourceKey/iu,
    );
  });

  it('summarizes, samples and adjudicates exceptions without returning content', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance(
        {operation: 'ingest_exception_summary', batchId: BATCH_ID},
        runtime,
      ),
    ).resolves.toEqual({
      event: 'm2_p0c_exception_summary',
      outcome: 'ready',
      summary: ADJUDICATION_SUMMARY,
    });
    const sample = await executeM1mMaintenance(
      {
        operation: 'ingest_exception_sample',
        batchId: BATCH_ID,
        exceptionCode: 'no_deterministic_tags',
        status: 'pending',
        scope: 'current',
        limit: 20,
      },
      runtime,
    );
    expect(sample).toMatchObject({
      event: 'm2_p0c_exception_sample',
      outcome: 'ready',
      batchId: BATCH_ID,
      samples: [
        {
          entryId: '44444444-4444-4444-8444-444444444444',
          exceptionCode: 'no_deterministic_tags',
        },
      ],
    });
    expect(JSON.stringify(sample)).not.toMatch(/body|title|source|provider/iu);
    await expect(
      executeM1mMaintenance(
        {
          operation: 'ingest_exception_adjudicate',
          batchId: BATCH_ID,
          exceptionCode: 'no_deterministic_tags',
          fromStatus: 'pending',
          toStatus: 'accepted',
          expectedCount: 2,
        },
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm2_p0c_exception_adjudicated',
      outcome: 'applied',
      appliedCount: 2,
    });
    expect(runtime.summarizeIngestionExceptions.mock.calls).toHaveLength(1);
    expect(runtime.sampleIngestionExceptions.mock.calls).toHaveLength(1);
    expect(runtime.adjudicateIngestionExceptions.mock.calls).toHaveLength(1);
  });

  it('executes and reports enrichment without returning Entry content', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance(
        {
          operation: 'ingest_enrich_execute',
          mode: 'run',
          batchId: BATCH_ID,
          maxItems: 40,
        },
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm2_p0b_enrichment_executed',
      outcome: 'succeeded',
      rulesSha256: 'e'.repeat(64),
    });
    const report = await executeM1mMaintenance(
      {operation: 'ingest_enrich_report', batchId: BATCH_ID},
      runtime,
    );
    expect(report).toMatchObject({
      event: 'm2_p0b_enrichment_report',
      items: [{snapshotId: SNAPSHOT_ID, status: 'pending', exceptions: []}],
    });
    expect(JSON.stringify(report)).not.toMatch(/body|source|url|secret/iu);
    expect(runtime.executeIngestionEnrichment.mock.calls).toHaveLength(1);
    expect(runtime.loadIngestionEnrichment.mock.calls).toHaveLength(1);
  });

  it('plans, executes and reports a batch without returning source content', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance(
        {
          operation: 'ingest_plan',
          idempotencyKey: 'synthetic-batch-001',
          privacyScope: 'public_only',
          limit: 500,
        },
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm2_p0a_ingest_planned',
      outcome: 'planned',
      batch: {batchId: BATCH_ID, snapshotCount: 1, plannedEntryCount: 2},
    });
    await expect(
      executeM1mMaintenance(
        {
          operation: 'ingest_execute',
          mode: 'run',
          batchId: BATCH_ID,
          maxItems: 25,
        },
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm2_p0a_ingest_executed',
      outcome: 'succeeded',
    });
    const report = await executeM1mMaintenance(
      {operation: 'ingest_report', batchId: BATCH_ID},
      runtime,
    );
    expect(report).toMatchObject({
      event: 'm2_p0a_ingest_report',
      items: [{snapshotId: SNAPSHOT_ID, status: 'pending'}],
    });
    expect(JSON.stringify(report)).not.toContain('source');
    expect(runtime.planIngestion.mock.calls).toHaveLength(1);
    expect(runtime.executeIngestion.mock.calls).toHaveLength(1);
    expect(runtime.loadIngestion.mock.calls).toHaveLength(1);
  });

  it('preflights the database before reporting readiness', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance({operation: 'preflight'}, runtime),
    ).resolves.toEqual({
      event: 'm1m_preflight_completed',
      outcome: 'ready',
    });
    expect(runtime.checkReadiness.mock.calls).toHaveLength(1);
    expect(runtime.backup.mock.calls).toHaveLength(0);
  });

  it('reports operational attention without hiding it behind readiness', async () => {
    const runtime = createRuntime({ready: false});
    const request = {
      operation: 'operational_status' as const,
      maxBackupAgeHours: 168,
      minimumFreePercent: 10,
      maxRunningAgeMinutes: 60,
    };

    await expect(
      executeM1mMaintenance(request, runtime),
    ).resolves.toMatchObject({
      event: 'm2_p5c_operational_status',
      outcome: 'attention',
      alerts: [{code: 'database_unavailable'}],
    });
    expect(runtime.checkReadiness.mock.calls).toHaveLength(0);
    expect(runtime.observeOperationalStatus.mock.calls).toEqual([[request]]);
  });

  it('creates a complete backup summary and restores only the named package', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance({operation: 'backup'}, runtime),
    ).resolves.toEqual({
      event: 'm1m_backup_created',
      outcome: 'succeeded',
      fileName: SUMMARY.fileName,
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      blobCount: 2,
      tableRowCount: 7,
    });
    await expect(
      executeM1mMaintenance(
        {operation: 'restore', fileName: SUMMARY.fileName},
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm1m_restore_completed',
      outcome: 'succeeded',
      fileName: SUMMARY.fileName,
    });
    expect(runtime.restore.mock.calls).toEqual([[SUMMARY.fileName]]);
  });

  it('lists, verifies and previews backup retention without database readiness', async () => {
    const runtime = createRuntime({ready: false});
    await expect(
      executeM1mMaintenance({operation: 'backup_list', limit: 20}, runtime),
    ).resolves.toEqual({
      event: 'm2_p5b_backup_catalog',
      outcome: 'ready',
      totalCount: 1,
      backups: [
        {
          fileName: SUMMARY.fileName,
          exportedAt: SUMMARY.exportedAt,
          byteLength: SUMMARY.byteLength,
        },
      ],
    });
    await expect(
      executeM1mMaintenance(
        {operation: 'backup_verify', fileName: SUMMARY.fileName},
        runtime,
      ),
    ).resolves.toEqual({
      event: 'm2_p5b_backup_verified',
      outcome: 'succeeded',
      fileName: SUMMARY.fileName,
      exportedAt: SUMMARY.exportedAt,
      byteLength: SUMMARY.byteLength,
      sha256: SUMMARY.sha256,
      blobCount: 2,
      tableRowCount: 7,
      personalDataIncluded: true,
    });
    await expect(
      executeM1mMaintenance(
        {operation: 'backup_retention_preview', keepLatest: 7},
        runtime,
      ),
    ).resolves.toEqual({
      event: 'm2_p5b_backup_retention_preview',
      outcome: 'ready',
      keepLatest: 7,
      totalCount: 9,
      retainedCount: 7,
      removalCandidateCount: 2,
      removalCandidates: ['synthetic-old-a.personal-data.json'],
      truncated: true,
    });
    expect(runtime.checkReadiness.mock.calls).toHaveLength(0);
    expect(runtime.verifyBackup.mock.calls).toEqual([[SUMMARY.fileName]]);
  });

  it('fails closed when readiness or a transfer operation fails', async () => {
    const unavailable = createRuntime({ready: false});
    await expect(
      executeM1mMaintenance({operation: 'backup'}, unavailable),
    ).rejects.toEqual(new M1mMaintenanceError('database_not_ready'));
    expect(unavailable.backup.mock.calls).toHaveLength(0);

    const failed = createRuntime({backupFailure: true});
    await expect(
      executeM1mMaintenance({operation: 'backup'}, failed),
    ).rejects.toEqual(new M1mMaintenanceError('operation_failed'));
  });
});

function createRuntime(
  options: {
    readonly ready?: boolean;
    readonly backupFailure?: boolean;
  } = {},
): M1mMaintenanceRuntimePort & {
  checkReadiness: ReturnType<typeof vi.fn>;
  observeOperationalStatus: ReturnType<typeof vi.fn>;
  backup: ReturnType<typeof vi.fn>;
  listBackups: ReturnType<typeof vi.fn>;
  verifyBackup: ReturnType<typeof vi.fn>;
  previewBackupRetention: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  planIngestion: ReturnType<typeof vi.fn>;
  executeIngestion: ReturnType<typeof vi.fn>;
  pauseIngestion: ReturnType<typeof vi.fn>;
  loadIngestion: ReturnType<typeof vi.fn>;
  executeIngestionEnrichment: ReturnType<typeof vi.fn>;
  loadIngestionEnrichment: ReturnType<typeof vi.fn>;
  summarizeIngestionExceptions: ReturnType<typeof vi.fn>;
  sampleIngestionExceptions: ReturnType<typeof vi.fn>;
  adjudicateIngestionExceptions: ReturnType<typeof vi.fn>;
} {
  const checkReadiness = vi.fn(() => Promise.resolve(options.ready ?? true));
  const observeOperationalStatus = vi.fn(
    (thresholds: Readonly<M2P5cOperationalStatusThresholds>) =>
      Promise.resolve({
        event: 'm2_p5c_operational_status' as const,
        outcome: 'attention' as const,
        observedAt: '2040-01-02T03:04:05.000Z',
        thresholds: Object.freeze({...thresholds}),
        database: Object.freeze({status: 'unavailable' as const}),
        dataRoot: Object.freeze({
          status: 'ready' as const,
          capacity: Object.freeze({
            totalBytes: '10000',
            availableBytes: '5000',
            availablePercentBasisPoints: 5000,
          }),
        }),
        backups: Object.freeze({status: 'ready' as const, totalCount: 0}),
        alerts: Object.freeze([
          Object.freeze({
            code: 'database_unavailable' as const,
            severity: 'critical' as const,
          }),
        ]),
      }),
  );
  const backup = vi.fn(() =>
    options.backupFailure
      ? Promise.reject(new Error('synthetic private failure'))
      : Promise.resolve(SUMMARY),
  );
  const restore = vi.fn(() => Promise.resolve(SUMMARY));
  const listBackups = vi.fn(() =>
    Promise.resolve({
      totalCount: 1,
      entries: [
        {
          fileName: SUMMARY.fileName,
          exportedAt: SUMMARY.exportedAt,
          byteLength: SUMMARY.byteLength,
        },
      ],
    }),
  );
  const verifyBackup = vi.fn(() => Promise.resolve(SUMMARY));
  const previewBackupRetention = vi.fn(() =>
    Promise.resolve({
      keepLatest: 7,
      totalCount: 9,
      retainedCount: 7,
      removalCandidateCount: 2,
      removalCandidates: ['synthetic-old-a.personal-data.json'],
      truncated: true,
    }),
  );
  const planIngestion = vi.fn(() =>
    Promise.resolve({outcome: 'created' as const, batch: BATCH}),
  );
  const executeIngestion = vi.fn(() =>
    Promise.resolve({outcome: 'succeeded' as const, batch: BATCH}),
  );
  const pauseIngestion = vi.fn(() => Promise.resolve(BATCH));
  const loadIngestion = vi.fn(() => Promise.resolve(BATCH));
  const executeIngestionEnrichment = vi.fn(() =>
    Promise.resolve({
      outcome: 'succeeded' as const,
      batch: ENRICHMENT_BATCH,
      rulesSha256: 'e'.repeat(64),
    }),
  );
  const loadIngestionEnrichment = vi.fn(() =>
    Promise.resolve(ENRICHMENT_BATCH),
  );
  const summarizeIngestionExceptions = vi.fn(() =>
    Promise.resolve(ADJUDICATION_SUMMARY),
  );
  const sampleIngestionExceptions = vi.fn(() =>
    Promise.resolve(
      Object.freeze([
        Object.freeze({
          sampleRank: 1,
          ordinal: 0,
          snapshotId: SNAPSHOT_ID,
          isPrivate: false,
          entryId: '44444444-4444-4444-8444-444444444444',
          entryRevision: 1,
          entryRevisionId: '55555555-5555-4555-8555-555555555555',
          isCurrent: true,
          exceptionCode: 'no_deterministic_tags' as const,
          status: 'pending' as const,
          version: 1,
        }),
      ]),
    ),
  );
  const adjudicateIngestionExceptions = vi.fn(() =>
    Promise.resolve({
      outcome: 'applied' as const,
      appliedCount: 2,
      summary: ADJUDICATION_SUMMARY,
    }),
  );
  const exportIngestionReviewPacket = vi.fn(() =>
    Promise.resolve({outcome: 'empty' as const}),
  );
  const applyIngestionReviewResult = vi.fn(() =>
    Promise.resolve({
      outcome: 'unchanged' as const,
      packetId: '77777777-7777-4777-8777-777777777777',
      itemCount: 1,
      annotatedCount: 0,
      acceptedCount: 1,
      manualReviewCount: 0,
      deferredCount: 0,
      revisedEntryCount: 0,
      adjudicatedCount: 0,
      associationProjectionCount: 0,
    }),
  );
  const previewIngestionTypeCompletion = vi.fn(() =>
    Promise.resolve(TYPE_COMPLETION_PREVIEW),
  );
  const applyIngestionTypeCompletion = vi.fn(() =>
    Promise.resolve({
      outcome: 'unchanged' as const,
      enrichmentStatus: 'succeeded' as const,
      before: TYPE_COMPLETION_PREVIEW,
      after: Object.freeze({
        ...TYPE_COMPLETION_PREVIEW,
        assignableCount: 0,
        unresolvedCount: 1,
        nextAction: 'export_codex_review' as const,
      }),
      nextAction: 'export_codex_review' as const,
    }),
  );
  const exportEntryTypeLearningPacket = vi.fn(() =>
    Promise.resolve({outcome: 'empty' as const}),
  );
  const applyEntryTypeLearningResult = vi.fn(() =>
    Promise.resolve({
      outcome: 'applied' as const,
      profileRevision: 1,
      trustedExampleCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    }),
  );
  const activateEntryTypeLearning = vi.fn(() =>
    Promise.resolve({
      outcome: 'not_eligible' as const,
      profileRevision: 0,
    }),
  );
  const pipelineStatus = Object.freeze({
    batchId: BATCH.batchId,
    stage: 'complete' as const,
    outcome: 'complete' as const,
    nextAction: 'none' as const,
    materialization: Object.freeze({
      status: 'succeeded',
      snapshotCount: 1,
      succeededSnapshotCount: 1,
      succeededEntryCount: 2,
      failedSnapshotCount: 0,
    }),
  });
  const startIngestionPipeline = vi.fn(() =>
    Promise.resolve({
      outcome: 'started' as const,
      status: pipelineStatus,
    }),
  );
  const advanceIngestionPipeline = vi.fn(() => Promise.resolve(pipelineStatus));
  const loadIngestionPipelineStatus = vi.fn(() =>
    Promise.resolve(pipelineStatus),
  );
  return {
    checkReadiness,
    observeOperationalStatus,
    backup,
    listBackups,
    verifyBackup,
    previewBackupRetention,
    restore,
    planIngestion,
    executeIngestion,
    pauseIngestion,
    loadIngestion,
    executeIngestionEnrichment,
    loadIngestionEnrichment,
    summarizeIngestionExceptions,
    sampleIngestionExceptions,
    adjudicateIngestionExceptions,
    exportIngestionReviewPacket,
    applyIngestionReviewResult,
    previewIngestionTypeCompletion,
    applyIngestionTypeCompletion,
    exportEntryTypeLearningPacket,
    applyEntryTypeLearningResult,
    activateEntryTypeLearning,
    startIngestionPipeline,
    advanceIngestionPipeline,
    loadIngestionPipelineStatus,
    close: () => Promise.resolve(),
  };
}

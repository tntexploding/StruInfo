import {describe, expect, it, vi} from 'vitest';

import type {BulkIngestionBatch} from './bulk_ingestion_contract.js';
import type {BulkIngestionEnrichmentBatch} from './bulk_ingestion_enrichment_contract.js';
import {BulkIngestionPipelineService} from './bulk_ingestion_pipeline_service.js';

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

describe('M2-P0G bulk ingestion pipeline', () => {
  it('starts P0A and P0B in order and stops at explicit review', async () => {
    const ingestionExecute = vi.fn().mockResolvedValue({
      outcome: 'succeeded',
      batch: ingestionBatch('succeeded'),
    });
    const enrichmentExecute = vi.fn().mockResolvedValue({
      outcome: 'succeeded',
      batch: enrichmentBatch('succeeded'),
      rulesSha256: 'a'.repeat(64),
    });
    const service = new BulkIngestionPipelineService({
      ingestion: {
        plan: vi.fn().mockResolvedValue({
          outcome: 'created',
          batch: ingestionBatch('planned'),
        }),
        load: vi.fn().mockResolvedValue(ingestionBatch('planned')),
        execute: ingestionExecute,
      },
      enrichment: {
        load: vi.fn().mockResolvedValue(enrichmentBatch('planned')),
        execute: enrichmentExecute,
      },
      adjudication: {
        summarize: vi.fn().mockResolvedValue(reviewSummary(2)),
      },
    });

    await expect(
      service.start({
        idempotencyKey: 'synthetic-batch',
        privacyScope: 'public_only',
        limit: 500,
        maxItems: 500,
      }),
    ).resolves.toMatchObject({
      outcome: 'started',
      status: {
        stage: 'review',
        outcome: 'review_required',
        nextAction: 'export_review_packet',
        review: {pendingCount: 2, reviewComplete: false},
      },
    });
    expect(ingestionExecute).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 500,
    });
    expect(enrichmentExecute).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 500,
    });
  });

  it('reports a complete batch without starting another attempt', async () => {
    const ingestionExecute = vi.fn();
    const enrichmentExecute = vi.fn();
    const service = new BulkIngestionPipelineService({
      ingestion: {
        plan: vi.fn(),
        load: vi.fn().mockResolvedValue(ingestionBatch('succeeded')),
        execute: ingestionExecute,
      },
      enrichment: {
        load: vi.fn().mockResolvedValue(enrichmentBatch('succeeded')),
        execute: enrichmentExecute,
      },
      adjudication: {
        summarize: vi.fn().mockResolvedValue(reviewSummary(0)),
      },
    });

    await expect(service.status(BATCH_ID)).resolves.toMatchObject({
      stage: 'complete',
      outcome: 'complete',
      nextAction: 'none',
      review: {pendingCount: 0, reviewComplete: true},
    });
    expect(ingestionExecute).not.toHaveBeenCalled();
    expect(enrichmentExecute).not.toHaveBeenCalled();
  });

  it('uses resume for a bounded paused window and does not spin', async () => {
    const ingestionExecute = vi.fn().mockResolvedValue({
      outcome: 'paused',
      batch: ingestionBatch('paused'),
    });
    const enrichmentExecute = vi.fn();
    const service = new BulkIngestionPipelineService({
      ingestion: {
        plan: vi.fn(),
        load: vi.fn().mockResolvedValue(ingestionBatch('paused')),
        execute: ingestionExecute,
      },
      enrichment: {
        load: vi.fn(),
        execute: enrichmentExecute,
      },
      adjudication: {summarize: vi.fn()},
    });

    await expect(
      service.advance({batchId: BATCH_ID, maxItems: 25}),
    ).resolves.toMatchObject({
      stage: 'materialize',
      outcome: 'paused',
      nextAction: 'advance',
    });
    expect(ingestionExecute).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      mode: 'resume',
      maxItems: 25,
    });
    expect(enrichmentExecute).not.toHaveBeenCalled();
  });
});

function ingestionBatch(
  status: BulkIngestionBatch['status'],
): Readonly<BulkIngestionBatch> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    idempotencyKey: 'synthetic-batch',
    requestSha256: 'a'.repeat(64),
    planSha256: 'b'.repeat(64),
    privacyScope: 'public_only',
    status,
    attempt: status === 'planned' ? 0 : 1,
    snapshotCount: 2,
    plannedEntryCount: 60,
    succeededSnapshotCount: status === 'succeeded' ? 2 : 1,
    succeededEntryCount: status === 'succeeded' ? 60 : 30,
    failedSnapshotCount: status === 'failed' ? 1 : 0,
    version: 1,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    items: Object.freeze([]),
  });
}

function enrichmentBatch(
  status: BulkIngestionEnrichmentBatch['status'],
): Readonly<BulkIngestionEnrichmentBatch> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    privacyScope: 'public_only',
    status,
    attempt: status === 'planned' ? 0 : 1,
    snapshotCount: 2,
    plannedEntryCount: 60,
    succeededSnapshotCount: status === 'succeeded' ? 2 : 1,
    succeededEntryCount: status === 'succeeded' ? 60 : 30,
    revisedEntryCount: 40,
    addedTagCount: 80,
    associationProjectionCount: 20,
    exceptionEntryCount: 2,
    failedSnapshotCount: status === 'failed' ? 1 : 0,
    pendingSnapshotCount: status === 'succeeded' ? 0 : 1,
    runningSnapshotCount: 0,
    items: Object.freeze([]),
  });
}

function reviewSummary(pendingCount: number) {
  return Object.freeze({
    batchId: BATCH_ID,
    totalExceptionCount: 2,
    currentExceptionCount: 2,
    staleExceptionCount: 0,
    pendingCount,
    acceptedCount: 2 - pendingCount,
    manualReviewCount: 0,
    deferredCount: 0,
    reviewComplete: pendingCount === 0,
    groups: Object.freeze([]),
  });
}

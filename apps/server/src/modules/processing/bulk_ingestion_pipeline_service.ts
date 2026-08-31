import type {BulkIngestionAdjudicationService} from './bulk_ingestion_adjudication_service.js';
import type {BulkIngestionEnrichmentService} from './bulk_ingestion_enrichment_service.js';
import type {BulkIngestionService} from './bulk_ingestion_service.js';
import {
  type AdvanceBulkIngestionPipelineRequest,
  type BulkIngestionPipelineStatus,
  type StartBulkIngestionPipelineRequest,
  type StartBulkIngestionPipelineResult,
} from './bulk_ingestion_pipeline_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type BulkIngestionPipelineServiceErrorCode =
  'input_invalid' | 'batch_busy';

export class BulkIngestionPipelineServiceError extends Error {
  public readonly code: BulkIngestionPipelineServiceErrorCode;

  public constructor(code: BulkIngestionPipelineServiceErrorCode) {
    super('The bulk ingestion pipeline operation failed.');
    this.name = 'BulkIngestionPipelineServiceError';
    this.code = code;
  }
}

export interface BulkIngestionPipelineServiceDependencies {
  readonly ingestion: Pick<BulkIngestionService, 'plan' | 'load' | 'execute'>;
  readonly enrichment: Pick<BulkIngestionEnrichmentService, 'load' | 'execute'>;
  readonly adjudication: Pick<BulkIngestionAdjudicationService, 'summarize'>;
}

export class BulkIngestionPipelineService {
  readonly #dependencies: Readonly<BulkIngestionPipelineServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionPipelineServiceDependencies>,
  ) {
    this.#dependencies = dependencies;
  }

  public async start(
    request: Readonly<StartBulkIngestionPipelineRequest>,
  ): Promise<Readonly<StartBulkIngestionPipelineResult>> {
    if (!validStart(request)) {
      throw new BulkIngestionPipelineServiceError('input_invalid');
    }
    const planned = await this.#dependencies.ingestion.plan(request);
    if (planned.outcome === 'empty') {
      return Object.freeze({outcome: 'empty' as const});
    }
    const status = await this.advance({
      batchId: planned.batch.batchId,
      maxItems: request.maxItems,
    });
    return Object.freeze({
      outcome:
        planned.outcome === 'created'
          ? ('started' as const)
          : ('existing' as const),
      status,
    });
  }

  public async advance(
    request: Readonly<AdvanceBulkIngestionPipelineRequest>,
  ): Promise<Readonly<BulkIngestionPipelineStatus>> {
    if (!validAdvance(request)) {
      throw new BulkIngestionPipelineServiceError('input_invalid');
    }
    let ingestion = await this.#dependencies.ingestion.load(request.batchId);
    if (['running', 'pause_requested'].includes(ingestion.status)) {
      return summarizeMaterialization(ingestion, 'busy', 'wait');
    }
    if (ingestion.status !== 'succeeded') {
      const executed = await this.#dependencies.ingestion.execute({
        batchId: request.batchId,
        mode:
          ingestion.status === 'planned'
            ? 'run'
            : ingestion.status === 'failed'
              ? 'retry'
              : 'resume',
        maxItems: request.maxItems,
      });
      ingestion = executed.batch;
      if (ingestion.status !== 'succeeded') {
        return summarizeMaterialization(
          ingestion,
          ingestion.status === 'failed' ? 'failed' : 'paused',
          'advance',
        );
      }
    }

    let enrichment = await this.#dependencies.enrichment.load(request.batchId);
    if (enrichment.status === 'running') {
      return summarizeEnrichment(ingestion, enrichment, 'busy', 'wait');
    }
    if (enrichment.status !== 'succeeded') {
      const executed = await this.#dependencies.enrichment.execute({
        batchId: request.batchId,
        mode:
          enrichment.status === 'planned'
            ? 'run'
            : enrichment.status === 'failed'
              ? 'retry'
              : 'resume',
        maxItems: request.maxItems,
      });
      enrichment = executed.batch;
      if (enrichment.status !== 'succeeded') {
        return summarizeEnrichment(
          ingestion,
          enrichment,
          enrichment.status === 'failed' ? 'failed' : 'paused',
          'advance',
        );
      }
    }
    return this.#summarizeReview(ingestion, enrichment);
  }

  public async status(
    batchId: string,
  ): Promise<Readonly<BulkIngestionPipelineStatus>> {
    if (!CANONICAL_UUID.test(batchId)) {
      throw new BulkIngestionPipelineServiceError('input_invalid');
    }
    const ingestion = await this.#dependencies.ingestion.load(batchId);
    if (ingestion.status !== 'succeeded') {
      return summarizeMaterialization(
        ingestion,
        ['running', 'pause_requested'].includes(ingestion.status)
          ? 'busy'
          : ingestion.status === 'failed'
            ? 'failed'
            : ingestion.status === 'paused'
              ? 'paused'
              : 'ready',
        ['running', 'pause_requested'].includes(ingestion.status)
          ? 'wait'
          : 'advance',
      );
    }
    const enrichment = await this.#dependencies.enrichment.load(batchId);
    if (enrichment.status !== 'succeeded') {
      return summarizeEnrichment(
        ingestion,
        enrichment,
        enrichment.status === 'running'
          ? 'busy'
          : enrichment.status === 'failed'
            ? 'failed'
            : enrichment.status === 'paused'
              ? 'paused'
              : 'ready',
        enrichment.status === 'running' ? 'wait' : 'advance',
      );
    }
    return this.#summarizeReview(ingestion, enrichment);
  }

  async #summarizeReview(
    ingestion: Awaited<ReturnType<BulkIngestionService['load']>>,
    enrichment: Awaited<ReturnType<BulkIngestionEnrichmentService['load']>>,
  ): Promise<Readonly<BulkIngestionPipelineStatus>> {
    const review = await this.#dependencies.adjudication.summarize(
      ingestion.batchId,
    );
    const complete = review.reviewComplete;
    return Object.freeze({
      ...summarizeEnrichmentFields(ingestion, enrichment),
      stage: complete ? ('complete' as const) : ('review' as const),
      outcome: complete ? ('complete' as const) : ('review_required' as const),
      nextAction: complete
        ? ('none' as const)
        : ('export_review_packet' as const),
      review: Object.freeze({
        currentExceptionCount: review.currentExceptionCount,
        pendingCount: review.pendingCount,
        acceptedCount: review.acceptedCount,
        manualReviewCount: review.manualReviewCount,
        deferredCount: review.deferredCount,
        reviewComplete: review.reviewComplete,
      }),
    });
  }
}

function summarizeMaterialization(
  batch: Awaited<ReturnType<BulkIngestionService['load']>>,
  outcome: 'ready' | 'busy' | 'paused' | 'failed',
  nextAction: 'advance' | 'wait',
): Readonly<BulkIngestionPipelineStatus> {
  return Object.freeze({
    batchId: batch.batchId,
    stage: 'materialize' as const,
    outcome,
    nextAction,
    materialization: materializationFields(batch),
  });
}

function summarizeEnrichment(
  ingestion: Awaited<ReturnType<BulkIngestionService['load']>>,
  enrichment: Awaited<ReturnType<BulkIngestionEnrichmentService['load']>>,
  outcome: 'ready' | 'busy' | 'paused' | 'failed',
  nextAction: 'advance' | 'wait',
): Readonly<BulkIngestionPipelineStatus> {
  return Object.freeze({
    ...summarizeEnrichmentFields(ingestion, enrichment),
    stage: 'enrich' as const,
    outcome,
    nextAction,
  });
}

function summarizeEnrichmentFields(
  ingestion: Awaited<ReturnType<BulkIngestionService['load']>>,
  enrichment: Awaited<ReturnType<BulkIngestionEnrichmentService['load']>>,
) {
  return Object.freeze({
    batchId: ingestion.batchId,
    materialization: materializationFields(ingestion),
    enrichment: Object.freeze({
      status: enrichment.status,
      succeededSnapshotCount: enrichment.succeededSnapshotCount,
      revisedEntryCount: enrichment.revisedEntryCount,
      addedTagCount: enrichment.addedTagCount,
      associationProjectionCount: enrichment.associationProjectionCount,
      exceptionEntryCount: enrichment.exceptionEntryCount,
      failedSnapshotCount: enrichment.failedSnapshotCount,
    }),
  });
}

function materializationFields(
  batch: Awaited<ReturnType<BulkIngestionService['load']>>,
) {
  return Object.freeze({
    status: batch.status,
    snapshotCount: batch.snapshotCount,
    succeededSnapshotCount: batch.succeededSnapshotCount,
    succeededEntryCount: batch.succeededEntryCount,
    failedSnapshotCount: batch.failedSnapshotCount,
  });
}

function validStart(
  request: Readonly<StartBulkIngestionPipelineRequest>,
): boolean {
  return (
    typeof request.idempotencyKey === 'string' &&
    request.idempotencyKey.length > 0 &&
    request.idempotencyKey === request.idempotencyKey.trim() &&
    Array.from(request.idempotencyKey).length <= 160 &&
    ['public_only', 'include_private', 'private_only'].includes(
      request.privacyScope,
    ) &&
    boundedItems(request.limit) &&
    boundedItems(request.maxItems)
  );
}

function validAdvance(
  request: Readonly<AdvanceBulkIngestionPipelineRequest>,
): boolean {
  return CANONICAL_UUID.test(request.batchId) && boundedItems(request.maxItems);
}

function boundedItems(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 500;
}

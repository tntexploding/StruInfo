import {createHash} from 'node:crypto';

import {
  BULK_INGESTION_ADJUDICATION_STATUSES,
  type BulkIngestionAdjudicationException,
  type BulkIngestionAdjudicationGroup,
  type BulkIngestionAdjudicationPrerequisite,
  type BulkIngestionAdjudicationRepositoryPort,
  type BulkIngestionAdjudicationSample,
  type BulkIngestionAdjudicationSummary,
  type DecideExactBulkIngestionAdjudicationRequest,
  type DecideBulkIngestionAdjudicationRequest,
  type DecideBulkIngestionAdjudicationResult,
  type SampleBulkIngestionAdjudicationRequest,
} from './bulk_ingestion_adjudication_contract.js';
import {
  BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES,
  type BulkIngestionEnrichmentExceptionCode,
} from './bulk_ingestion_enrichment_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_SAMPLE_SIZE = 100;
const MAXIMUM_EXACT_DECISION_COUNT = 100;
const MAXIMUM_DECISION_COUNT = 50_000;

export type BulkIngestionAdjudicationServiceErrorCode =
  'input_invalid' | 'batch_invalid_state' | 'batch_not_found';

export class BulkIngestionAdjudicationServiceError extends Error {
  public readonly code: BulkIngestionAdjudicationServiceErrorCode;

  public constructor(code: BulkIngestionAdjudicationServiceErrorCode) {
    super('The bulk ingestion adjudication operation failed.');
    this.name = 'BulkIngestionAdjudicationServiceError';
    this.code = code;
  }
}

export interface BulkIngestionAdjudicationServiceDependencies {
  readonly workspaceId: string;
  readonly prerequisite: BulkIngestionAdjudicationPrerequisite;
  readonly repository: BulkIngestionAdjudicationRepositoryPort;
}

export class BulkIngestionAdjudicationService {
  readonly #dependencies: Readonly<BulkIngestionAdjudicationServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionAdjudicationServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionAdjudicationServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async summarize(
    batchId: string,
  ): Promise<Readonly<BulkIngestionAdjudicationSummary>> {
    const exceptions = await this.#load(batchId);
    return summarize(batchId, exceptions);
  }

  public list(
    batchId: string,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationException>[]> {
    return this.#load(batchId);
  }

  public async sample(
    request: Readonly<SampleBulkIngestionAdjudicationRequest>,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationSample>[]> {
    if (!validSampleRequest(request)) {
      throw new BulkIngestionAdjudicationServiceError('input_invalid');
    }
    const exceptions = (await this.#load(request.batchId))
      .filter(
        (exception) =>
          request.exceptionCode === undefined ||
          exception.exceptionCode === request.exceptionCode,
      )
      .filter(
        (exception) =>
          request.status === undefined || exception.status === request.status,
      )
      .filter((exception) => matchesScope(exception, request.scope))
      .sort((left, right) => {
        const leftKey = stableSampleKey(request.batchId, left);
        const rightKey = stableSampleKey(request.batchId, right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
      .slice(0, request.limit);
    return Object.freeze(
      exceptions.map((exception, index) =>
        Object.freeze({
          sampleRank: index + 1,
          ordinal: exception.ordinal,
          snapshotId: exception.snapshotId,
          isPrivate: exception.isPrivate,
          entryId: exception.entryId,
          entryRevision: exception.entryRevision,
          entryRevisionId: exception.entryRevisionId,
          isCurrent: exception.isCurrent,
          exceptionCode: exception.exceptionCode,
          status: exception.status,
          version: exception.version,
        }),
      ),
    );
  }

  public async decide(
    request: Readonly<DecideBulkIngestionAdjudicationRequest>,
  ): Promise<Readonly<DecideBulkIngestionAdjudicationResult>> {
    if (!validDecisionRequest(request)) {
      throw new BulkIngestionAdjudicationServiceError('input_invalid');
    }
    await this.#ensure(request.batchId);
    const transitioned = await this.#dependencies.repository.transition({
      workspaceId: this.#dependencies.workspaceId,
      ...request,
    });
    if (transitioned.outcome === 'not_found') {
      throw new BulkIngestionAdjudicationServiceError('batch_not_found');
    }
    const summary = summarize(
      request.batchId,
      await this.#dependencies.repository.loadExceptions(
        this.#dependencies.workspaceId,
        request.batchId,
      ),
    );
    return Object.freeze({
      outcome:
        transitioned.outcome === 'applied'
          ? ('applied' as const)
          : ('stale' as const),
      appliedCount: transitioned.appliedCount,
      summary,
    });
  }

  public async decideExact(
    request: Readonly<DecideExactBulkIngestionAdjudicationRequest>,
  ): Promise<Readonly<DecideBulkIngestionAdjudicationResult>> {
    if (!validExactDecisionRequest(request)) {
      throw new BulkIngestionAdjudicationServiceError('input_invalid');
    }
    await this.#ensure(request.batchId);
    const transitioned = await this.#dependencies.repository.transitionExact({
      workspaceId: this.#dependencies.workspaceId,
      batchId: request.batchId,
      decisions: request.decisions,
    });
    if (transitioned.outcome === 'not_found') {
      throw new BulkIngestionAdjudicationServiceError('batch_not_found');
    }
    const summary = summarize(
      request.batchId,
      await this.#dependencies.repository.loadExceptions(
        this.#dependencies.workspaceId,
        request.batchId,
      ),
    );
    return Object.freeze({
      outcome:
        transitioned.outcome === 'applied'
          ? ('applied' as const)
          : ('stale' as const),
      appliedCount: transitioned.appliedCount,
      summary,
    });
  }

  async #load(
    batchId: string,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationException>[]> {
    await this.#ensure(batchId);
    return this.#dependencies.repository.loadExceptions(
      this.#dependencies.workspaceId,
      batchId,
    );
  }

  async #ensure(batchId: string): Promise<void> {
    if (!CANONICAL_UUID.test(batchId)) {
      throw new BulkIngestionAdjudicationServiceError('input_invalid');
    }
    if (
      !(await this.#dependencies.prerequisite.ensureItems(
        this.#dependencies.workspaceId,
        batchId,
      ))
    ) {
      throw new BulkIngestionAdjudicationServiceError('batch_invalid_state');
    }
    if (
      !(await this.#dependencies.repository.ensureAdjudications(
        this.#dependencies.workspaceId,
        batchId,
      ))
    ) {
      throw new BulkIngestionAdjudicationServiceError('batch_invalid_state');
    }
  }
}

function summarize(
  batchId: string,
  exceptions: readonly Readonly<BulkIngestionAdjudicationException>[],
): Readonly<BulkIngestionAdjudicationSummary> {
  const current = exceptions.filter((exception) => exception.isCurrent);
  const groups = BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES.map((code) =>
    summarizeGroup(
      code,
      exceptions.filter((value) => value.exceptionCode === code),
    ),
  ).filter((group) => group.totalCount > 0);
  const count = (
    status: (typeof BULK_INGESTION_ADJUDICATION_STATUSES)[number],
  ) => current.filter((exception) => exception.status === status).length;
  const pendingCount = count('pending');
  return Object.freeze({
    batchId,
    totalExceptionCount: exceptions.length,
    currentExceptionCount: current.length,
    staleExceptionCount: exceptions.length - current.length,
    pendingCount,
    acceptedCount: count('accepted'),
    manualReviewCount: count('manual_review'),
    deferredCount: count('deferred'),
    reviewComplete: pendingCount === 0,
    groups: Object.freeze(groups),
  });
}

function summarizeGroup(
  exceptionCode: BulkIngestionEnrichmentExceptionCode,
  exceptions: readonly Readonly<BulkIngestionAdjudicationException>[],
): Readonly<BulkIngestionAdjudicationGroup> {
  const current = exceptions.filter((exception) => exception.isCurrent);
  const count = (
    status: (typeof BULK_INGESTION_ADJUDICATION_STATUSES)[number],
  ) => current.filter((exception) => exception.status === status).length;
  return Object.freeze({
    exceptionCode,
    totalCount: exceptions.length,
    currentCount: current.length,
    staleCount: exceptions.length - current.length,
    pendingCount: count('pending'),
    acceptedCount: count('accepted'),
    manualReviewCount: count('manual_review'),
    deferredCount: count('deferred'),
  });
}

function validSampleRequest(
  request: Readonly<SampleBulkIngestionAdjudicationRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.batchId) &&
    (request.exceptionCode === undefined ||
      BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES.includes(
        request.exceptionCode,
      )) &&
    (request.status === undefined ||
      BULK_INGESTION_ADJUDICATION_STATUSES.includes(request.status)) &&
    ['current', 'stale', 'all'].includes(request.scope) &&
    Number.isSafeInteger(request.limit) &&
    request.limit >= 1 &&
    request.limit <= MAXIMUM_SAMPLE_SIZE
  );
}

function validDecisionRequest(
  request: Readonly<DecideBulkIngestionAdjudicationRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.batchId) &&
    BULK_INGESTION_ENRICHMENT_EXCEPTION_CODES.includes(request.exceptionCode) &&
    BULK_INGESTION_ADJUDICATION_STATUSES.includes(request.fromStatus) &&
    BULK_INGESTION_ADJUDICATION_STATUSES.includes(request.toStatus) &&
    request.fromStatus !== request.toStatus &&
    Number.isSafeInteger(request.expectedCount) &&
    request.expectedCount >= 1 &&
    request.expectedCount <= MAXIMUM_DECISION_COUNT
  );
}

function validExactDecisionRequest(
  request: Readonly<DecideExactBulkIngestionAdjudicationRequest>,
): boolean {
  if (
    !CANONICAL_UUID.test(request.batchId) ||
    request.decisions.length < 1 ||
    request.decisions.length > MAXIMUM_EXACT_DECISION_COUNT
  ) {
    return false;
  }
  const identities = new Set<string>();
  for (const decision of request.decisions) {
    const identity = `${decision.ordinal.toString()}:${decision.entryId}`;
    if (
      !Number.isSafeInteger(decision.ordinal) ||
      decision.ordinal < 0 ||
      !CANONICAL_UUID.test(decision.entryId) ||
      !Number.isSafeInteger(decision.entryRevision) ||
      decision.entryRevision < 1 ||
      !CANONICAL_UUID.test(decision.entryRevisionId) ||
      !Number.isSafeInteger(decision.expectedVersion) ||
      decision.expectedVersion < 1 ||
      !BULK_INGESTION_ADJUDICATION_STATUSES.includes(decision.fromStatus) ||
      !BULK_INGESTION_ADJUDICATION_STATUSES.includes(decision.toStatus) ||
      decision.fromStatus === decision.toStatus ||
      !Number.isSafeInteger(decision.expectedCurrentEntryRevision) ||
      decision.expectedCurrentEntryRevision < 1 ||
      !CANONICAL_UUID.test(decision.expectedCurrentEntryRevisionId) ||
      identities.has(identity)
    ) {
      return false;
    }
    identities.add(identity);
  }
  return true;
}

function matchesScope(
  exception: Readonly<BulkIngestionAdjudicationException>,
  scope: SampleBulkIngestionAdjudicationRequest['scope'],
): boolean {
  return scope === 'all' || (scope === 'current') === exception.isCurrent;
}

function stableSampleKey(
  batchId: string,
  exception: Readonly<BulkIngestionAdjudicationException>,
): string {
  return createHash('sha256')
    .update(
      `${batchId}:${exception.exceptionCode}:${exception.entryId}`,
      'utf8',
    )
    .digest('hex');
}

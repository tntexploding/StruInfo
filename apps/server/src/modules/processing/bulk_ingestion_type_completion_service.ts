import {createHash} from 'node:crypto';

import {
  buildInformationEntryClassificationContext,
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type DeterministicClassificationDiagnosticReason,
  type EntryTypeKeyword,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {ReviewPreferencesStore} from '../../storage/review_preferences_store.js';
import type {BulkIngestionAdjudicationException} from './bulk_ingestion_adjudication_contract.js';
import type {
  BulkIngestionEnrichmentBatch,
  BulkIngestionEnrichmentExceptionCode,
  BulkIngestionEnrichmentMode,
  ExecuteBulkIngestionEnrichmentRequest,
  ExecuteBulkIngestionEnrichmentResult,
} from './bulk_ingestion_enrichment_contract.js';
import {
  type ApplyBulkIngestionTypeCompletionRequest,
  type ApplyBulkIngestionTypeCompletionResult,
  type BulkIngestionTypeCompletionPreview,
  type BulkIngestionTypeCompletionSample,
  type PreviewBulkIngestionTypeCompletionRequest,
} from './bulk_ingestion_type_completion_contract.js';
import type {ProcessingPrivacyScope} from './processing_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_SAMPLE_LIMIT = 50;
const MAXIMUM_APPLY_ITEMS = 500;
const HYDRATION_CHUNK_SIZE = 100;
const TYPE_COMPLETION_EXCEPTION_CODES = Object.freeze([
  'classification_incomplete',
  'classification_no_signal',
  'classification_type_missing',
  'classification_tied',
] as const satisfies readonly BulkIngestionEnrichmentExceptionCode[]);
const DIAGNOSTIC_REASONS = Object.freeze([
  'assigned',
  'no_signal',
  'below_threshold',
  'tied',
  'low_margin',
] as const satisfies readonly DeterministicClassificationDiagnosticReason[]);

export type BulkIngestionTypeCompletionServiceErrorCode =
  'input_invalid' | 'batch_invalid_state';

export class BulkIngestionTypeCompletionServiceError extends Error {
  public readonly code: BulkIngestionTypeCompletionServiceErrorCode;

  public constructor(code: BulkIngestionTypeCompletionServiceErrorCode) {
    super('The bulk ingestion type completion operation failed.');
    this.name = 'BulkIngestionTypeCompletionServiceError';
    this.code = code;
  }
}

interface TypeCompletionAdjudicationPort {
  loadExceptions(
    workspaceId: string,
    batchId: string,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationException>[]>;
}

interface TypeCompletionEnrichmentPort {
  load(batchId: string): Promise<Readonly<BulkIngestionEnrichmentBatch>>;
  execute(
    request: Readonly<ExecuteBulkIngestionEnrichmentRequest>,
  ): Promise<Readonly<ExecuteBulkIngestionEnrichmentResult>>;
}

export interface BulkIngestionTypeCompletionServiceDependencies {
  readonly workspaceId: string;
  readonly entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntries' | 'loadCurrentEntriesByIds'
  >;
  readonly adjudication: TypeCompletionAdjudicationPort;
  readonly enrichment: TypeCompletionEnrichmentPort;
  readonly preferences: ReviewPreferencesStore;
}

interface CandidateResult {
  readonly exception: Readonly<BulkIngestionAdjudicationException>;
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly diagnostic: ReturnType<
    typeof classifyInformationEntryDeterministically
  >['diagnostics']['type'];
  readonly predictedType?: EntryTypeKeyword;
}

export class BulkIngestionTypeCompletionService {
  readonly #dependencies: Readonly<BulkIngestionTypeCompletionServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionTypeCompletionServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionTypeCompletionServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async preview(
    request: Readonly<PreviewBulkIngestionTypeCompletionRequest>,
  ): Promise<Readonly<BulkIngestionTypeCompletionPreview>> {
    if (!validPreviewRequest(request)) {
      throw new BulkIngestionTypeCompletionServiceError('input_invalid');
    }
    const allExceptions = await this.#dependencies.adjudication.loadExceptions(
      this.#dependencies.workspaceId,
      request.batchId,
    );
    const relevant = allExceptions.filter((exception) =>
      TYPE_COMPLETION_EXCEPTION_CODES.includes(
        exception.exceptionCode as (typeof TYPE_COMPLETION_EXCEPTION_CODES)[number],
      ),
    );
    const staleExceptionCount = relevant.filter(
      (exception) => !exception.isCurrent,
    ).length;
    const protectedDecisionCount = relevant.filter(
      (exception) => exception.isCurrent && exception.status !== 'pending',
    ).length;
    const pendingCurrent = relevant.filter(
      (exception) => exception.isCurrent && exception.status === 'pending',
    );
    const scopeExcludedCount = pendingCurrent.filter(
      (exception) =>
        !matchesPrivacyScope(exception.isPrivate, request.privacyScope),
    ).length;
    const scoped = deduplicateExceptions(
      pendingCurrent.filter((exception) =>
        matchesPrivacyScope(exception.isPrivate, request.privacyScope),
      ),
    );
    const hydrated = await this.#loadEntries(
      scoped.map((exception) => exception.entryId),
      request.privacyScope,
    );
    const entriesById = new Map(
      hydrated.map((entry) => [entry.entryId, entry]),
    );
    const preferences = await this.#dependencies.preferences.load(
      this.#dependencies.workspaceId,
    );
    const profile =
      preferences.entryClassificationProfile ??
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
    const includePrivate = request.privacyScope !== 'public_only';
    const referenceEntries = (
      await this.#dependencies.entries.loadCurrentEntries(
        this.#dependencies.workspaceId,
        includePrivate,
      )
    ).filter((entry) =>
      matchesPrivacyScope(entry.value.isPrivate, request.privacyScope),
    );
    const classificationContext = buildInformationEntryClassificationContext(
      referenceEntries,
      profile.neighborPolicy,
    );
    const candidates: CandidateResult[] = [];
    let staleEntryCount = 0;
    let alreadyClassifiedCount = 0;
    for (const exception of scoped) {
      const entry = entriesById.get(exception.entryId);
      if (entry === undefined) {
        staleEntryCount += 1;
        continue;
      }
      if (
        entry.revision !== exception.currentEntryRevision ||
        entry.revisionId !== exception.currentEntryRevisionId ||
        entry.value.isPrivate !== exception.isPrivate
      ) {
        staleEntryCount += 1;
        continue;
      }
      if (entry.value.typeKeyword !== undefined) {
        alreadyClassifiedCount += 1;
        continue;
      }
      const classification = classifyInformationEntryDeterministically({
        titlePath: entry.value.titlePath,
        body: entry.value.body,
        contentKeywords: entry.value.contentKeywords.map(
          (keyword) => keyword.displayValue,
        ),
        chunkMode: entry.value.chunkMode,
        profile,
        neighborEvidence: classificationContext.evidenceFor(entry),
      });
      candidates.push(
        Object.freeze({
          exception,
          entry,
          diagnostic: classification.diagnostics.type,
          ...(classification.typeKeyword === undefined
            ? {}
            : {predictedType: classification.typeKeyword}),
        }),
      );
    }
    const assignableCount = candidates.filter(
      (candidate) => candidate.predictedType !== undefined,
    ).length;
    const neighborAssignableCount = candidates.filter(
      (candidate) =>
        candidate.predictedType !== undefined &&
        candidate.diagnostic.evidenceSource === 'neighbor_consensus',
    ).length;
    const unresolvedCount = candidates.length - assignableCount;
    const samples = stableSamples(
      request.batchId,
      candidates,
      request.sampleLimit,
    );
    return Object.freeze({
      batchId: request.batchId,
      privacyScope: request.privacyScope,
      ruleVersion: DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
      profileRevision: profile.revision,
      candidateExceptionCount: scoped.length,
      staleExceptionCount,
      protectedDecisionCount,
      scopeExcludedCount,
      staleEntryCount,
      alreadyClassifiedCount,
      missingTypeCount: candidates.length,
      assignableCount,
      neighborAssignableCount,
      unresolvedCount,
      byPredictedType: Object.freeze(
        ENTRY_TYPE_KEYWORDS.map((typeKeyword) =>
          Object.freeze({
            typeKeyword,
            count: candidates.filter(
              (candidate) => candidate.predictedType === typeKeyword,
            ).length,
          }),
        ),
      ),
      byReason: Object.freeze(
        DIAGNOSTIC_REASONS.map((reason) =>
          Object.freeze({
            reason,
            count: candidates.filter(
              (candidate) => candidate.diagnostic.reason === reason,
            ).length,
          }),
        ),
      ),
      byExceptionCode: Object.freeze(
        TYPE_COMPLETION_EXCEPTION_CODES.map((exceptionCode) =>
          Object.freeze({
            exceptionCode,
            count: scoped.filter(
              (exception) => exception.exceptionCode === exceptionCode,
            ).length,
          }),
        ),
      ),
      samples,
      nextAction:
        assignableCount > 0
          ? ('apply_type_completion' as const)
          : unresolvedCount > 0
            ? ('export_codex_review' as const)
            : ('none' as const),
    });
  }

  public async apply(
    request: Readonly<ApplyBulkIngestionTypeCompletionRequest>,
  ): Promise<Readonly<ApplyBulkIngestionTypeCompletionResult>> {
    if (!validApplyRequest(request)) {
      throw new BulkIngestionTypeCompletionServiceError('input_invalid');
    }
    const batch = await this.#dependencies.enrichment.load(request.batchId);
    const before = await this.preview({
      batchId: request.batchId,
      privacyScope: batch.privacyScope,
      sampleLimit: request.sampleLimit,
    });
    if (before.assignableCount === 0) {
      return Object.freeze({
        outcome: 'unchanged' as const,
        enrichmentStatus: batch.status,
        before,
        after: before,
        nextAction:
          before.unresolvedCount > 0
            ? ('export_codex_review' as const)
            : ('none' as const),
      });
    }
    const enrichmentMode = modeForStatus(batch.status);
    const executed = await this.#dependencies.enrichment.execute({
      batchId: request.batchId,
      mode: enrichmentMode,
      maxItems: request.maxItems,
    });
    const after = await this.preview({
      batchId: request.batchId,
      privacyScope: batch.privacyScope,
      sampleLimit: request.sampleLimit,
    });
    const nextAction =
      executed.outcome !== 'succeeded' || after.assignableCount > 0
        ? ('continue_apply' as const)
        : after.unresolvedCount > 0
          ? ('export_codex_review' as const)
          : ('none' as const);
    return Object.freeze({
      outcome: executed.outcome,
      enrichmentMode,
      enrichmentStatus: executed.batch.status,
      rulesSha256: executed.rulesSha256,
      before,
      after,
      nextAction,
    });
  }

  async #loadEntries(
    entryIds: readonly string[],
    privacyScope: ProcessingPrivacyScope,
  ): Promise<readonly Readonly<CurrentInformationEntry>[]> {
    const includePrivate = privacyScope !== 'public_only';
    const loadByIds = this.#dependencies.entries.loadCurrentEntriesByIds?.bind(
      this.#dependencies.entries,
    );
    const loaded: Readonly<CurrentInformationEntry>[] = [];
    if (loadByIds === undefined) {
      loaded.push(
        ...(await this.#dependencies.entries.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        )),
      );
    } else {
      for (
        let offset = 0;
        offset < entryIds.length;
        offset += HYDRATION_CHUNK_SIZE
      ) {
        loaded.push(
          ...(await loadByIds(
            this.#dependencies.workspaceId,
            includePrivate,
            entryIds.slice(offset, offset + HYDRATION_CHUNK_SIZE),
          )),
        );
      }
    }
    const selected = new Set(entryIds);
    return Object.freeze(
      loaded.filter(
        (entry) =>
          selected.has(entry.entryId) &&
          matchesPrivacyScope(entry.value.isPrivate, privacyScope),
      ),
    );
  }
}

function deduplicateExceptions(
  exceptions: readonly Readonly<BulkIngestionAdjudicationException>[],
): readonly Readonly<BulkIngestionAdjudicationException>[] {
  const byEntry = new Map<
    string,
    Readonly<BulkIngestionAdjudicationException>
  >();
  for (const exception of exceptions) {
    const current = byEntry.get(exception.entryId);
    if (
      current === undefined ||
      exception.ordinal < current.ordinal ||
      (exception.ordinal === current.ordinal &&
        exception.exceptionCode < current.exceptionCode)
    ) {
      byEntry.set(exception.entryId, exception);
    }
  }
  return Object.freeze(
    [...byEntry.values()].sort(
      (left, right) =>
        left.ordinal - right.ordinal ||
        left.entryId.localeCompare(right.entryId),
    ),
  );
}

function stableSamples(
  batchId: string,
  candidates: readonly Readonly<CandidateResult>[],
  limit: number,
): readonly Readonly<BulkIngestionTypeCompletionSample>[] {
  return Object.freeze(
    candidates
      .map((candidate) =>
        Object.freeze({
          candidate,
          key: createHash('sha256')
            .update(`${batchId}\u0000${candidate.entry.entryId}`)
            .digest('hex'),
        }),
      )
      .sort(
        (left, right) =>
          left.key.localeCompare(right.key) ||
          left.candidate.entry.entryId.localeCompare(
            right.candidate.entry.entryId,
          ),
      )
      .slice(0, limit)
      .map(({candidate}, index) =>
        Object.freeze({
          sampleRank: index + 1,
          entryId: candidate.entry.entryId,
          entryRevision: candidate.entry.revision,
          exceptionCode: candidate.exception.exceptionCode,
          reason: candidate.diagnostic.reason,
          ...(candidate.predictedType === undefined
            ? {}
            : {predictedType: candidate.predictedType}),
          winnerScore: candidate.diagnostic.winnerScore,
          runnerUpScore: candidate.diagnostic.runnerUpScore,
          ...(candidate.diagnostic.evidenceSource === undefined
            ? {}
            : {
                evidenceSource: candidate.diagnostic.evidenceSource,
                referenceCount: candidate.diagnostic.referenceCount,
                consensusBasisPoints: candidate.diagnostic.consensusBasisPoints,
              }),
        }),
      ),
  );
}

function matchesPrivacyScope(
  isPrivate: boolean,
  privacyScope: ProcessingPrivacyScope,
): boolean {
  return privacyScope === 'include_private'
    ? true
    : privacyScope === 'private_only'
      ? isPrivate
      : !isPrivate;
}

function modeForStatus(
  status: BulkIngestionEnrichmentBatch['status'],
): BulkIngestionEnrichmentMode {
  switch (status) {
    case 'planned':
      return 'run';
    case 'paused':
      return 'resume';
    case 'running':
    case 'failed':
      return 'retry';
    case 'succeeded':
      return 'refresh';
    default:
      throw new BulkIngestionTypeCompletionServiceError('batch_invalid_state');
  }
}

function validPreviewRequest(
  request: Readonly<PreviewBulkIngestionTypeCompletionRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.batchId) &&
    ['public_only', 'include_private', 'private_only'].includes(
      request.privacyScope,
    ) &&
    Number.isSafeInteger(request.sampleLimit) &&
    request.sampleLimit >= 0 &&
    request.sampleLimit <= MAXIMUM_SAMPLE_LIMIT
  );
}

function validApplyRequest(
  request: Readonly<ApplyBulkIngestionTypeCompletionRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.batchId) &&
    Number.isSafeInteger(request.maxItems) &&
    request.maxItems >= 1 &&
    request.maxItems <= MAXIMUM_APPLY_ITEMS &&
    Number.isSafeInteger(request.sampleLimit) &&
    request.sampleLimit >= 0 &&
    request.sampleLimit <= MAXIMUM_SAMPLE_LIMIT
  );
}

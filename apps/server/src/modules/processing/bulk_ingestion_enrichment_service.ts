import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewPreferences,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {
  buildIncrementalInformationEntryAssociationProjection,
  buildInformationEntryClassificationContext,
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  deriveInformationEntryRevisionId,
  DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
  DETERMINISTIC_ENTRY_TAG_RULE_VERSION,
  extractDeterministicEntryTagCandidates,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  type CurrentInformationEntry,
  type InformationEntryAssociationIncrementalRepositoryPort,
  type InformationEntryAssociationPolicy,
  type InformationEntryBulkRevisionRepositoryPort,
  type InformationEntryRepositoryPort,
  type InformationEntryRevisionWrite,
} from '../entries/index.js';
import {
  type BulkIngestionEnrichmentBatch,
  type BulkIngestionEnrichmentException,
  type BulkIngestionEnrichmentItem,
  type BulkIngestionEnrichmentRepositoryPort,
  type ExecuteBulkIngestionEnrichmentRequest,
  type ExecuteBulkIngestionEnrichmentResult,
} from './bulk_ingestion_enrichment_contract.js';
import {BULK_INGESTION_MAXIMUM_SNAPSHOTS} from './bulk_ingestion_contract.js';
import {deriveProcessingRunId} from './processing_identity.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_CONTENT_KEYWORDS = 32;
const MAXIMUM_DIGEST_INPUT_BYTES = 8_388_608;

export type BulkIngestionEnrichmentServiceErrorCode =
  | 'input_invalid'
  | 'batch_not_found'
  | 'batch_invalid_state'
  | 'executor_superseded';

export class BulkIngestionEnrichmentServiceError extends Error {
  public readonly code: BulkIngestionEnrichmentServiceErrorCode;

  public constructor(code: BulkIngestionEnrichmentServiceErrorCode) {
    super('The bulk ingestion enrichment operation failed.');
    this.name = 'BulkIngestionEnrichmentServiceError';
    this.code = code;
  }
}

export interface BulkIngestionEnrichmentServiceDependencies {
  readonly workspaceId: string;
  readonly repository: BulkIngestionEnrichmentRepositoryPort;
  readonly entries: InformationEntryRepositoryPort &
    InformationEntryBulkRevisionRepositoryPort;
  readonly associations: InformationEntryAssociationIncrementalRepositoryPort;
  readonly preferences: ReviewPreferencesStore;
}

interface PreparedItem {
  readonly item: Readonly<BulkIngestionEnrichmentItem>;
  readonly entryIds: readonly string[];
  readonly writes: readonly Readonly<InformationEntryRevisionWrite>[];
  readonly addedTagCount: number;
  readonly exceptions: readonly Readonly<BulkIngestionEnrichmentException>[];
}

interface SuccessfulItem extends PreparedItem {
  readonly revisedEntryCount: number;
}

export class BulkIngestionEnrichmentService {
  readonly #dependencies: Readonly<BulkIngestionEnrichmentServiceDependencies>;

  public constructor(
    dependencies: Readonly<BulkIngestionEnrichmentServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new BulkIngestionEnrichmentServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async load(
    batchId: string,
  ): Promise<Readonly<BulkIngestionEnrichmentBatch>> {
    if (!CANONICAL_UUID.test(batchId)) {
      throw new BulkIngestionEnrichmentServiceError('input_invalid');
    }
    await this.#ensure(batchId);
    return this.#loadRequired(batchId);
  }

  public async execute(
    request: Readonly<ExecuteBulkIngestionEnrichmentRequest>,
  ): Promise<Readonly<ExecuteBulkIngestionEnrichmentResult>> {
    if (!validRequest(request)) {
      throw new BulkIngestionEnrichmentServiceError('input_invalid');
    }
    await this.#ensure(request.batchId);
    const before = await this.#loadRequired(request.batchId);
    const preferences = await this.#dependencies.preferences.load(
      this.#dependencies.workspaceId,
    );
    const rules = prepareRules(preferences);
    if (before.status === 'succeeded' && request.mode !== 'refresh') {
      return Object.freeze({
        outcome: 'succeeded' as const,
        batch: before,
        rulesSha256: rules.sha256,
      });
    }
    const nextAttempt = before.attempt + 1;
    const runId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      `m2-p0b-run:${request.batchId}:attempt:${nextAttempt.toString()}`,
    );
    const begun = await this.#dependencies.repository.beginAttempt({
      workspaceId: this.#dependencies.workspaceId,
      batchId: request.batchId,
      runId,
      mode: request.mode,
      maximumItems: request.maxItems,
      rulesSha256: rules.sha256,
    });
    if (begun === 'not_found') {
      throw new BulkIngestionEnrichmentServiceError('batch_not_found');
    }
    if (begun !== 'started') {
      throw new BulkIngestionEnrichmentServiceError('batch_invalid_state');
    }
    const claimed = await this.#dependencies.repository.claimItems(
      this.#dependencies.workspaceId,
      request.batchId,
      runId,
      request.maxItems,
      rules.sha256,
    );
    const includePrivate = before.privacyScope !== 'public_only';
    const allVisibleEntries = filterPrivacyScope(
      await this.#dependencies.entries.loadCurrentEntries(
        this.#dependencies.workspaceId,
        includePrivate,
      ),
      before.privacyScope,
    );
    const classificationContext = buildInformationEntryClassificationContext(
      allVisibleEntries,
      rules.classificationProfile.neighborPolicy,
    );
    const successful: SuccessfulItem[] = [];
    for (const item of claimed) {
      const prepared = prepareItem(
        item,
        allVisibleEntries,
        rules,
        classificationContext,
      );
      if (prepared === undefined) {
        await this.#settleFailed(item, runId, 'entry_snapshot_mismatch');
        continue;
      }
      let revisedEntryCount = 0;
      if (prepared.writes.length > 0) {
        try {
          const revised =
            await this.#dependencies.entries.reviseEntriesAtomically(
              prepared.writes,
            );
          if (revised.outcome === 'not_found' || revised.outcome === 'stale') {
            await this.#settleFailed(item, runId, 'entry_revision_conflict');
            continue;
          }
          revisedEntryCount = revised.appliedCount;
        } catch {
          await this.#settleFailed(item, runId, 'entry_tag_write_failed');
          continue;
        }
      }
      successful.push(Object.freeze({...prepared, revisedEntryCount}));
    }

    const projectionCounts = new Map<number, number>();
    if (successful.length > 0) {
      try {
        const currentEntries = filterPrivacyScope(
          await this.#dependencies.entries.loadCurrentEntries(
            this.#dependencies.workspaceId,
            includePrivate,
          ),
          before.privacyScope,
        );
        const sourceEntryIds = Object.freeze(
          successful.flatMap((prepared) => prepared.entryIds),
        );
        const projections =
          buildIncrementalInformationEntryAssociationProjection(
            currentEntries,
            sourceEntryIds,
            rules.associationPolicy,
          );
        await this.#dependencies.associations.replaceAssociationProjectionsForEntries(
          this.#dependencies.workspaceId,
          sourceEntryIds,
          projections,
          includePrivate,
        );
        const itemByEntryId = new Map(
          successful.flatMap((prepared) =>
            prepared.entryIds.map(
              (entryId) => [entryId, prepared.item.ordinal] as const,
            ),
          ),
        );
        for (const projection of projections) {
          const owners = [
            itemByEntryId.get(projection.entryLowId),
            itemByEntryId.get(projection.entryHighId),
          ].filter((value): value is number => value !== undefined);
          const owner = owners.length === 0 ? undefined : Math.min(...owners);
          if (owner !== undefined) {
            projectionCounts.set(owner, (projectionCounts.get(owner) ?? 0) + 1);
          }
        }
      } catch {
        for (const prepared of successful) {
          await this.#settleFailed(
            prepared.item,
            runId,
            'association_projection_failed',
          );
        }
        successful.length = 0;
      }
    }

    for (const prepared of successful) {
      const settled = await this.#dependencies.repository.settleItem({
        workspaceId: this.#dependencies.workspaceId,
        batchId: request.batchId,
        ordinal: prepared.item.ordinal,
        runId,
        expectedVersion: prepared.item.version,
        status: 'succeeded',
        resultEntryCount: prepared.entryIds.length,
        revisedEntryCount: prepared.revisedEntryCount,
        addedTagCount: prepared.addedTagCount,
        associationProjectionCount:
          projectionCounts.get(prepared.item.ordinal) ?? 0,
        exceptionEntryCount: prepared.exceptions.length,
        exceptions: prepared.exceptions,
      });
      if (settled !== 'applied') {
        throw new BulkIngestionEnrichmentServiceError('executor_superseded');
      }
    }
    const finished = await this.#dependencies.repository.finishAttempt(
      this.#dependencies.workspaceId,
      request.batchId,
      runId,
    );
    if (finished !== 'applied') {
      throw new BulkIngestionEnrichmentServiceError('executor_superseded');
    }
    const batch = await this.#loadRequired(request.batchId);
    return Object.freeze({
      outcome:
        batch.failedSnapshotCount > 0
          ? ('failed' as const)
          : batch.status === 'succeeded'
            ? ('succeeded' as const)
            : ('paused' as const),
      batch,
      rulesSha256: rules.sha256,
    });
  }

  async #settleFailed(
    item: Readonly<BulkIngestionEnrichmentItem>,
    runId: string,
    errorCode: string,
  ): Promise<void> {
    const settled = await this.#dependencies.repository.settleItem({
      workspaceId: this.#dependencies.workspaceId,
      batchId: item.batchId,
      ordinal: item.ordinal,
      runId,
      expectedVersion: item.version,
      status: 'failed',
      errorCode,
      exceptions: Object.freeze([]),
    });
    if (settled !== 'applied') {
      throw new BulkIngestionEnrichmentServiceError('executor_superseded');
    }
  }

  async #ensure(batchId: string): Promise<void> {
    const ready = await this.#dependencies.repository.ensureItems(
      this.#dependencies.workspaceId,
      batchId,
    );
    if (!ready) {
      throw new BulkIngestionEnrichmentServiceError('batch_invalid_state');
    }
  }

  async #loadRequired(
    batchId: string,
  ): Promise<Readonly<BulkIngestionEnrichmentBatch>> {
    const batch = await this.#dependencies.repository.loadBatch(
      this.#dependencies.workspaceId,
      batchId,
    );
    if (batch === undefined) {
      throw new BulkIngestionEnrichmentServiceError('batch_not_found');
    }
    return batch;
  }
}

function prepareItem(
  item: Readonly<BulkIngestionEnrichmentItem>,
  allEntries: readonly Readonly<CurrentInformationEntry>[],
  rules: ReturnType<typeof prepareRules>,
  classificationContext: ReturnType<
    typeof buildInformationEntryClassificationContext
  >,
): Readonly<PreparedItem> | undefined {
  const entries = allEntries
    .filter((entry) => entry.snapshotId === item.snapshotId)
    .sort((left, right) => left.entryId.localeCompare(right.entryId));
  if (
    entries.length !== item.plannedEntryCount ||
    entries.some((entry) => entry.value.isPrivate !== item.isPrivate)
  ) {
    return undefined;
  }
  const exceptions: BulkIngestionEnrichmentException[] = [];
  const writes: InformationEntryRevisionWrite[] = [];
  let addedTagCount = 0;
  for (const entry of entries) {
    const existingRuleTagCount = entry.value.contentKeywords.filter(
      (keyword) => keyword.origin === 'rule',
    ).length;
    addedTagCount += existingRuleTagCount;
    const existing = new Set(
      entry.value.contentKeywords.map((keyword) => keyword.normalizedValue),
    );
    const capacity = Math.max(
      0,
      MAXIMUM_CONTENT_KEYWORDS - entry.value.contentKeywords.length,
    );
    const candidates = extractDeterministicEntryTagCandidates(
      entry.value.body,
      rules.automaticKeywords,
      rules.vocabulary,
      capacity,
    ).filter((candidate) => !existing.has(candidate.normalizedValue));
    const classificationKeywords = Object.freeze([
      ...entry.value.contentKeywords,
      ...candidates.map((candidate) =>
        Object.freeze({
          ...candidate,
          origin: 'rule' as const,
          originVersion: rules.originVersion,
        }),
      ),
    ]);
    const classificationEntry =
      candidates.length === 0
        ? entry
        : Object.freeze({
            ...entry,
            value: Object.freeze({
              ...entry.value,
              contentKeywords: classificationKeywords,
            }),
          });
    const classification = classifyInformationEntryDeterministically({
      titlePath: entry.value.titlePath,
      body: entry.value.body,
      chunkMode: entry.value.chunkMode,
      contentKeywords: classificationKeywords.map(
        (keyword) => keyword.displayValue,
      ),
      profile: rules.classificationProfile,
      neighborEvidence: classificationContext.evidenceFor(classificationEntry),
      originVersion: rules.classificationOriginVersion,
    });
    const typeKeyword = entry.value.typeKeyword ?? classification.typeKeyword;
    const domains =
      entry.value.domains.length > 0
        ? entry.value.domains
        : classification.domains;
    const classificationChanged =
      typeKeyword !== entry.value.typeKeyword ||
      (entry.value.domains.length === 0 && domains.length > 0);
    const willWrite = candidates.length > 0 || classificationChanged;
    const resultRevision = entry.revision + (willWrite ? 1 : 0);
    const resultRevisionId = willWrite
      ? deriveInformationEntryRevisionId(entry.entryId, resultRevision)
      : entry.revisionId;
    const contentIncomplete =
      entry.value.contentKeywords.length === 0 && candidates.length === 0;
    const classificationIncomplete =
      typeKeyword === undefined || domains.length === 0;
    if (contentIncomplete || classificationIncomplete) {
      exceptions.push(
        Object.freeze({
          entryId: entry.entryId,
          entryRevision: resultRevision,
          entryRevisionId: resultRevisionId,
          code: contentIncomplete
            ? !rules.automaticKeywords.enabled
              ? ('automatic_tagging_disabled' as const)
              : capacity === 0
                ? ('keyword_capacity_reached' as const)
                : ('no_deterministic_tags' as const)
            : classificationExceptionCode(
                typeKeyword,
                domains,
                classification.diagnostics,
              ),
        }),
      );
    }
    if (!willWrite) continue;
    addedTagCount += candidates.length;
    writes.push(
      Object.freeze({
        workspaceId: entry.workspaceId,
        entryId: entry.entryId,
        expectedRevision: entry.revision,
        revisionId: resultRevisionId,
        value: Object.freeze({
          ...entry.value,
          ...(typeKeyword === undefined ? {} : {typeKeyword}),
          domains: Object.freeze([...domains]),
          contentKeywords: classificationKeywords,
        }),
      }),
    );
  }
  return Object.freeze({
    item,
    entryIds: Object.freeze(entries.map((entry) => entry.entryId)),
    writes: Object.freeze(writes),
    addedTagCount,
    exceptions: Object.freeze(exceptions),
  });
}

function prepareRules(preferences: Readonly<ReviewPreferences>) {
  const automaticKeywords =
    preferences.automaticKeywords ??
    DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES;
  const vocabulary =
    preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES;
  const association =
    preferences.associationPolicy ??
    DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
  const classificationProfile =
    preferences.entryClassificationProfile ??
    DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
  const associationPolicy: Readonly<InformationEntryAssociationPolicy> =
    Object.freeze({
      ...INFORMATION_ENTRY_ASSOCIATION_POLICY,
      revision: association.revision,
      contentWeight: association.contentWeight,
      typeWeight: association.typeWeight,
      domainWeight: association.domainWeight,
      threshold: association.threshold,
    });
  const sha256 = digest({
    schemaVersion: 'struinfo.bulk-ingestion-enrichment-rules.v3',
    deterministicTagRuleVersion: DETERMINISTIC_ENTRY_TAG_RULE_VERSION,
    deterministicClassificationRuleVersion:
      DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
    automaticKeywords,
    vocabulary,
    classificationProfile,
    associationPolicy: {
      revision: associationPolicy.revision,
      contentWeight: associationPolicy.contentWeight,
      typeWeight: associationPolicy.typeWeight,
      domainWeight: associationPolicy.domainWeight,
      threshold: associationPolicy.threshold,
      candidateLimit: associationPolicy.candidateLimit,
      adjustmentStep: associationPolicy.adjustmentStep,
      version: associationPolicy.version,
    },
  });
  return Object.freeze({
    automaticKeywords,
    vocabulary,
    classificationProfile,
    associationPolicy,
    sha256,
    originVersion: `${DETERMINISTIC_ENTRY_TAG_RULE_VERSION}:m2-p0b:${sha256}`,
    classificationOriginVersion: `${DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION}:m2-p2:${sha256}`,
  });
}

function classificationExceptionCode(
  typeKeyword: CurrentInformationEntry['value']['typeKeyword'],
  domains: CurrentInformationEntry['value']['domains'],
  diagnostics: ReturnType<
    typeof classifyInformationEntryDeterministically
  >['diagnostics'],
): BulkIngestionEnrichmentException['code'] {
  if (typeKeyword === undefined && domains.length === 0) {
    return diagnostics.type.reason === 'no_signal' &&
      diagnostics.domain.reason === 'no_signal'
      ? 'classification_no_signal'
      : 'classification_tied';
  }
  return typeKeyword === undefined
    ? 'classification_type_missing'
    : 'classification_domain_missing';
}

function filterPrivacyScope(
  entries: readonly Readonly<CurrentInformationEntry>[],
  scope: BulkIngestionEnrichmentBatch['privacyScope'],
): readonly Readonly<CurrentInformationEntry>[] {
  return scope === 'include_private'
    ? entries
    : Object.freeze(
        entries.filter((entry) =>
          scope === 'private_only'
            ? entry.value.isPrivate
            : !entry.value.isPrivate,
        ),
      );
}

function validRequest(
  request: Readonly<ExecuteBulkIngestionEnrichmentRequest>,
): boolean {
  return (
    CANONICAL_UUID.test(request.batchId) &&
    ['run', 'resume', 'retry', 'refresh'].includes(request.mode) &&
    Number.isSafeInteger(request.maxItems) &&
    request.maxItems >= 1 &&
    request.maxItems <= BULK_INGESTION_MAXIMUM_SNAPSHOTS
  );
}

function digest(value: unknown): string {
  const bytes = encodeCanonicalJson(value, MAXIMUM_DIGEST_INPUT_BYTES);
  return createHash('sha256').update(bytes).digest('hex');
}

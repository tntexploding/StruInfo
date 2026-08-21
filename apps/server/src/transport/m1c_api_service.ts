import {createHash} from 'node:crypto';

import {
  executeApplyManualCuration,
  executePutContentClassificationTerm,
  type ManualCurationRepositoryPort,
} from '../modules/curation/index.js';
import type {ManualCurationReadRepositoryPort} from '../modules/curation/manual_curation_read_repository.js';
import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  deriveInformationDocumentTagRevisionId,
  deriveInformationEntryRevisionId,
  prepareAggregatedInformationDocumentTags,
  prepareManualInformationDocumentTags,
  prepareManualEntryRevision,
  prepareSplitInformationEntries,
  searchCurrentInformationEntries,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationDocumentTagRepositoryPort,
  type InformationEntryDocumentView,
  type InformationEntryRepositoryPort,
  type InformationEntrySearchRequest,
  type MaterializedEvidenceSnapshot,
} from '../modules/entries/index.js';
import {
  importMarkdownEvidence,
  type EvidenceReadRepositoryPort,
  type EvidenceRepositoryPort,
  type EvidenceSnapshotReadState,
  type ImportMarkdownEvidenceInput,
} from '../modules/evidence/index.js';
import {
  executeApplyManualKnowledgeChangeSet,
  executeDeterministicKnowledgeSearch,
  searchKeyV1,
  type DeterministicKnowledgeSearchRequest,
  type DeterministicKnowledgeSearchRepositoryPort,
  type ManualKnowledgeReadRepositoryPort,
  type ManualKnowledgeRepositoryPort,
} from '../modules/knowledge/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import {
  decodeReviewAutomaticKeywordPreferences,
  decodeReviewQuickTags,
  decodeReviewVocabularyPreferences,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import {
  M1cWorkspaceTransferError,
  type M1cWorkspaceTransferPort,
} from '../workspace_transfer/m1c_workspace_transfer.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1cApiServiceDependencies {
  readonly workspaceId: string;
  readonly blobStore: BlobStore;
  readonly reviewPreferences: ReviewPreferencesStore;
  readonly evidenceRepository: EvidenceRepositoryPort;
  readonly evidenceReadRepository: EvidenceReadRepositoryPort;
  readonly curationRepository: ManualCurationRepositoryPort;
  readonly curationReadRepository: ManualCurationReadRepositoryPort;
  readonly knowledgeRepository: ManualKnowledgeRepositoryPort;
  readonly knowledgeReadRepository: ManualKnowledgeReadRepositoryPort;
  readonly retrievalRepository: DeterministicKnowledgeSearchRepositoryPort;
  readonly informationEntryRepository: InformationEntryRepositoryPort;
  readonly informationDocumentTagRepository: InformationDocumentTagRepositoryPort;
  readonly workspaceTransfer: M1cWorkspaceTransferPort;
}

export interface M1cHttpResult {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface M1cApiServicePort {
  workspace(): M1cHttpResult;
  listEvidence(): Promise<M1cHttpResult>;
  loadEvidenceSnapshot(
    snapshotId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  loadCurationState(): Promise<M1cHttpResult>;
  loadReviewPreferences(): Promise<M1cHttpResult>;
  saveReviewPreferences(body: unknown): Promise<M1cHttpResult>;
  importMarkdown(body: unknown): Promise<M1cHttpResult>;
  putCurationTerm(body: unknown): Promise<M1cHttpResult>;
  applyCuration(body: unknown): Promise<M1cHttpResult>;
  applyKnowledgeChangeSet(body: unknown): Promise<M1cHttpResult>;
  loadKnowledgeItem(
    itemId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  search(body: unknown): Promise<M1cHttpResult>;
  materializeInformationEntries(body: unknown): Promise<M1cHttpResult>;
  listInformationEntries(
    snapshotId?: unknown,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  searchInformationEntries(body: unknown): Promise<M1cHttpResult>;
  listInformationEntryDocuments(
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  aggregateInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  exportWorkspaceBundle(): Promise<M1cHttpResult>;
  restoreWorkspaceBundle(body: unknown): Promise<M1cHttpResult>;
}

/** Thin local HTTP application layer over the accepted domain commands. */
export class M1cApiService implements M1cApiServicePort {
  readonly #dependencies: Readonly<M1cApiServiceDependencies>;

  public constructor(dependencies: Readonly<M1cApiServiceDependencies>) {
    this.#dependencies = dependencies;
  }

  public workspace(): M1cHttpResult {
    return httpResult(200, {
      status: 'ok',
      workspaceId: this.#dependencies.workspaceId,
      capabilities: Object.freeze([
        'markdown_import',
        'evidence_read',
        'manual_curation',
        'manual_knowledge',
        'deterministic_search',
        'information_entries',
        'information_document_tags',
        'private_documents',
        'review_preferences',
        'workspace_bundle_export',
        'workspace_bundle_restore',
      ]),
    });
  }

  public async listEvidence(): Promise<M1cHttpResult> {
    try {
      const snapshots =
        await this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#dependencies.workspaceId,
        );
      return httpResult(200, {status: 'ok', snapshots});
    } catch {
      return repositoryFailure();
    }
  }

  public async loadEvidenceSnapshot(
    snapshotId: string,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (snapshot === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      if (snapshot.isPrivate === true && !includePrivate) {
        return httpResult(403, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'private_content_requires_opt_in',
            path: 'query.includePrivate',
          }),
        });
      }
      return httpResult(200, {
        status: 'ok',
        snapshot: await materializeEvidenceSnapshot(
          snapshot,
          this.#dependencies.blobStore,
        ),
      });
    } catch {
      return httpResult(503, {
        status: 'failed',
        issue: Object.freeze({code: 'evidence_read_failed'}),
      });
    }
  }

  public async loadCurationState(): Promise<M1cHttpResult> {
    try {
      const state =
        await this.#dependencies.curationReadRepository.loadCurrentCurationState(
          this.#dependencies.workspaceId,
        );
      return httpResult(200, {status: 'ok', state});
    } catch {
      return repositoryFailure();
    }
  }

  public async loadReviewPreferences(): Promise<M1cHttpResult> {
    try {
      const preferences = await this.#dependencies.reviewPreferences.load(
        this.#dependencies.workspaceId,
      );
      return httpResult(200, {
        status: 'ok',
        workspaceId: preferences.workspaceId,
        quickTags: preferences.quickTags,
        automaticKeywords:
          preferences.automaticKeywords ??
          DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary:
          preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async saveReviewPreferences(body: unknown): Promise<M1cHttpResult> {
    if (!isRecord(body)) return inputFailure('body');
    const quickTags = decodeReviewQuickTags(body.quickTags);
    if (quickTags === undefined) return inputFailure('body.quickTags');
    const automaticKeywords =
      body.automaticKeywords === undefined
        ? DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES
        : decodeReviewAutomaticKeywordPreferences(body.automaticKeywords);
    if (automaticKeywords === undefined) {
      return inputFailure('body.automaticKeywords');
    }
    const vocabulary =
      body.vocabulary === undefined
        ? DEFAULT_REVIEW_VOCABULARY_PREFERENCES
        : decodeReviewVocabularyPreferences(body.vocabulary);
    if (vocabulary === undefined) {
      return inputFailure('body.vocabulary');
    }
    try {
      const preferences = await this.#dependencies.reviewPreferences.save(
        this.#dependencies.workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
      );
      return httpResult(200, {
        status: 'ok',
        workspaceId: preferences.workspaceId,
        quickTags: preferences.quickTags,
        automaticKeywords: preferences.automaticKeywords ?? automaticKeywords,
        vocabulary: preferences.vocabulary ?? vocabulary,
      });
    } catch {
      return reviewPreferencesFailure();
    }
  }

  public async importMarkdown(body: unknown): Promise<M1cHttpResult> {
    const input = mapMarkdownImportBody(body, this.#dependencies.workspaceId);
    if (input === undefined) return inputFailure('body');
    const result = await importMarkdownEvidence(
      {
        blobStore: this.#dependencies.blobStore,
        evidenceRepository: this.#dependencies.evidenceRepository,
      },
      input,
    );
    return httpResult(statusForImport(result.status), result);
  }

  public async putCurationTerm(body: unknown): Promise<M1cHttpResult> {
    const envelope = commandEnvelope(body);
    const result = await executePutContentClassificationTerm(
      this.#dependencies.curationRepository,
      commandContext(this.#dependencies.workspaceId, envelope.key),
      envelope.request,
    );
    return httpResult(statusForDomainResult(result), result);
  }

  public async applyCuration(body: unknown): Promise<M1cHttpResult> {
    const envelope = commandEnvelope(body);
    const result = await executeApplyManualCuration(
      this.#dependencies.curationRepository,
      commandContext(this.#dependencies.workspaceId, envelope.key),
      envelope.request,
    );
    return httpResult(statusForDomainResult(result), result);
  }

  public async applyKnowledgeChangeSet(body: unknown): Promise<M1cHttpResult> {
    const envelope = commandEnvelope(body);
    const result = await executeApplyManualKnowledgeChangeSet(
      this.#dependencies.knowledgeRepository,
      commandContext(this.#dependencies.workspaceId, envelope.key),
      envelope.request,
    );
    return httpResult(statusForDomainResult(result), result);
  }

  public async loadKnowledgeItem(
    itemId: string,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(itemId)) {
      return inputFailure('path.itemId');
    }
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const item =
        await this.#dependencies.knowledgeReadRepository.loadCurrentKnowledgeItem(
          this.#dependencies.workspaceId,
          itemId,
        );
      if (item === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'knowledge_item_not_found'}),
        });
      }
      if (item.isPrivate === true && !includePrivate) {
        return httpResult(403, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'private_content_requires_opt_in',
            path: 'query.includePrivate',
          }),
        });
      }
      return httpResult(200, {
        status: 'ok',
        item: Object.freeze({
          itemId: item.itemId,
          revision: item.revision,
          revisionId: item.revisionId,
          value: item.value,
          provenance: item.provenance,
          ...(item.isPrivate === true ? {isPrivate: true as const} : {}),
        }),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async search(body: unknown): Promise<M1cHttpResult> {
    const envelope = searchEnvelope(body);
    if (envelope === undefined) return inputFailure('body');
    const result = await executeDeterministicKnowledgeSearch(
      this.#dependencies.retrievalRepository,
      Object.freeze({
        effectiveWorkspaceId: this.#dependencies.workspaceId,
        authority: 'manual_user' as const,
      }),
      envelope.request,
      Object.freeze({includePrivate: envelope.includePrivate}),
    );
    if (result.status === 'ok') {
      try {
        const privateDocuments = envelope.includePrivate
          ? await searchPrivateDocuments(
              this.#dependencies,
              envelope.request as Readonly<DeterministicKnowledgeSearchRequest>,
            )
          : Object.freeze([]);
        return httpResult(200, {
          ...result,
          includePrivate: envelope.includePrivate,
          privateDocumentTotalCount: privateDocuments.length,
          privateDocuments,
        });
      } catch {
        return httpResult(503, {
          status: 'failed',
          issue: Object.freeze({code: 'evidence_read_failed'}),
        });
      }
    }
    return httpResult(result.status === 'failed' ? 503 : 422, result);
  }

  public async materializeInformationEntries(
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (
      !isRecord(body) ||
      typeof body.snapshotId !== 'string' ||
      !CANONICAL_UUID.test(body.snapshotId)
    ) {
      return inputFailure('body.snapshotId');
    }
    if (body.chunkMode !== undefined && body.chunkMode !== 'split') {
      return inputFailure('body.chunkMode');
    }
    const includePrivate = body.includePrivate ?? false;
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('body.includePrivate');
    }
    const snapshotId = body.snapshotId;
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !includePrivate)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      const materialized = (await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      )) as Readonly<MaterializedEvidenceSnapshot>;
      const entries = prepareSplitInformationEntries(materialized);
      if (entries.length === 0) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'entry_sections_not_found'}),
        });
      }
      const persisted =
        await this.#dependencies.informationEntryRepository.materializeEntries(
          entries,
        );
      const current =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        );
      const entryIds = new Set(entries.map((entry) => entry.entryId));
      return httpResult(persisted.outcome === 'created' ? 201 : 200, {
        status: persisted.outcome,
        snapshotId,
        createdCount: persisted.createdCount,
        entries: Object.freeze(
          current.filter((entry) => entryIds.has(entry.entryId)),
        ),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async listInformationEntries(
    snapshotId?: unknown,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (
      snapshotId !== undefined &&
      (typeof snapshotId !== 'string' || !CANONICAL_UUID.test(snapshotId))
    ) {
      return inputFailure('query.snapshotId');
    }
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        );
      const selected =
        snapshotId === undefined
          ? entries
          : entries.filter((entry) => entry.snapshotId === snapshotId);
      return httpResult(200, {
        status: 'ok',
        totalCount: selected.length,
        entries: Object.freeze(selected),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    const input = decodeEntryRevisionBody(body);
    if (input === undefined) return inputFailure('body');
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      const current = entries.find((entry) => entry.entryId === entryId);
      if (current === undefined) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const value = prepareManualEntryRevision(current, input.annotation);
      if (value === undefined) return inputFailure('body.annotation');
      const outcome =
        await this.#dependencies.informationEntryRepository.reviseEntry({
          workspaceId: this.#dependencies.workspaceId,
          entryId,
          expectedRevision: input.expectedRevision,
          revisionId: deriveInformationEntryRevisionId(
            entryId,
            input.expectedRevision + 1,
          ),
          value,
        });
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_entry_revision'}),
        });
      }
      const refreshed =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      return httpResult(200, {
        status: outcome,
        entry: refreshed.find((entry) => entry.entryId === entryId),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async searchInformationEntries(body: unknown): Promise<M1cHttpResult> {
    const request = decodeEntrySearchBody(body);
    if (request === undefined) return inputFailure('body');
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          request.includePrivate,
        );
      const result = searchCurrentInformationEntries(entries, request);
      return httpResult(200, {status: 'ok', ...result});
    } catch {
      return repositoryFailure();
    }
  }

  public async listInformationEntryDocuments(
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const [snapshots, entries, currentTags] = await Promise.all([
        this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#dependencies.workspaceId,
        ),
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
      ]);
      const documents = snapshots
        .filter((snapshot) => includePrivate || snapshot.isPrivate !== true)
        .map((snapshot): Readonly<InformationEntryDocumentView> => {
          const documentEntries = entries.filter(
            (entry) => entry.snapshotId === snapshot.snapshotId,
          );
          const tags = currentTags.find(
            (candidate) => candidate.snapshotId === snapshot.snapshotId,
          );
          if (tags !== undefined && tags.resourceId !== snapshot.resourceId) {
            throw new Error('Document tag source identity mismatch.');
          }
          return Object.freeze({
            ...snapshot,
            entryCount: documentEntries.length,
            annotatedEntryCount: documentEntries.filter(
              (entry) =>
                entry.value.contentKeywords.length > 0 ||
                entry.value.typeKeyword !== undefined ||
                entry.value.domains.length > 0,
            ).length,
            ...(tags === undefined ? {} : {currentTags: tags}),
          });
        });
      return httpResult(200, {
        status: 'ok',
        totalCount: documents.length,
        documents: Object.freeze(documents),
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async aggregateInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeDocumentTagWriteBody(body, false);
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (input === undefined) return inputFailure('body');
    return this.#writeInformationDocumentTags(snapshotId, input);
  }

  public async reviseInformationDocumentTags(
    snapshotId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeDocumentTagWriteBody(body, true);
    if (!CANONICAL_UUID.test(snapshotId)) {
      return inputFailure('path.snapshotId');
    }
    if (input === undefined) return inputFailure('body');
    return this.#writeInformationDocumentTags(snapshotId, input);
  }

  async #writeInformationDocumentTags(
    snapshotId: string,
    input: Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      tags?: readonly string[];
    }>,
  ): Promise<M1cHttpResult> {
    try {
      const snapshot =
        await this.#dependencies.evidenceReadRepository.loadSnapshot(
          this.#dependencies.workspaceId,
          snapshotId,
        );
      if (
        snapshot === undefined ||
        (snapshot.isPrivate === true && !input.includePrivate)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'snapshot_not_found'}),
        });
      }
      const materialized = (await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      )) as Readonly<MaterializedEvidenceSnapshot>;
      const normalizedText = materialized.structures[0]?.normalizedText;
      if (normalizedText === undefined) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({code: 'document_text_not_found'}),
        });
      }
      const entries = (
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        )
      ).filter((entry) => entry.snapshotId === snapshotId);
      const aggregationInput = Object.freeze({
        normalizedText,
        isPrivate: snapshot.isPrivate === true,
        entries: Object.freeze(entries),
      });
      const value =
        input.tags === undefined
          ? prepareAggregatedInformationDocumentTags(aggregationInput)
          : prepareManualInformationDocumentTags(aggregationInput, input.tags);
      if (value === undefined) return inputFailure('body.tags');
      const outcome =
        await this.#dependencies.informationDocumentTagRepository.writeDocumentTags(
          {
            workspaceId: this.#dependencies.workspaceId,
            resourceId: snapshot.resourceId,
            snapshotId,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationDocumentTagRevisionId(
              snapshotId,
              input.expectedRevision + 1,
            ),
            value,
          },
        );
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_document_tag_revision'}),
        });
      }
      const current =
        await this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
          this.#dependencies.workspaceId,
          input.includePrivate,
        );
      const documentTags = current.find(
        (candidate) => candidate.snapshotId === snapshotId,
      );
      if (documentTags === undefined) {
        throw new Error('Committed document tags were not readable.');
      }
      return httpResult(200, {
        status: outcome,
        documentTags,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async exportWorkspaceBundle(): Promise<M1cHttpResult> {
    try {
      const summary =
        await this.#dependencies.workspaceTransfer.exportWorkspace(
          this.#dependencies.workspaceId,
        );
      return httpResult(201, {status: 'exported', ...summary});
    } catch (error) {
      return workspaceTransferFailure(error);
    }
  }

  public async restoreWorkspaceBundle(body: unknown): Promise<M1cHttpResult> {
    if (!isRecord(body) || typeof body.fileName !== 'string') {
      return inputFailure('body.fileName');
    }
    try {
      const summary =
        await this.#dependencies.workspaceTransfer.restoreWorkspace(
          this.#dependencies.workspaceId,
          body.fileName,
        );
      return httpResult(200, {status: 'restored', ...summary});
    } catch (error) {
      return workspaceTransferFailure(error);
    }
  }
}

function reviewPreferencesFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'review_preferences_failed'}),
  });
}

function searchEnvelope(
  body: unknown,
): Readonly<{includePrivate: boolean; request: unknown}> | undefined {
  if (!isRecord(body)) return undefined;
  if (!Object.hasOwn(body, 'request')) {
    return Object.freeze({includePrivate: false, request: body});
  }
  if (
    !Object.hasOwn(body, 'includePrivate') ||
    typeof body.includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    includePrivate: body.includePrivate,
    request: body.request,
  });
}

async function searchPrivateDocuments(
  dependencies: Readonly<M1cApiServiceDependencies>,
  request: Readonly<DeterministicKnowledgeSearchRequest>,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const summaries = await dependencies.evidenceReadRepository.listSnapshots(
    dependencies.workspaceId,
  );
  const matches: Readonly<Record<string, unknown>>[] = [];
  for (const summary of summaries) {
    if (summary.isPrivate !== true) continue;
    if (!sourceSummaryMatches(request, summary)) continue;
    const snapshot = await dependencies.evidenceReadRepository.loadSnapshot(
      dependencies.workspaceId,
      summary.snapshotId,
    );
    if (snapshot?.isPrivate !== true) continue;
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      dependencies.blobStore,
    );
    const structures = materialized.structures as readonly Readonly<{
      normalizedText: string;
      fragments: readonly Readonly<{fragmentId: string}>[];
    }>[];
    if (!sourceDocumentMatches(request, summary, structures)) continue;
    const normalizedText = structures
      .map((structure) => structure.normalizedText)
      .join('\n');
    matches.push(
      Object.freeze({
        isPrivate: true,
        workspaceId: summary.workspaceId,
        resourceId: summary.resourceId,
        snapshotId: summary.snapshotId,
        sourceKey: summary.sourceKey,
        capturedAt: summary.capturedAt,
        fragmentCount: summary.fragmentCount,
        matchKind: privateDocumentMatchKind(request, summary, normalizedText),
        excerpt: excerptFromText(normalizedText),
      }),
    );
  }
  return Object.freeze(matches);
}

function sourceSummaryMatches(
  request: Readonly<DeterministicKnowledgeSearchRequest>,
  summary: Readonly<{resourceId: string; snapshotId: string}>,
): boolean {
  const source = request.filters.source;
  return source.kind === 'any' || source.kind === 'fragment'
    ? true
    : source.kind === 'resource'
      ? source.resourceId === summary.resourceId
      : source.snapshotId === summary.snapshotId;
}

function sourceDocumentMatches(
  request: Readonly<DeterministicKnowledgeSearchRequest>,
  summary: Readonly<{sourceKey: string}>,
  structures: readonly Readonly<{
    normalizedText: string;
    fragments: readonly Readonly<{fragmentId: string}>[];
  }>[],
): boolean {
  const source = request.filters.source;
  if (
    source.kind === 'fragment' &&
    !structures.some((structure) =>
      structure.fragments.some(
        (fragment) => fragment.fragmentId === source.fragmentId,
      ),
    )
  ) {
    return false;
  }
  if (request.text === undefined) return true;
  const query = searchKeyV1(request.text.value);
  const fields = new Set(request.text.fields);
  const candidates = [
    ...(fields.has('title') ? [searchKeyV1(summary.sourceKey)] : []),
    ...(fields.has('body')
      ? structures.map((structure) => searchKeyV1(structure.normalizedText))
      : []),
  ];
  return candidates.some((candidate) =>
    request.text?.mode === 'exact'
      ? candidate === query
      : candidate.includes(query),
  );
}

function privateDocumentMatchKind(
  request: Readonly<DeterministicKnowledgeSearchRequest>,
  summary: Readonly<{sourceKey: string}>,
  normalizedText: string,
): 'browse' | 'source_key' | 'full_text' {
  if (request.text === undefined) return 'browse';
  const query = searchKeyV1(request.text.value);
  if (
    request.text.fields.includes('title') &&
    (request.text.mode === 'exact'
      ? searchKeyV1(summary.sourceKey) === query
      : searchKeyV1(summary.sourceKey).includes(query))
  ) {
    return 'source_key';
  }
  return searchKeyV1(normalizedText).includes(query) ? 'full_text' : 'browse';
}

function excerptFromText(value: string): string {
  const codePoints = Array.from(value.trim());
  return codePoints.length <= 240
    ? codePoints.join('')
    : `${codePoints.slice(0, 240).join('')}…`;
}

function mapMarkdownImportBody(
  body: unknown,
  workspaceId: string,
): Readonly<ImportMarkdownEvidenceInput> | undefined {
  if (!isRecord(body) || typeof body.sourceText !== 'string') return undefined;
  if (!isRecord(body.resource) || !isRecord(body.snapshot)) return undefined;
  if (!Array.isArray(body.gitObservations)) return undefined;
  if (!body.gitObservations.every(isRecord)) return undefined;
  if (body.gitResource !== undefined && !isRecord(body.gitResource)) {
    return undefined;
  }
  const resource = Object.freeze({...body.resource, workspaceId});
  const snapshot = Object.freeze({...body.snapshot, workspaceId});
  const gitObservations = Object.freeze(
    body.gitObservations.map((observation) =>
      Object.freeze({...observation, workspaceId}),
    ),
  );
  const candidate = {
    workspaceId,
    commandIdempotencyKey: body.commandIdempotencyKey,
    resource,
    ...(body.gitResource === undefined
      ? {}
      : {gitResource: Object.freeze({...body.gitResource, workspaceId})}),
    snapshot,
    gitObservations,
    profile: body.profile,
    sourceUtf8: new TextEncoder().encode(body.sourceText),
    ...(body.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: body.documentBaseUri}),
  };
  return Object.freeze(
    candidate as unknown as Readonly<ImportMarkdownEvidenceInput>,
  );
}

function decodeEntryRevisionBody(body: unknown):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      annotation: Readonly<{
        body: string;
        contentKeywords: readonly string[];
        typeKeyword: EntryTypeKeyword;
        typeCustomName?: string;
        domains: readonly Readonly<{
          keyword: EntryDomainKeyword;
          customName?: string;
        }>[];
      }>;
    }>
  | undefined {
  if (!isRecord(body) || !isRecord(body.annotation)) return undefined;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1 ||
    typeof (body.includePrivate ?? false) !== 'boolean'
  ) {
    return undefined;
  }
  const annotation = body.annotation;
  if (
    typeof annotation.body !== 'string' ||
    !Array.isArray(annotation.contentKeywords) ||
    !annotation.contentKeywords.every((value) => typeof value === 'string') ||
    typeof annotation.typeKeyword !== 'string' ||
    !ENTRY_TYPE_KEYWORDS.includes(annotation.typeKeyword as EntryTypeKeyword) ||
    (annotation.typeCustomName !== undefined &&
      typeof annotation.typeCustomName !== 'string') ||
    !Array.isArray(annotation.domains)
  ) {
    return undefined;
  }
  const domains = annotation.domains.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.keyword !== 'string' ||
      !ENTRY_DOMAIN_KEYWORDS.includes(value.keyword as EntryDomainKeyword) ||
      (value.customName !== undefined && typeof value.customName !== 'string')
    ) {
      return [];
    }
    return [
      Object.freeze({
        keyword: value.keyword as EntryDomainKeyword,
        ...(value.customName === undefined
          ? {}
          : {customName: value.customName}),
      }),
    ];
  });
  if (domains.length !== annotation.domains.length) return undefined;
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate: (body.includePrivate ?? false) as boolean,
    annotation: Object.freeze({
      body: annotation.body,
      contentKeywords: Object.freeze([
        ...annotation.contentKeywords,
      ] as string[]),
      typeKeyword: annotation.typeKeyword as EntryTypeKeyword,
      ...(annotation.typeCustomName === undefined
        ? {}
        : {typeCustomName: annotation.typeCustomName}),
      domains: Object.freeze(domains),
    }),
  });
}

function decodeEntrySearchBody(
  body: unknown,
): Readonly<InformationEntrySearchRequest> | undefined {
  if (!isRecord(body)) return undefined;
  const textValue = body.text ?? undefined;
  const snapshotId = body.snapshotId ?? undefined;
  const typeKeyword = body.typeKeyword ?? undefined;
  const domainKeyword = body.domainKeyword ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const limit = body.limit ?? 100;
  if (
    (textValue !== undefined && typeof textValue !== 'string') ||
    (snapshotId !== undefined &&
      (typeof snapshotId !== 'string' || !CANONICAL_UUID.test(snapshotId))) ||
    (typeKeyword !== undefined &&
      (typeof typeKeyword !== 'string' ||
        !ENTRY_TYPE_KEYWORDS.includes(typeKeyword as EntryTypeKeyword))) ||
    (domainKeyword !== undefined &&
      (typeof domainKeyword !== 'string' ||
        !ENTRY_DOMAIN_KEYWORDS.includes(
          domainKeyword as EntryDomainKeyword,
        ))) ||
    typeof includePrivate !== 'boolean' ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(textValue === undefined ? {} : {text: textValue}),
    ...(snapshotId === undefined ? {} : {snapshotId}),
    ...(typeKeyword === undefined
      ? {}
      : {typeKeyword: typeKeyword as EntryTypeKeyword}),
    ...(domainKeyword === undefined
      ? {}
      : {domainKeyword: domainKeyword as EntryDomainKeyword}),
    includePrivate,
    limit,
  });
}

function decodeDocumentTagWriteBody(
  body: unknown,
  requireTags: boolean,
):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      tags?: readonly string[];
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision > 2_147_483_647 ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  if (!requireTags) {
    if (body.tags !== undefined) return undefined;
    return Object.freeze({
      expectedRevision: body.expectedRevision,
      includePrivate,
    });
  }
  if (
    !Array.isArray(body.tags) ||
    !body.tags.every((value) => typeof value === 'string')
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    tags: Object.freeze([...body.tags] as string[]),
  });
}

function commandEnvelope(body: unknown): Readonly<{
  key: unknown;
  request: unknown;
}> {
  return isRecord(body)
    ? Object.freeze({
        key: body.commandIdempotencyKey,
        request: body.request,
      })
    : Object.freeze({key: undefined, request: undefined});
}

function commandContext(workspaceId: string, key: unknown): object {
  return Object.freeze({
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  });
}

async function materializeEvidenceSnapshot(
  snapshot: Readonly<EvidenceSnapshotReadState>,
  blobStore: BlobStore,
): Promise<Readonly<Record<string, unknown>>> {
  const structures = [];
  for (const structure of snapshot.structures) {
    const bytes = await blobStore.read(structure.textBlob);
    const normalizedText = new TextDecoder('utf-8', {fatal: true}).decode(
      bytes,
    );
    // Array.from follows the Evidence contract's Unicode code-point locators.
    const codePoints = Array.from(normalizedText);
    const fragments = structure.fragments.map((fragment) => {
      const selectedText = codePoints
        .slice(fragment.codePointRange.start, fragment.codePointRange.end)
        .join('');
      if (digestText(selectedText) !== fragment.selectedTextSha256) {
        throw new Error('Evidence fragment integrity failed.');
      }
      return Object.freeze({...fragment, selectedText});
    });
    structures.push(
      Object.freeze({
        ...structure,
        normalizedText,
        fragments: Object.freeze(fragments),
      }),
    );
  }
  return Object.freeze({...snapshot, structures: Object.freeze(structures)});
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function statusForImport(status: string): number {
  if (status === 'created') return 201;
  if (status === 'existing') return 200;
  if (status === 'conflict') return 409;
  if (status === 'persistence_failed') return 503;
  return 422;
}

function statusForDomainResult(result: Readonly<{status: string}>): number {
  if (result.status !== 'rejected') return 200;
  const issue = Reflect.get(result, 'issue') as unknown;
  const code = isRecord(issue) ? issue.code : undefined;
  if (code === 'persistence_failed') return 503;
  if (
    code === 'idempotency_conflict' ||
    code === 'stale_revision' ||
    code === 'stale_curation_revision'
  ) {
    return 409;
  }
  if (
    code === 'target_not_found' ||
    code === 'term_not_found' ||
    code === 'curation_target_not_found' ||
    code === 'fragment_not_found' ||
    code === 'item_not_found' ||
    code === 'relation_not_found' ||
    code === 'revision_not_found'
  ) {
    return 404;
  }
  return 422;
}

function inputFailure(path: string): M1cHttpResult {
  return httpResult(422, {
    status: 'rejected',
    issue: Object.freeze({code: 'invalid_http_input', path}),
  });
}

function repositoryFailure(): M1cHttpResult {
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: 'repository_failed'}),
  });
}

function workspaceTransferFailure(error: unknown): M1cHttpResult {
  if (!(error instanceof M1cWorkspaceTransferError)) {
    return httpResult(503, {
      status: 'failed',
      issue: Object.freeze({code: 'workspace_transfer_failed'}),
    });
  }
  if (
    error.code === 'bundle_not_found' ||
    error.code === 'workspace_not_found'
  ) {
    return httpResult(404, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (
    error.code === 'workspace_mismatch' ||
    error.code === 'workspace_not_empty'
  ) {
    return httpResult(409, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  if (error.code === 'bundle_invalid') {
    return httpResult(422, {
      status: 'rejected',
      issue: Object.freeze({code: error.code}),
    });
  }
  return httpResult(503, {
    status: 'failed',
    issue: Object.freeze({code: error.code}),
  });
}

function httpResult(statusCode: number, body: unknown): M1cHttpResult {
  return Object.freeze({statusCode, body});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

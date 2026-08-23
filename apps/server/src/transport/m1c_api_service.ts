import {createHash} from 'node:crypto';

import {
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS,
  InformationEntrySearchCursorError,
  buildInformationEntryKnowledgeGraph,
  buildInformationEntryAssociationProjection,
  deriveInformationDocumentTagRevisionId,
  deriveInformationEntryAssociationOverrideRevisionId,
  deriveInformationEntryRevisionId,
  listInformationEntryAssociations as selectInformationEntryAssociations,
  orderedInformationEntryAssociationPair,
  prepareAggregatedInformationDocumentTags,
  prepareInformationEntryAssociationOverride,
  prepareInformationEntryGraphEdit,
  prepareInformationEntryGraphRelation,
  prepareInformationEntryGraphVisibility,
  prepareManualInformationDocumentTags,
  prepareManualEntryRevision,
  prepareSplitInformationEntries,
  searchCurrentInformationEntries,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type InformationEntryAssociationAction,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryGraphDirection,
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
  readonly informationEntryRepository: InformationEntryRepositoryPort;
  readonly informationDocumentTagRepository: InformationDocumentTagRepositoryPort;
  readonly informationEntryAssociationRepository: InformationEntryAssociationRepositoryPort;
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
  loadReviewPreferences(): Promise<M1cHttpResult>;
  saveReviewPreferences(body: unknown): Promise<M1cHttpResult>;
  importMarkdown(body: unknown): Promise<M1cHttpResult>;
  materializeInformationEntries(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntry(
    entryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  searchInformationEntries(body: unknown): Promise<M1cHttpResult>;
  readInformationEntryKnowledgeGraph(body: unknown): Promise<M1cHttpResult>;
  reviseInformationEntryKnowledgeGraphEdge(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
  rebuildInformationEntryAssociations(body: unknown): Promise<M1cHttpResult>;
  listInformationEntryAssociations(
    entryId: string,
    includePrivate?: unknown,
  ): Promise<M1cHttpResult>;
  reviseInformationEntryAssociation(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult>;
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
        'information_entries',
        'information_document_tags',
        'information_entry_knowledge_graph',
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
      const [entries, associationSnapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          request.includePrivate,
        ),
        request.association === undefined
          ? Promise.resolve({projections: [], overrides: []})
          : this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
              this.#dependencies.workspaceId,
              request.includePrivate,
            ),
      ]);
      const result = searchCurrentInformationEntries(
        entries,
        request,
        associationSnapshot,
      );
      return httpResult(200, {status: 'ok', ...result});
    } catch (error) {
      if (error instanceof InformationEntrySearchCursorError) {
        return httpResult(422, {
          status: 'rejected',
          issue: Object.freeze({
            code: 'invalid_entry_search_cursor',
            path: 'body.after',
          }),
        });
      }
      return repositoryFailure();
    }
  }

  public async readInformationEntryKnowledgeGraph(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const input = decodeInformationEntryKnowledgeGraphRequest(body);
    if (input === undefined) return inputFailure('body');
    try {
      const [loadedEntries, associationSnapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
      ]);
      const entries = input.onlyPrivate
        ? loadedEntries.filter((entry) => entry.value.isPrivate)
        : loadedEntries;
      const searchResult = searchCurrentInformationEntries(entries, {
        ...(input.query === undefined ? {} : {text: input.query}),
        includePrivate: input.includePrivate,
        onlyPrivate: input.onlyPrivate,
        limit: input.candidateLimit,
      });
      const centerEntryId =
        input.centerEntryId ?? searchResult.items[0]?.entry.entryId;
      if (
        input.centerEntryId !== undefined &&
        !entries.some((entry) => entry.entryId === input.centerEntryId)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const graph =
        centerEntryId === undefined
          ? undefined
          : buildInformationEntryKnowledgeGraph(
              centerEntryId,
              entries,
              associationSnapshot,
              input.neighborLimit,
            );
      return httpResult(200, {
        status: 'ok',
        querySha256: searchResult.querySha256,
        candidateTotalCount: searchResult.totalCount,
        candidates: searchResult.items,
        graph: graph ?? null,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntryKnowledgeGraphEdge(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const input = decodeInformationEntryKnowledgeGraphEdgeWrite(body);
    const pair = orderedInformationEntryAssociationPair(
      entryId,
      relatedEntryId,
    );
    if (input === undefined || pair === undefined) return inputFailure('body');
    try {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
      ]);
      if (
        !entries.some((entry) => entry.entryId === entryId) ||
        !entries.some((entry) => entry.entryId === relatedEntryId)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const projection = snapshot.projections.find(
        (candidate) =>
          candidate.entryLowId === pair.entryLowId &&
          candidate.entryHighId === pair.entryHighId,
      );
      const current = snapshot.overrides.find(
        (candidate) =>
          candidate.entryLowId === pair.entryLowId &&
          candidate.entryHighId === pair.entryHighId,
      );
      if (
        input.operation !== 'edit' &&
        projection === undefined &&
        current?.value.graph === undefined
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({
            code: 'information_entry_graph_edge_not_found',
          }),
        });
      }
      let value;
      if (input.operation === 'edit') {
        const origin =
          current?.value.graph?.origin ??
          (projection === undefined ? 'user' : 'association');
        const graph = prepareInformationEntryGraphRelation(
          input.label,
          input.direction,
          origin,
        );
        if (graph === undefined) return inputFailure('body.label');
        value = prepareInformationEntryGraphEdit(
          current?.value,
          projection !== undefined,
          graph,
        );
      } else {
        value = prepareInformationEntryGraphVisibility(
          current?.value,
          projection !== undefined,
          input.operation === 'block',
        );
      }
      const outcome =
        await this.#dependencies.informationEntryAssociationRepository.writeAssociationOverride(
          {
            workspaceId: this.#dependencies.workspaceId,
            ...pair,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationEntryAssociationOverrideRevisionId(
              pair.entryLowId,
              pair.entryHighId,
              input.expectedRevision + 1,
            ),
            includePrivate: input.includePrivate,
            value,
          },
        );
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_association_override_revision'}),
        });
      }
      return httpResult(200, {status: outcome});
    } catch {
      return repositoryFailure();
    }
  }

  public async rebuildInformationEntryAssociations(
    body: unknown,
  ): Promise<M1cHttpResult> {
    const includePrivate = decodeInformationEntryAssociationScope(body);
    if (includePrivate === undefined) return inputFailure('body');
    try {
      const entries =
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        );
      const projections = buildInformationEntryAssociationProjection(entries);
      const projectedCount =
        await this.#dependencies.informationEntryAssociationRepository.replaceAssociationProjections(
          this.#dependencies.workspaceId,
          projections,
          includePrivate,
        );
      return httpResult(200, {
        status: 'rebuilt',
        entryCount: entries.length,
        projectedCount,
        policy: INFORMATION_ENTRY_ASSOCIATION_POLICY,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async listInformationEntryAssociations(
    entryId: string,
    includePrivate: unknown = false,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (typeof includePrivate !== 'boolean') {
      return inputFailure('query.includePrivate');
    }
    try {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          includePrivate,
        ),
      ]);
      if (!entries.some((entry) => entry.entryId === entryId)) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const associations = selectInformationEntryAssociations(
        entryId,
        entries,
        snapshot,
      );
      return httpResult(200, {
        status: 'ok',
        entryId,
        totalCount: associations.length,
        policy: INFORMATION_ENTRY_ASSOCIATION_POLICY,
        associations,
      });
    } catch {
      return repositoryFailure();
    }
  }

  public async reviseInformationEntryAssociation(
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ): Promise<M1cHttpResult> {
    if (!CANONICAL_UUID.test(entryId)) return inputFailure('path.entryId');
    if (!CANONICAL_UUID.test(relatedEntryId)) {
      return inputFailure('path.relatedEntryId');
    }
    const input = decodeInformationEntryAssociationOverride(body);
    const pair = orderedInformationEntryAssociationPair(
      entryId,
      relatedEntryId,
    );
    if (input === undefined || pair === undefined) return inputFailure('body');
    try {
      const [entries, snapshot] = await Promise.all([
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
        this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
          this.#dependencies.workspaceId,
          input.includePrivate,
        ),
      ]);
      if (
        !entries.some((entry) => entry.entryId === entryId) ||
        !entries.some((entry) => entry.entryId === relatedEntryId)
      ) {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      const current = snapshot.overrides.find(
        (candidate) =>
          candidate.entryLowId === pair.entryLowId &&
          candidate.entryHighId === pair.entryHighId,
      );
      const scoreValue = prepareInformationEntryAssociationOverride(
        input.action,
      );
      const value = Object.freeze({
        ...scoreValue,
        ...(current?.value.graph === undefined
          ? {}
          : {graph: current.value.graph}),
      });
      const outcome =
        await this.#dependencies.informationEntryAssociationRepository.writeAssociationOverride(
          {
            workspaceId: this.#dependencies.workspaceId,
            ...pair,
            expectedRevision: input.expectedRevision,
            revisionId: deriveInformationEntryAssociationOverrideRevisionId(
              pair.entryLowId,
              pair.entryHighId,
              input.expectedRevision + 1,
            ),
            includePrivate: input.includePrivate,
            value,
          },
        );
      if (outcome === 'not_found') {
        return httpResult(404, {
          status: 'not_found',
          issue: Object.freeze({code: 'information_entry_not_found'}),
        });
      }
      if (outcome === 'stale') {
        return httpResult(409, {
          status: 'rejected',
          issue: Object.freeze({code: 'stale_association_override_revision'}),
        });
      }
      return httpResult(200, {status: outcome});
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
        usefulnessScore?: 1 | 2 | 3 | 4 | 5;
        interestScore?: 1 | 2 | 3 | 4 | 5;
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
    !isOptionalAssessmentScore(annotation.usefulnessScore) ||
    !isOptionalAssessmentScore(annotation.interestScore) ||
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
      ...(annotation.usefulnessScore === undefined
        ? {}
        : {usefulnessScore: annotation.usefulnessScore}),
      ...(annotation.interestScore === undefined
        ? {}
        : {interestScore: annotation.interestScore}),
      domains: Object.freeze(domains),
    }),
  });
}

function decodeEntrySearchBody(
  body: unknown,
): Readonly<InformationEntrySearchRequest> | undefined {
  if (!isRecord(body)) return undefined;
  const textValue = optionalBoundedText(body.text, 300);
  const contentKeyword = optionalBoundedText(body.contentKeyword, 80);
  const sourceKey = optionalBoundedText(body.sourceKey, 2_048);
  const snapshotId = body.snapshotId ?? undefined;
  const typeKeyword = body.typeKeyword ?? undefined;
  const typeCustomName = optionalBoundedText(body.typeCustomName, 80);
  const domainKeyword = body.domainKeyword ?? undefined;
  const domainCustomName = optionalBoundedText(body.domainCustomName, 80);
  const domainScope = body.domainScope ?? 'any';
  const chunkMode = body.chunkMode ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const onlyPrivate = body.onlyPrivate ?? false;
  const limit = body.limit ?? 25;
  const time = decodeEntrySearchTime(body.time);
  const association = decodeEntrySearchAssociation(body.association);
  const after = decodeEntrySearchCursor(body.after);
  if (
    textValue === null ||
    contentKeyword === null ||
    sourceKey === null ||
    typeCustomName === null ||
    domainCustomName === null ||
    (snapshotId !== undefined &&
      (typeof snapshotId !== 'string' || !CANONICAL_UUID.test(snapshotId))) ||
    (typeKeyword !== undefined &&
      (typeof typeKeyword !== 'string' ||
        !ENTRY_TYPE_KEYWORDS.includes(typeKeyword as EntryTypeKeyword))) ||
    (typeCustomName !== undefined && typeKeyword !== 'other') ||
    (typeKeyword === 'other' && typeCustomName === undefined) ||
    (domainKeyword !== undefined &&
      (typeof domainKeyword !== 'string' ||
        !ENTRY_DOMAIN_KEYWORDS.includes(
          domainKeyword as EntryDomainKeyword,
        ))) ||
    (domainScope !== 'any' &&
      domainScope !== 'primary' &&
      domainScope !== 'secondary') ||
    (domainCustomName !== undefined && domainKeyword !== 'other') ||
    (domainKeyword === 'other' && domainCustomName === undefined) ||
    (domainKeyword === undefined && domainScope !== 'any') ||
    (chunkMode !== undefined &&
      (typeof chunkMode !== 'string' ||
        !ENTRY_CHUNK_MODES.includes(chunkMode as 'split' | 'whole'))) ||
    (body.time !== undefined && time === undefined) ||
    (body.association !== undefined && association === undefined) ||
    (body.after !== undefined && after === undefined) ||
    typeof includePrivate !== 'boolean' ||
    typeof onlyPrivate !== 'boolean' ||
    (onlyPrivate && !includePrivate) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(textValue === undefined ? {} : {text: textValue}),
    ...(contentKeyword === undefined ? {} : {contentKeyword}),
    ...(sourceKey === undefined ? {} : {sourceKey}),
    ...(snapshotId === undefined ? {} : {snapshotId}),
    ...(typeKeyword === undefined
      ? {}
      : {typeKeyword: typeKeyword as EntryTypeKeyword}),
    ...(typeCustomName === undefined ? {} : {typeCustomName}),
    ...(domainKeyword === undefined
      ? {}
      : {domainKeyword: domainKeyword as EntryDomainKeyword}),
    ...(domainCustomName === undefined ? {} : {domainCustomName}),
    domainScope,
    ...(chunkMode === undefined
      ? {}
      : {chunkMode: chunkMode as 'split' | 'whole'}),
    ...(time === undefined ? {} : {time}),
    ...(association === undefined ? {} : {association}),
    includePrivate,
    onlyPrivate,
    limit,
    ...(after === undefined ? {} : {after}),
  });
}

function isOptionalAssessmentScore(
  value: unknown,
): value is 1 | 2 | 3 | 4 | 5 | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5)
  );
}

function optionalBoundedText(
  value: unknown,
  maximumCodePoints: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC');
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).length <= maximumCodePoints ? normalized : null;
}

function decodeEntrySearchTime(body: unknown):
  | Readonly<{
      field: 'published' | 'captured';
      from?: string;
      to?: string;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (!isRecord(body)) return undefined;
  const from = body.from ?? undefined;
  const to = body.to ?? undefined;
  if (
    (body.field !== 'published' && body.field !== 'captured') ||
    (from !== undefined && (typeof from !== 'string' || !isIsoDate(from))) ||
    (to !== undefined && (typeof to !== 'string' || !isIsoDate(to))) ||
    (from === undefined && to === undefined) ||
    (typeof from === 'string' && typeof to === 'string' && from > to)
  ) {
    return undefined;
  }
  return Object.freeze({
    field: body.field,
    ...(typeof from === 'string' ? {from} : {}),
    ...(typeof to === 'string' ? {to} : {}),
  });
}

function decodeEntrySearchAssociation(body: unknown):
  | Readonly<{
      entryId: string;
      maximumDepth: 1 | 2;
      minimumScore: number;
    }>
  | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId) ||
    (body.maximumDepth !== 1 && body.maximumDepth !== 2) ||
    typeof body.minimumScore !== 'number' ||
    !Number.isSafeInteger(body.minimumScore) ||
    body.minimumScore < 0 ||
    body.minimumScore > 10_000
  ) {
    return undefined;
  }
  return Object.freeze({
    entryId: body.entryId,
    maximumDepth: body.maximumDepth,
    minimumScore: body.minimumScore,
  });
}

function decodeEntrySearchCursor(
  body: unknown,
): Readonly<NonNullable<InformationEntrySearchRequest['after']>> | undefined {
  if (body === undefined) return undefined;
  if (
    !isRecord(body) ||
    body.schemaVersion !== 1 ||
    typeof body.querySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(body.querySha256) ||
    typeof body.associationDepth !== 'number' ||
    !Number.isSafeInteger(body.associationDepth) ||
    body.associationDepth < 0 ||
    body.associationDepth > 2 ||
    typeof body.matchReasonCount !== 'number' ||
    !Number.isSafeInteger(body.matchReasonCount) ||
    body.matchReasonCount < 0 ||
    body.matchReasonCount > 5 ||
    typeof body.associationScore !== 'number' ||
    !Number.isSafeInteger(body.associationScore) ||
    body.associationScore < 0 ||
    body.associationScore > 10_000 ||
    typeof body.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(body.capturedAt)) ||
    typeof body.documentOrder !== 'number' ||
    !Number.isSafeInteger(body.documentOrder) ||
    body.documentOrder < 0 ||
    typeof body.entryId !== 'string' ||
    !CANONICAL_UUID.test(body.entryId)
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    querySha256: body.querySha256,
    associationDepth: body.associationDepth,
    matchReasonCount: body.matchReasonCount,
    associationScore: body.associationScore,
    capturedAt: new Date(body.capturedAt).toISOString(),
    documentOrder: body.documentOrder,
    entryId: body.entryId,
  });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function decodeInformationEntryKnowledgeGraphRequest(body: unknown):
  | Readonly<{
      query?: string;
      centerEntryId?: string;
      includePrivate: boolean;
      onlyPrivate: boolean;
      candidateLimit: number;
      neighborLimit: number;
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const query = optionalBoundedText(body.query, 300);
  const centerEntryId = body.centerEntryId ?? undefined;
  const includePrivate = body.includePrivate ?? false;
  const onlyPrivate = body.onlyPrivate ?? false;
  const candidateLimit = body.candidateLimit ?? 8;
  const neighborLimit = body.neighborLimit ?? 12;
  if (
    query === null ||
    (centerEntryId !== undefined &&
      (typeof centerEntryId !== 'string' ||
        !CANONICAL_UUID.test(centerEntryId))) ||
    typeof includePrivate !== 'boolean' ||
    typeof onlyPrivate !== 'boolean' ||
    (onlyPrivate && !includePrivate) ||
    typeof candidateLimit !== 'number' ||
    !Number.isSafeInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 12 ||
    typeof neighborLimit !== 'number' ||
    !Number.isSafeInteger(neighborLimit) ||
    neighborLimit < 1 ||
    neighborLimit > INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(query === undefined ? {} : {query}),
    ...(centerEntryId === undefined ? {} : {centerEntryId}),
    includePrivate,
    onlyPrivate,
    candidateLimit,
    neighborLimit,
  });
}

function decodeInformationEntryKnowledgeGraphEdgeWrite(body: unknown):
  | Readonly<
      | {
          expectedRevision: number;
          includePrivate: boolean;
          operation: 'edit';
          label: string;
          direction: InformationEntryGraphDirection;
        }
      | {
          expectedRevision: number;
          includePrivate: boolean;
          operation: 'block' | 'restore';
        }
    >
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= 2_147_483_647 ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  if (body.operation === 'edit') {
    if (
      typeof body.label !== 'string' ||
      typeof body.direction !== 'string' ||
      !INFORMATION_ENTRY_GRAPH_DIRECTIONS.includes(
        body.direction as InformationEntryGraphDirection,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      expectedRevision: body.expectedRevision,
      includePrivate,
      operation: 'edit' as const,
      label: body.label,
      direction: body.direction as InformationEntryGraphDirection,
    });
  }
  if (
    (body.operation !== 'block' && body.operation !== 'restore') ||
    body.label !== undefined ||
    body.direction !== undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    operation: body.operation,
  });
}

function decodeInformationEntryAssociationScope(
  body: unknown,
): boolean | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  return typeof includePrivate === 'boolean' ? includePrivate : undefined;
}

function decodeInformationEntryAssociationOverride(body: unknown):
  | Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      action: InformationEntryAssociationAction;
    }>
  | undefined {
  if (!isRecord(body)) return undefined;
  const includePrivate = body.includePrivate ?? false;
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= 2_147_483_647 ||
    typeof body.action !== 'string' ||
    !INFORMATION_ENTRY_ASSOCIATION_ACTIONS.includes(
      body.action as InformationEntryAssociationAction,
    ) ||
    typeof includePrivate !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    expectedRevision: body.expectedRevision,
    includePrivate,
    action: body.action as InformationEntryAssociationAction,
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

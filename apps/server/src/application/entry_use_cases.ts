import {
  ENTRY_TEXT_SEARCH_FIELDS,
  deriveInformationEntryRevisionId,
  informationEntrySearchKey,
  prepareManualEntryRevision,
  scoreInformationEntrySearchText,
  searchCurrentInformationEntries,
  type CurrentInformationEntry,
  type EntryTextSearchMode,
  type InformationEntrySearchResult,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryRepositoryPort,
  type InformationEntryRetrievalServicePort,
  type InformationEntrySearchRequest,
} from '../modules/entries/index.js';
import type {ManualEntryAnnotationInput} from '../modules/entries/information_entry.js';
import {decodeEntrySearchBody} from '../modules/entries/information_entry_search_request.js';
import {
  loadCachedEntrySearchTranslations,
  type EntryTranslationSearchRepositoryPort,
} from '../modules/entries/information_entry_translation.js';
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
  type EvidenceSnapshotSummary,
} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';

import type {ExecutionAuthority} from './execution_authority.js';
import {
  OperationError,
  assertOperationId,
  assertOperationVersion,
} from './operation_error.js';
export interface PrivateDocumentSearchMatch {
  readonly snapshot: Readonly<EvidenceSnapshotSummary>;
  readonly matchReasons: readonly string[];
  readonly entryMatchCount: number;
  readonly textMatch?: Readonly<{mode: EntryTextSearchMode; score: number}>;
  readonly excerpt?: string;
}
export interface PrivateDocumentSearchResult {
  readonly totalCount: number;
  readonly items: readonly Readonly<PrivateDocumentSearchMatch>[];
}
export type EntrySearchResult = Readonly<
  InformationEntrySearchResult & {
    status: 'ok';
    privateDocuments: Readonly<PrivateDocumentSearchResult>;
  }
>;
export interface EntryRevisionRequest {
  readonly expectedRevision: number;
  readonly includePrivate: boolean;
  readonly annotation: Readonly<ManualEntryAnnotationInput>;
}
export interface EntryUseCasesDependencies {
  readonly blobStore: BlobStore;
  readonly evidenceReadRepository: EvidenceReadRepositoryPort;
  readonly informationEntryRepository: InformationEntryRepositoryPort;
  readonly informationEntryAssociationRepository: InformationEntryAssociationRepositoryPort;
  readonly informationEntryRetrieval?: InformationEntryRetrievalServicePort;
  readonly entryTranslationSearch?: EntryTranslationSearchRepositoryPort;
}

export class EntryUseCases {
  readonly #dependencies: Readonly<EntryUseCasesDependencies>;
  readonly #authority: ExecutionAuthority;
  public constructor(
    authority: ExecutionAuthority,
    dependencies: Readonly<EntryUseCasesDependencies>,
  ) {
    this.#authority = authority;
    this.#dependencies = dependencies;
  }
  public async read(entryId: string) {
    this.#authority.require('entries.search');
    assertOperationId(entryId, 'entryId');
    const entry = (
      await this.#loadCurrentInformationEntriesByIds([entryId], false)
    ).find((e) => !e.value.isPrivate);
    if (!entry)
      throw new OperationError('not_found', 'information_entry_not_found');
    return entry;
  }
  public async revise(entryId: string, input: EntryRevisionRequest) {
    this.#authority.require('entries.revise', input.includePrivate);
    assertOperationId(entryId, 'entryId');
    assertOperationVersion(input.expectedRevision, 'expectedRevision');

    const entries = await this.#loadCurrentInformationEntriesByIds(
      [entryId],
      input.includePrivate,
    );
    const current = entries.find((entry) => entry.entryId === entryId);
    if (current === undefined) {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    const value = prepareManualEntryRevision(current, input.annotation);
    if (value === undefined)
      throw new OperationError(
        'invalid_input',
        'invalid_request',
        'annotation',
      );
    const outcome =
      await this.#dependencies.informationEntryRepository.reviseEntry({
        workspaceId: this.#authority.workspaceId,
        entryId,
        expectedRevision: input.expectedRevision,
        revisionId: deriveInformationEntryRevisionId(
          entryId,
          input.expectedRevision + 1,
        ),
        value,
      });
    if (outcome === 'not_found') {
      throw new OperationError('not_found', 'information_entry_not_found');
    }
    if (outcome === 'stale') {
      throw new OperationError('conflict', 'stale_entry_revision');
    }
    const refreshed = await this.#loadCurrentInformationEntriesByIds(
      [entryId],
      input.includePrivate,
    );
    return {
      status: outcome,
      entry: refreshed.find((entry) => entry.entryId === entryId),
    };
  }
  public async search(
    input: Readonly<InformationEntrySearchRequest>,
  ): Promise<EntrySearchResult> {
    this.#authority.require('entries.search', input.includePrivate);
    const request = decodeEntrySearchBody(input);
    if (request === undefined)
      throw new OperationError('invalid_input', 'invalid_request');
    if ((request.retrievalMode ?? 'lexical') !== 'lexical')
      this.#authority.require('models.use');

    const retrievalMode = request.retrievalMode ?? 'lexical';
    if (
      this.#dependencies.informationEntryRetrieval !== undefined &&
      (retrievalMode !== 'lexical' || !request.includePrivate)
    ) {
      const result =
        await this.#dependencies.informationEntryRetrieval.search(request);
      return {
        status: 'ok' as const,
        ...result,
        privateDocuments: Object.freeze({
          totalCount: 0,
          items: Object.freeze([]),
        }),
      };
    }
    const [entries, associationSnapshot, translations] = await Promise.all([
      this.#dependencies.informationEntryRepository.loadCurrentEntries(
        this.#authority.workspaceId,
        request.includePrivate,
      ),
      request.association === undefined
        ? Promise.resolve({projections: [], overrides: []})
        : this.#dependencies.informationEntryAssociationRepository.loadAssociationSnapshot(
            this.#authority.workspaceId,
            request.includePrivate,
          ),
      loadCachedEntrySearchTranslations(
        this.#authority.workspaceId,
        request,
        this.#dependencies.entryTranslationSearch,
      ),
    ]);
    const result = searchCurrentInformationEntries(
      entries,
      request,
      associationSnapshot,
      undefined,
      translations,
    );
    const privateDocuments = await this.#searchPrivateDocuments(
      request,
      entries,
      associationSnapshot,
    );
    return {
      status: 'ok' as const,
      ...result,
      privateDocuments,
    };
  }
  async #loadCurrentInformationEntriesByIds(
    entryIds: readonly string[],
    includePrivate: boolean,
  ): Promise<readonly Readonly<CurrentInformationEntry>[]> {
    const repository = this.#dependencies.informationEntryRepository;
    return repository.loadCurrentEntriesByIds === undefined
      ? repository.loadCurrentEntries(
          this.#authority.workspaceId,
          includePrivate,
        )
      : repository.loadCurrentEntriesByIds(
          this.#authority.workspaceId,
          includePrivate,
          entryIds,
        );
  }
  async #searchPrivateDocuments(
    request: Readonly<InformationEntrySearchRequest>,
    entries: readonly Readonly<CurrentInformationEntry>[],
    associationSnapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  ): Promise<Readonly<PrivateDocumentSearchResult>> {
    if (!request.includePrivate) {
      return Object.freeze({totalCount: 0, items: Object.freeze([])});
    }
    const textMode = request.textMode ?? 'substring';
    const textFields = request.textFields ?? ENTRY_TEXT_SEARCH_FIELDS;
    const requiresStructuralEntryMatch =
      request.contentKeyword !== undefined ||
      request.typeKeyword !== undefined ||
      request.typeCustomName !== undefined ||
      request.domainKeyword !== undefined ||
      request.domainCustomName !== undefined ||
      request.chunkMode !== undefined ||
      request.association !== undefined;
    const {
      text: ignoredText,
      textMode: ignoredTextMode,
      textFields: ignoredTextFields,
      after: ignoredAfter,
      ...structuralRequest
    } = request;
    void ignoredText;
    void ignoredTextMode;
    void ignoredTextFields;
    void ignoredAfter;
    const structuralEntryMatches = requiresStructuralEntryMatch
      ? searchCurrentInformationEntries(
          entries,
          {
            ...structuralRequest,
            limit: Math.max(1, entries.length),
          },
          associationSnapshot,
        ).items
      : Object.freeze([]);
    const structuralEntryMatchCounts = entryMatchCountsBySnapshot(
      structuralEntryMatches,
    );
    const query = informationEntrySearchKey(request.text ?? '');
    const tagEntryMatches =
      query !== '' && textFields.includes('tags')
        ? searchCurrentInformationEntries(
            entries,
            {
              ...structuralRequest,
              text: request.text ?? '',
              textMode,
              textFields: Object.freeze(['tags']),
              limit: Math.max(1, entries.length),
            },
            associationSnapshot,
          ).items
        : Object.freeze([]);
    const tagEntryMatchesBySnapshot = new Map<
      string,
      Readonly<{count: number; score: number}>
    >();
    for (const match of tagEntryMatches) {
      if (!match.entry.value.isPrivate || match.textMatch === undefined)
        continue;
      const previous = tagEntryMatchesBySnapshot.get(match.entry.snapshotId);
      tagEntryMatchesBySnapshot.set(
        match.entry.snapshotId,
        Object.freeze({
          count: (previous?.count ?? 0) + 1,
          score: Math.max(previous?.score ?? 0, match.textMatch.score),
        }),
      );
    }
    const summaries = (
      await this.#dependencies.evidenceReadRepository.listSnapshots(
        this.#authority.workspaceId,
      )
    )
      .filter((snapshot) => snapshot.isPrivate === true)
      .filter((snapshot) =>
        privateDocumentMatchesStructuralFilters(
          snapshot,
          request,
          requiresStructuralEntryMatch ? structuralEntryMatchCounts : undefined,
        ),
      )
      .sort((left, right) => {
        const captured = right.capturedAt.localeCompare(left.capturedAt);
        return captured === 0
          ? left.snapshotId.localeCompare(right.snapshotId)
          : captured;
      });
    const items: Readonly<PrivateDocumentSearchMatch>[] = [];
    for (const summary of summaries) {
      const matchReasons: string[] = [];
      let excerpt: string | undefined;
      let textScore = 0;
      if (query !== '') {
        if (textFields.includes('title')) {
          const sourceScore = scoreInformationEntrySearchText(
            summary.sourceKey,
            query,
            textMode,
          );
          if (sourceScore !== undefined) {
            matchReasons.push('source');
            textScore = Math.max(textScore, sourceScore);
          }
          if (summary.canonicalUri !== undefined) {
            const uriScore = scoreInformationEntrySearchText(
              summary.canonicalUri,
              query,
              textMode,
            );
            if (uriScore !== undefined) {
              matchReasons.push('uri');
              textScore = Math.max(textScore, uriScore);
            }
          }
        }
        if (textFields.includes('tags')) {
          const tagMatch = tagEntryMatchesBySnapshot.get(summary.snapshotId);
          if (tagMatch !== undefined) {
            matchReasons.push('entry_tags');
            textScore = Math.max(textScore, tagMatch.score);
          }
        }
        if (textFields.includes('body')) {
          const snapshot =
            await this.#dependencies.evidenceReadRepository.loadSnapshot(
              this.#authority.workspaceId,
              summary.snapshotId,
            );
          if (snapshot === undefined) {
            throw new Error(
              'Private evidence Snapshot disappeared during search.',
            );
          }
          const materialized = await materializeEvidenceSnapshot(
            snapshot,
            this.#dependencies.blobStore,
          );
          const documentText = materialized.structures
            .map((structure) =>
              typeof structure.normalizedText === 'string'
                ? structure.normalizedText
                : '',
            )
            .join('\n');
          const bodyScore = scoreInformationEntrySearchText(
            documentText,
            query,
            textMode,
          );
          if (bodyScore !== undefined) {
            matchReasons.push('body');
            textScore = Math.max(textScore, bodyScore);
            excerpt = privateDocumentExcerpt(documentText);
          }
        }
        if (matchReasons.length === 0) continue;
      }
      const structuralCount =
        structuralEntryMatchCounts.get(summary.snapshotId) ?? 0;
      const tagCount =
        tagEntryMatchesBySnapshot.get(summary.snapshotId)?.count ?? 0;
      items.push(
        Object.freeze({
          snapshot: summary,
          matchReasons: Object.freeze(matchReasons),
          entryMatchCount: Math.max(structuralCount, tagCount),
          ...(query === ''
            ? {}
            : {textMatch: Object.freeze({mode: textMode, score: textScore})}),
          ...(excerpt === undefined ? {} : {excerpt}),
        }),
      );
    }
    return Object.freeze({
      totalCount: items.length,
      items: Object.freeze(items),
    });
  }
}

function entryMatchCountsBySnapshot(
  matches: readonly Readonly<{entry: Readonly<CurrentInformationEntry>}>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (!match.entry.value.isPrivate) continue;
    counts.set(
      match.entry.snapshotId,
      (counts.get(match.entry.snapshotId) ?? 0) + 1,
    );
  }
  return counts;
}
function privateDocumentMatchesStructuralFilters(
  snapshot: Readonly<EvidenceSnapshotSummary>,
  request: Readonly<InformationEntrySearchRequest>,
  entryMatchCounts?: ReadonlyMap<string, number>,
): boolean {
  if (
    request.sourceKey !== undefined &&
    snapshot.sourceKey !== request.sourceKey
  ) {
    return false;
  }
  if (
    request.snapshotId !== undefined &&
    snapshot.snapshotId !== request.snapshotId
  ) {
    return false;
  }
  if (request.time !== undefined) {
    const value =
      request.time.field === 'published'
        ? snapshot.publication?.instant
        : snapshot.capturedAt;
    if (value === undefined) return false;
    const date = value.slice(0, 10);
    if (
      (request.time.from !== undefined && date < request.time.from) ||
      (request.time.to !== undefined && date > request.time.to)
    ) {
      return false;
    }
  }
  return (
    entryMatchCounts === undefined ||
    (entryMatchCounts.get(snapshot.snapshotId) ?? 0) > 0
  );
}
function privateDocumentExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(normalized);
  return codePoints.length <= 280
    ? normalized
    : `${codePoints.slice(0, 277).join('')}…`;
}

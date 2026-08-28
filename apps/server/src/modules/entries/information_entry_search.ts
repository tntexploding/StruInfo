import {createHash} from 'node:crypto';

import type {
  CurrentInformationEntry,
  EntryTextSearchField,
  EntryTextSearchMode,
  InformationEntryAssociationMatch,
  InformationEntryAssociationPathStep,
  InformationEntryFilterReason,
  InformationEntryMatchReason,
  InformationEntrySearchCursor,
  InformationEntrySearchItem,
  InformationEntrySearchRequest,
  InformationEntrySearchResult,
} from './information_entry_contract.js';
import type {InformationEntryAssociationRepositorySnapshot} from './information_entry_association_contract.js';
import {prepareInformationEntryAssociationReadIndex} from './information_entry_association.js';
import {informationEntrySearchKey} from './information_entry.js';

export class InformationEntrySearchCursorError extends Error {
  public constructor() {
    super('Information Entry search cursor does not match the query.');
    this.name = 'InformationEntrySearchCursorError';
  }
}

const DEFAULT_TEXT_SEARCH_FIELDS: readonly EntryTextSearchField[] =
  Object.freeze(['title', 'body', 'tags']);
export const ENTRY_FUZZY_MINIMUM_SCORE = 4_500;

interface AssociationVisit {
  readonly depth: number;
  readonly effectiveScore: number;
  readonly path: readonly Readonly<InformationEntryAssociationPathStep>[];
}

export function searchCurrentInformationEntries(
  entries: readonly Readonly<CurrentInformationEntry>[],
  request: Readonly<InformationEntrySearchRequest>,
  associationSnapshot: Readonly<InformationEntryAssociationRepositorySnapshot> = Object.freeze(
    {projections: Object.freeze([]), overrides: Object.freeze([])},
  ),
  semanticMatches: ReadonlyMap<
    string,
    Readonly<{
      score: number;
      provider: string;
      model: string;
      indexVersion: string;
    }>
  > = new Map(),
): Readonly<InformationEntrySearchResult> {
  const querySha256 = informationEntryQuerySha256(request);
  if (
    request.after !== undefined &&
    request.after.querySha256 !== querySha256
  ) {
    throw new InformationEntrySearchCursorError();
  }

  const visibleEntries = entries.filter((entry) =>
    request.onlyPrivate
      ? entry.value.isPrivate
      : request.includePrivate || !entry.value.isPrivate,
  );
  const associationMatches =
    request.association === undefined
      ? undefined
      : buildAssociationMatches(
          visibleEntries,
          associationSnapshot,
          request.association,
        );
  const query = informationEntrySearchKey(request.text ?? '');
  const retrievalMode = request.retrievalMode ?? 'lexical';
  const textMode = request.textMode ?? 'substring';
  const textFields = canonicalTextSearchFields(request.textFields);
  const matches = visibleEntries.flatMap((entry) => {
    const filterReasons = structuralFilterReasons(entry, request);
    if (filterReasons === undefined) return [];
    const association = associationMatches?.get(entry.entryId);
    if (associationMatches !== undefined && association === undefined)
      return [];
    const textMatch = matchInformationEntryText(
      entry,
      query,
      textMode,
      textFields,
    );
    const semanticMatch = semanticMatches.get(entry.entryId);
    if (
      query !== '' &&
      ((retrievalMode === 'lexical' && textMatch === undefined) ||
        (retrievalMode === 'semantic' && semanticMatch === undefined) ||
        (retrievalMode === 'hybrid' &&
          textMatch === undefined &&
          semanticMatch === undefined))
    ) {
      return [];
    }
    const retrievalScore = effectiveRetrievalScore(
      retrievalMode,
      textMatch?.score,
      semanticMatch?.score,
    );
    return [
      Object.freeze({
        entry,
        matchReasons: textMatch?.reasons ?? Object.freeze([]),
        ...(textMatch === undefined
          ? {}
          : {
              textMatch: Object.freeze({
                mode: textMode,
                score: textMatch.score,
              }),
            }),
        ...(semanticMatch === undefined ? {} : {semanticMatch}),
        ...(query === '' || retrievalMode === 'lexical'
          ? {}
          : {retrievalScore}),
        filterReasons: Object.freeze(filterReasons),
        ...(association === undefined ? {} : {association}),
      }),
    ];
  });
  matches.sort(compareSearchItems);
  const after = request.after;
  const afterMatches =
    after === undefined
      ? matches
      : matches.filter((item) => compareSearchItemToCursor(item, after) > 0);
  const page = afterMatches.slice(0, request.limit);
  const last = page.at(-1);
  return Object.freeze({
    querySha256,
    ...(retrievalMode === 'lexical' ? {} : {retrievalMode}),
    totalCount: matches.length,
    items: Object.freeze(page),
    ...(last === undefined || afterMatches.length <= request.limit
      ? {}
      : {nextCursor: searchCursorFor(last, querySha256)}),
  });
}

export function informationEntryQuerySha256(
  request: Readonly<InformationEntrySearchRequest>,
): string {
  const projection = {
    schemaVersion: 'struinfo.information-entry-search.v2',
    ...(request.retrievalMode === undefined ||
    request.retrievalMode === 'lexical'
      ? {}
      : {retrievalMode: request.retrievalMode}),
    text: Object.freeze({
      value: informationEntrySearchKey(request.text ?? ''),
      mode: request.textMode ?? 'substring',
      fields: canonicalTextSearchFields(request.textFields),
    }),
    contentKeyword: informationEntrySearchKey(request.contentKeyword ?? ''),
    sourceKey: request.sourceKey ?? '',
    snapshotId: request.snapshotId ?? '',
    typeKeyword: request.typeKeyword ?? '',
    typeCustomName: informationEntrySearchKey(request.typeCustomName ?? ''),
    domainKeyword: request.domainKeyword ?? '',
    domainCustomName: informationEntrySearchKey(request.domainCustomName ?? ''),
    domainScope: request.domainScope ?? 'any',
    chunkMode: request.chunkMode ?? '',
    time: request.time ?? null,
    association: request.association ?? null,
    includePrivate: request.includePrivate,
    onlyPrivate: request.onlyPrivate,
  };
  return createHash('sha256')
    .update(`${JSON.stringify(projection)}\n`, 'utf8')
    .digest('hex');
}

function structuralFilterReasons(
  entry: Readonly<CurrentInformationEntry>,
  request: Readonly<InformationEntrySearchRequest>,
): InformationEntryFilterReason[] | undefined {
  const reasons: InformationEntryFilterReason[] = [];
  if (request.contentKeyword !== undefined) {
    const expected = informationEntrySearchKey(request.contentKeyword);
    if (
      !entry.value.contentKeywords.some(
        (keyword) => keyword.normalizedValue === expected,
      )
    ) {
      return undefined;
    }
    reasons.push('content_keyword');
  }
  if (request.sourceKey !== undefined) {
    if (entry.sourceKey !== request.sourceKey) return undefined;
    reasons.push('source');
  }
  if (request.snapshotId !== undefined) {
    if (entry.snapshotId !== request.snapshotId) return undefined;
    reasons.push('document');
  }
  if (request.typeKeyword !== undefined) {
    if (entry.value.typeKeyword !== request.typeKeyword) return undefined;
    if (
      request.typeCustomName !== undefined &&
      informationEntrySearchKey(entry.value.typeCustomName ?? '') !==
        informationEntrySearchKey(request.typeCustomName)
    ) {
      return undefined;
    }
    reasons.push('type');
  }
  if (request.domainKeyword !== undefined) {
    const domains =
      request.domainScope === 'primary'
        ? entry.value.domains.slice(0, 1)
        : request.domainScope === 'secondary'
          ? entry.value.domains.slice(1)
          : entry.value.domains;
    if (
      !domains.some(
        (domain) =>
          domain.keyword === request.domainKeyword &&
          (request.domainCustomName === undefined ||
            informationEntrySearchKey(domain.customName ?? '') ===
              informationEntrySearchKey(request.domainCustomName)),
      )
    ) {
      return undefined;
    }
    reasons.push('domain');
  }
  if (request.chunkMode !== undefined) {
    if (entry.value.chunkMode !== request.chunkMode) return undefined;
    reasons.push('chunk_mode');
  }
  if (request.time !== undefined) {
    const value =
      request.time.field === 'published' ? entry.publishedAt : entry.capturedAt;
    if (value === undefined) return undefined;
    const date = value.slice(0, 10);
    if (
      (request.time.from !== undefined && date < request.time.from) ||
      (request.time.to !== undefined && date > request.time.to)
    ) {
      return undefined;
    }
    reasons.push(
      request.time.field === 'published' ? 'published_time' : 'captured_time',
    );
  }
  if (entry.value.isPrivate) reasons.push('private_scope');
  return reasons;
}

function canonicalTextSearchFields(
  fields: readonly EntryTextSearchField[] | undefined,
): readonly EntryTextSearchField[] {
  if (fields === undefined) return DEFAULT_TEXT_SEARCH_FIELDS;
  return Object.freeze(
    DEFAULT_TEXT_SEARCH_FIELDS.filter((field) => fields.includes(field)),
  );
}
interface InformationEntryTextMatchEvaluation {
  readonly reasons: readonly InformationEntryMatchReason[];
  readonly score: number;
}

function matchInformationEntryText(
  entry: Readonly<CurrentInformationEntry>,
  query: string,
  mode: EntryTextSearchMode,
  fields: readonly EntryTextSearchField[],
): Readonly<InformationEntryTextMatchEvaluation> | undefined {
  if (query === '') return undefined;
  const selected = new Set(fields);
  const reasons: InformationEntryMatchReason[] = [];
  let score = 0;
  const addReason = (
    reason: InformationEntryMatchReason,
    candidates: readonly string[],
  ): void => {
    const candidateScore = maximumCandidateScore(candidates, query, mode);
    if (candidateScore === undefined) return;
    reasons.push(reason);
    score = Math.max(score, candidateScore);
  };

  if (selected.has('title')) {
    addReason('title', [entry.value.titlePath]);
  }
  if (selected.has('body')) {
    addReason('body', [entry.value.body]);
  }
  if (selected.has('tags')) {
    addReason(
      'content_keyword',
      entry.value.contentKeywords.map((keyword) => keyword.normalizedValue),
    );
    if (entry.value.typeKeyword !== undefined) {
      addReason('type_keyword', [
        entry.value.typeCustomName ?? entry.value.typeKeyword,
      ]);
    }
    addReason(
      'domain_keyword',
      entry.value.domains.map((domain) => domain.customName ?? domain.keyword),
    );
  }

  return reasons.length === 0
    ? undefined
    : Object.freeze({reasons: Object.freeze(reasons), score});
}

function maximumCandidateScore(
  candidates: readonly string[],
  query: string,
  mode: EntryTextSearchMode,
): number | undefined {
  let maximum: number | undefined;
  for (const candidate of candidates) {
    const score = scoreInformationEntrySearchText(candidate, query, mode);
    if (score !== undefined && (maximum === undefined || score > maximum)) {
      maximum = score;
    }
  }
  return maximum;
}

/**
 * Scores one candidate with the same deterministic lexical semantics used by
 * Entry and complete-private-document search. The result is basis points.
 */
export function scoreInformationEntrySearchText(
  candidate: string,
  query: string,
  mode: EntryTextSearchMode,
): number | undefined {
  const normalizedCandidate = informationEntrySearchKey(candidate);
  const normalizedQuery = informationEntrySearchKey(query);
  if (normalizedQuery === '') return undefined;
  if (normalizedCandidate === normalizedQuery) return 10_000;
  if (mode === 'exact') return undefined;
  if (normalizedCandidate.includes(normalizedQuery)) return 9_000;
  if (mode === 'substring') return undefined;

  const score = fuzzySubstringScore(normalizedCandidate, normalizedQuery);
  return score < ENTRY_FUZZY_MINIMUM_SCORE ? undefined : score;
}

function fuzzySubstringScore(candidate: string, query: string): number {
  const candidatePoints = Array.from(candidate);
  const queryPoints = Array.from(query);
  if (queryPoints.length < 3 || candidatePoints.length < 2) return 0;
  let maximum = 0;
  for (const windowLength of [
    queryPoints.length - 1,
    queryPoints.length,
    queryPoints.length + 1,
  ]) {
    if (windowLength < 2 || windowLength > candidatePoints.length) continue;
    maximum = Math.max(
      maximum,
      maximumWindowGramScore(queryPoints, candidatePoints, windowLength),
    );
  }
  return Math.min(8_999, maximum);
}

function maximumWindowGramScore(
  query: readonly string[],
  candidate: readonly string[],
  windowLength: number,
): number {
  const queryCharacters = multiset(query);
  const queryBigrams = multiset(bigrams(query));
  const windowCharacters = multiset(candidate.slice(0, windowLength));
  const windowBigrams = multiset(bigrams(candidate.slice(0, windowLength)));
  let characterOverlap = multisetOverlap(queryCharacters, windowCharacters);
  let bigramOverlap = multisetOverlap(queryBigrams, windowBigrams);
  let maximum = combinedGramScore(
    query.length,
    windowLength,
    characterOverlap,
    bigramOverlap,
  );

  for (let start = 1; start + windowLength <= candidate.length; start += 1) {
    characterOverlap = adjustWindowCount(
      windowCharacters,
      candidate[start - 1] ?? '',
      -1,
      queryCharacters,
      characterOverlap,
    );
    characterOverlap = adjustWindowCount(
      windowCharacters,
      candidate[start + windowLength - 1] ?? '',
      1,
      queryCharacters,
      characterOverlap,
    );
    bigramOverlap = adjustWindowCount(
      windowBigrams,
      bigramKey(candidate[start - 1] ?? '', candidate[start] ?? ''),
      -1,
      queryBigrams,
      bigramOverlap,
    );
    bigramOverlap = adjustWindowCount(
      windowBigrams,
      bigramKey(
        candidate[start + windowLength - 2] ?? '',
        candidate[start + windowLength - 1] ?? '',
      ),
      1,
      queryBigrams,
      bigramOverlap,
    );
    maximum = Math.max(
      maximum,
      combinedGramScore(
        query.length,
        windowLength,
        characterOverlap,
        bigramOverlap,
      ),
    );
  }
  return maximum;
}

function combinedGramScore(
  queryLength: number,
  windowLength: number,
  characterOverlap: number,
  bigramOverlap: number,
): number {
  const characterDice = (2 * characterOverlap) / (queryLength + windowLength);
  const bigramDice = (2 * bigramOverlap) / (queryLength + windowLength - 2);
  return Math.floor(characterDice * 4_000 + bigramDice * 6_000);
}

function multiset(values: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function multisetOverlap(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  let overlap = 0;
  for (const [key, count] of left) {
    overlap += Math.min(count, right.get(key) ?? 0);
  }
  return overlap;
}

function adjustWindowCount(
  counts: Map<string, number>,
  key: string,
  delta: -1 | 1,
  queryCounts: ReadonlyMap<string, number>,
  overlap: number,
): number {
  const previous = counts.get(key) ?? 0;
  const expected = queryCounts.get(key) ?? 0;
  const next = previous + delta;
  if (next === 0) counts.delete(key);
  else counts.set(key, next);
  return overlap - Math.min(previous, expected) + Math.min(next, expected);
}

function bigrams(values: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index + 1 < values.length; index += 1) {
    result.push(bigramKey(values[index] ?? '', values[index + 1] ?? ''));
  }
  return result;
}

function bigramKey(left: string, right: string): string {
  return `${left.codePointAt(0)?.toString(16) ?? ''}:${right.codePointAt(0)?.toString(16) ?? ''}`;
}
function buildAssociationMatches(
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  request: Readonly<{
    entryId: string;
    maximumDepth: 1 | 2;
    minimumScore: number;
  }>,
): ReadonlyMap<string, Readonly<InformationEntryAssociationMatch>> {
  if (!entries.some((entry) => entry.entryId === request.entryId)) {
    return new Map();
  }
  const visited = new Map<string, AssociationVisit>();
  const associationIndex = prepareInformationEntryAssociationReadIndex(
    entries,
    snapshot,
  );
  const queue: string[] = [request.entryId];
  visited.set(request.entryId, {
    depth: 0,
    effectiveScore: 10_000,
    path: Object.freeze([]),
  });
  for (const currentId of queue) {
    const current = visited.get(currentId);
    if (current === undefined || current.depth >= request.maximumDepth)
      continue;
    const associations = associationIndex
      .list(currentId)
      .filter(
        (association) =>
          !association.isBlocked &&
          association.effectiveScore >= request.minimumScore,
      );
    for (const association of associations) {
      const relatedId = association.relatedEntry.entryId;
      const depth = current.depth + 1;
      const effectiveScore = Math.min(
        current.effectiveScore,
        association.effectiveScore,
      );
      const step = Object.freeze({
        fromEntryId: currentId,
        toEntryId: relatedId,
        effectiveScore: association.effectiveScore,
        candidateBasis: Object.freeze([
          ...(association.projection?.candidateBasis ?? []),
        ]),
        ...(association.override === undefined
          ? {}
          : {manualAction: association.override.value.action}),
      });
      const candidate: AssociationVisit = Object.freeze({
        depth,
        effectiveScore,
        path: Object.freeze([...current.path, step]),
      });
      const previous = visited.get(relatedId);
      if (
        previous !== undefined &&
        (previous.depth < depth ||
          (previous.depth === depth &&
            previous.effectiveScore >= effectiveScore))
      ) {
        continue;
      }
      visited.set(relatedId, candidate);
      queue.push(relatedId);
    }
  }
  visited.delete(request.entryId);
  return new Map(
    [...visited.entries()].map(([entryId, visit]) => [
      entryId,
      Object.freeze({
        anchorEntryId: request.entryId,
        depth: visit.depth,
        effectiveScore: visit.effectiveScore,
        path: visit.path,
      }),
    ]),
  );
}

function compareSearchItems(
  left: Readonly<InformationEntrySearchItem>,
  right: Readonly<InformationEntrySearchItem>,
): number {
  const leftDepth = left.association?.depth ?? 0;
  const rightDepth = right.association?.depth ?? 0;
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  const leftTextScore = left.retrievalScore ?? left.textMatch?.score ?? 0;
  const rightTextScore = right.retrievalScore ?? right.textMatch?.score ?? 0;
  if (leftTextScore !== rightTextScore) return rightTextScore - leftTextScore;
  if (left.matchReasons.length !== right.matchReasons.length) {
    return right.matchReasons.length - left.matchReasons.length;
  }
  const leftScore = left.association?.effectiveScore ?? 0;
  const rightScore = right.association?.effectiveScore ?? 0;
  if (leftScore !== rightScore) return rightScore - leftScore;
  const capturedOrder = right.entry.capturedAt.localeCompare(
    left.entry.capturedAt,
  );
  if (capturedOrder !== 0) return capturedOrder;
  if (left.entry.value.documentOrder !== right.entry.value.documentOrder) {
    return left.entry.value.documentOrder - right.entry.value.documentOrder;
  }
  return left.entry.entryId.localeCompare(right.entry.entryId);
}

function compareSearchItemToCursor(
  item: Readonly<InformationEntrySearchItem>,
  cursor: Readonly<InformationEntrySearchCursor>,
): number {
  const depth = item.association?.depth ?? 0;
  if (depth !== cursor.associationDepth) return depth - cursor.associationDepth;
  const textScore = item.retrievalScore ?? item.textMatch?.score ?? 0;
  if (textScore !== cursor.textScore) return cursor.textScore - textScore;
  if (item.matchReasons.length !== cursor.matchReasonCount) {
    return cursor.matchReasonCount - item.matchReasons.length;
  }
  const score = item.association?.effectiveScore ?? 0;
  if (score !== cursor.associationScore) return cursor.associationScore - score;
  const capturedOrder = cursor.capturedAt.localeCompare(item.entry.capturedAt);
  if (capturedOrder !== 0) return capturedOrder;
  if (item.entry.value.documentOrder !== cursor.documentOrder) {
    return item.entry.value.documentOrder - cursor.documentOrder;
  }
  return item.entry.entryId.localeCompare(cursor.entryId);
}

function searchCursorFor(
  item: Readonly<InformationEntrySearchItem>,
  querySha256: string,
): Readonly<InformationEntrySearchCursor> {
  return Object.freeze({
    schemaVersion: 2 as const,
    querySha256,
    associationDepth: item.association?.depth ?? 0,
    textScore: item.retrievalScore ?? item.textMatch?.score ?? 0,
    matchReasonCount: item.matchReasons.length,
    associationScore: item.association?.effectiveScore ?? 0,
    capturedAt: item.entry.capturedAt,
    documentOrder: item.entry.value.documentOrder,
    entryId: item.entry.entryId,
  });
}

function effectiveRetrievalScore(
  mode: 'lexical' | 'semantic' | 'hybrid',
  lexicalScore: number | undefined,
  semanticScore: number | undefined,
): number {
  if (mode === 'lexical') return lexicalScore ?? 0;
  if (mode === 'semantic') return semanticScore ?? 0;
  if (lexicalScore === undefined) return semanticScore ?? 0;
  if (semanticScore === undefined) return lexicalScore;
  return Math.round(lexicalScore * 0.45 + semanticScore * 0.55);
}

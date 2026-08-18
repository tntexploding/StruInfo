import {
  deepFreeze,
  defineOwnedRecord,
} from './closed_manual_knowledge_input.js';
import {KnowledgeSearchRepositorySnapshotFault} from './closed_deterministic_knowledge_search_input.js';
import {
  type DeterministicKnowledgeSearchContext,
  type DeterministicKnowledgeSearchItem,
  type DeterministicKnowledgeSearchRequest,
  type DeterministicKnowledgeSearchResult,
  type DeterministicKnowledgeSearchSnapshot,
  KNOWLEDGE_SEARCH_LIMITS,
  type KnowledgeSearchCursor,
  type KnowledgeSearchFragmentInputState,
  type KnowledgeSearchIssue,
  type KnowledgeSearchItemState,
  type KnowledgeSearchMatchRank,
  type KnowledgeSearchRelationMatch,
  type KnowledgeSearchRelationRevisionState,
  type KnowledgeSearchRelationState,
  type KnowledgeSearchRevisionState,
  type KnowledgeSearchSourceMatch,
  type KnowledgeSearchTextMatch,
} from './deterministic_knowledge_search_contract.js';
import {
  compareUnsignedUtf8,
  searchKeyV1,
} from './deterministic_knowledge_search_identity.js';
import {
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
} from './manual_knowledge_identity.js';

interface SearchCandidate {
  readonly item: KnowledgeSearchItemState;
  readonly revision: KnowledgeSearchRevisionState;
  readonly normalizedTitle: string;
  readonly matchRank: KnowledgeSearchMatchRank;
  readonly textMatches: readonly KnowledgeSearchTextMatch[];
  readonly sourceMatches: readonly KnowledgeSearchSourceMatch[];
  readonly relationMatches: readonly KnowledgeSearchRelationMatch[];
}

interface SnapshotIndexes {
  readonly revisionsByItem: ReadonlyMap<string, KnowledgeSearchRevisionState>;
  readonly fragmentInputsByItem: ReadonlyMap<
    string,
    readonly KnowledgeSearchFragmentInputState[]
  >;
  readonly relationRevisionsByRelation: ReadonlyMap<
    string,
    KnowledgeSearchRelationRevisionState
  >;
}

export function evaluateDeterministicKnowledgeSearch(
  context: DeterministicKnowledgeSearchContext,
  request: DeterministicKnowledgeSearchRequest,
  snapshot: DeterministicKnowledgeSearchSnapshot,
  querySha256: string,
  includePrivate = false,
): DeterministicKnowledgeSearchResult {
  validateAndIndexSnapshot(context.effectiveWorkspaceId, snapshot);
  const visibleSnapshot = privacyScopedSnapshot(snapshot, includePrivate);
  const indexes = validateAndIndexSnapshot(
    context.effectiveWorkspaceId,
    visibleSnapshot,
  );
  const relationMatchesByItem = buildRelationMatches(
    request,
    visibleSnapshot,
    indexes,
  );
  const candidates: SearchCandidate[] = [];
  const kindFilter = new Set(request.filters.knowledgeKinds);
  const roleFilter = new Set(request.filters.epistemicRoles);
  const stateFilter = new Set(request.filters.reviewStates);

  for (const item of visibleSnapshot.items) {
    const revision = indexes.revisionsByItem.get(item.itemId);
    if (revision === undefined) {
      throw repositorySnapshotFault();
    }
    if (
      (kindFilter.size > 0 && !kindFilter.has(revision.value.knowledgeKind)) ||
      (roleFilter.size > 0 && !roleFilter.has(revision.value.epistemicRole)) ||
      (stateFilter.size > 0 && !stateFilter.has(revision.value.reviewState))
    ) {
      continue;
    }
    const text = matchText(request, revision);
    if (text === undefined) {
      continue;
    }
    const sourceMatches = matchSources(
      request,
      indexes.fragmentInputsByItem.get(item.itemId) ?? [],
    );
    if (sourceMatches === undefined) {
      continue;
    }
    const relationMatches =
      request.filters.relation.kind === 'any'
        ? []
        : relationMatchesByItem.get(item.itemId);
    if (relationMatches === undefined) {
      continue;
    }
    candidates.push({
      item,
      revision,
      normalizedTitle: searchKeyV1(revision.value.title),
      matchRank: text.matchRank,
      textMatches: text.textMatches,
      sourceMatches,
      relationMatches,
    });
  }

  candidates.sort(compareCandidates);
  const totalCount = candidates.length;
  const start = findPageStart(candidates, request.page.after);
  const page = candidates.slice(start, start + request.page.limit);
  const items = page.map((candidate) => materializeItem(candidate));
  const hasFurtherMatch = start + page.length < candidates.length;
  const last = page.at(-1);
  const nextCursor =
    hasFurtherMatch && last !== undefined
      ? materializeCursor(last, querySha256)
      : undefined;
  return deepFreeze(
    defineOwnedRecord({
      status: 'ok',
      querySha256,
      totalCount,
      items,
      ...(nextCursor === undefined ? {} : {nextCursor}),
    }),
  );
}

function privacyScopedSnapshot(
  snapshot: Readonly<DeterministicKnowledgeSearchSnapshot>,
  includePrivate: boolean,
): DeterministicKnowledgeSearchSnapshot {
  const privateItemIds = new Set(
    snapshot.revisions
      .filter((revision) => revision.isPrivate === true)
      .map((revision) => revision.itemId),
  );
  const relationRevisionById = new Map(
    snapshot.relationRevisions.map((revision) => [
      revision.relationId,
      revision,
    ]),
  );
  const relationPrivacy = new Map(
    snapshot.relations.map((relation) => {
      const revision = relationRevisionById.get(relation.relationId);
      return [
        relation.relationId,
        revision?.isPrivate === true ||
          privateItemIds.has(relation.subjectItemId) ||
          privateItemIds.has(relation.objectItemId),
      ] as const;
    }),
  );

  if (includePrivate) {
    return {
      ...snapshot,
      relationRevisions: snapshot.relationRevisions.map((revision) =>
        relationPrivacy.get(revision.relationId) === true
          ? {...revision, isPrivate: true as const}
          : revision,
      ),
    };
  }

  const visibleItemIds = new Set(
    snapshot.items
      .filter((item) => !privateItemIds.has(item.itemId))
      .map((item) => item.itemId),
  );
  const visibleRelationIds = new Set(
    snapshot.relations
      .filter(
        (relation) =>
          relationPrivacy.get(relation.relationId) !== true &&
          visibleItemIds.has(relation.subjectItemId) &&
          visibleItemIds.has(relation.objectItemId),
      )
      .map((relation) => relation.relationId),
  );
  return {
    items: snapshot.items.filter((item) => visibleItemIds.has(item.itemId)),
    revisions: snapshot.revisions.filter((revision) =>
      visibleItemIds.has(revision.itemId),
    ),
    fragmentInputs: snapshot.fragmentInputs.filter((input) =>
      visibleItemIds.has(input.itemId),
    ),
    relations: snapshot.relations.filter((relation) =>
      visibleRelationIds.has(relation.relationId),
    ),
    relationRevisions: snapshot.relationRevisions.filter((revision) =>
      visibleRelationIds.has(revision.relationId),
    ),
  };
}

export function rejectedKnowledgeSearchResult(
  issue: KnowledgeSearchIssue,
): DeterministicKnowledgeSearchResult {
  return deepFreeze(
    defineOwnedRecord({
      status: 'rejected',
      issue:
        issue.code === 'limit_exceeded'
          ? defineOwnedRecord({
              code: issue.code,
              path: issue.path,
              budget: issue.budget,
            })
          : defineOwnedRecord({code: issue.code, path: issue.path}),
    }),
  );
}

export function failedKnowledgeSearchResult(
  code: 'repository_failed' | 'invalid_repository_snapshot',
): DeterministicKnowledgeSearchResult {
  return deepFreeze(
    defineOwnedRecord({
      status: 'failed',
      issue: defineOwnedRecord({code, path: 'repository'}),
    }),
  );
}

function validateAndIndexSnapshot(
  workspaceId: string,
  snapshot: DeterministicKnowledgeSearchSnapshot,
): SnapshotIndexes {
  assertWorkspace(workspaceId, snapshot);
  assertStrictSort(snapshot.items, (row) => [row.itemId]);
  assertStrictSort(snapshot.revisions, (row) => [row.itemId]);
  assertStrictSort(snapshot.fragmentInputs, (row) => [
    row.itemId,
    sourceInputKindOrder(row.inputKind),
    row.inputOrdinal,
  ]);
  assertStrictSort(snapshot.relations, (row) => [row.relationId]);
  assertStrictSort(snapshot.relationRevisions, (row) => [row.relationId]);
  if (
    snapshot.items.length !== snapshot.revisions.length ||
    snapshot.relations.length !== snapshot.relationRevisions.length
  ) {
    throw repositorySnapshotFault();
  }

  const itemsById = new Map(snapshot.items.map((row) => [row.itemId, row]));
  const revisionsByItem = new Map(
    snapshot.revisions.map((row) => [row.itemId, row]),
  );
  assertUnique(snapshot.revisions.map((row) => row.revisionId));
  for (const item of snapshot.items) {
    const revision = revisionsByItem.get(item.itemId);
    if (
      revision?.revision !== item.currentRevision ||
      revision.revisionId !== item.currentRevisionId ||
      revision.revisionId !==
        deriveKnowledgeItemRevisionId(item.itemId, item.currentRevision)
    ) {
      throw repositorySnapshotFault();
    }
    if (
      revision.revision === 1 &&
      (revision.value.reviewState === 'rejected' ||
        revision.value.reviewState === 'withdrawn')
    ) {
      throw repositorySnapshotFault();
    }
  }

  const fragmentInputsByItem = new Map<
    string,
    KnowledgeSearchFragmentInputState[]
  >();
  const fragmentIdentities = new Set<string>();
  const nextOrdinals = new Map<string, number>();
  const inputCounts = new Map<string, number>();
  for (const input of snapshot.fragmentInputs) {
    const revision = revisionsByItem.get(input.itemId);
    if (
      input.revision !== revision?.revision ||
      input.revisionId !== revision.revisionId
    ) {
      throw repositorySnapshotFault();
    }
    const identity = `${input.itemId}:${String(input.revision)}:${input.fragmentId}`;
    if (fragmentIdentities.has(identity)) {
      throw repositorySnapshotFault();
    }
    fragmentIdentities.add(identity);
    const ordinalKey = `${input.itemId}:${input.inputKind}`;
    const nextOrdinal = nextOrdinals.get(ordinalKey) ?? 0;
    if (input.inputOrdinal !== nextOrdinal) {
      throw repositorySnapshotFault();
    }
    nextOrdinals.set(ordinalKey, nextOrdinal + 1);
    const count = (inputCounts.get(input.itemId) ?? 0) + 1;
    if (count > 64) {
      throw repositorySnapshotFault();
    }
    inputCounts.set(input.itemId, count);
    const rows = fragmentInputsByItem.get(input.itemId) ?? [];
    rows.push(input);
    fragmentInputsByItem.set(input.itemId, rows);
  }
  for (const revision of snapshot.revisions) {
    const inputs = fragmentInputsByItem.get(revision.itemId) ?? [];
    if (
      revision.value.epistemicRole === 'source_excerpt' &&
      (!Object.hasOwn(revision.value, 'body') ||
        inputs.length !== 1 ||
        inputs[0]?.inputKind !== 'citation')
    ) {
      throw repositorySnapshotFault();
    }
    if (
      revision.value.epistemicRole === 'source_claim' &&
      inputs.length === 0
    ) {
      throw repositorySnapshotFault();
    }
  }

  const relationsById = new Map(
    snapshot.relations.map((row) => [row.relationId, row]),
  );
  const relationRevisionsByRelation = new Map(
    snapshot.relationRevisions.map((row) => [row.relationId, row]),
  );
  assertUnique(snapshot.relationRevisions.map((row) => row.revisionId));
  for (const relation of snapshot.relations) {
    const revision = relationRevisionsByRelation.get(relation.relationId);
    if (
      revision?.revision !== relation.currentRevision ||
      revision.revisionId !== relation.currentRevisionId ||
      revision.revisionId !==
        deriveKnowledgeRelationRevisionId(
          relation.relationId,
          relation.currentRevision,
        ) ||
      revision.value.subjectItemId !== relation.subjectItemId ||
      revision.value.relationTypeKey !== relation.relationTypeKey ||
      revision.value.objectItemId !== relation.objectItemId ||
      relation.subjectItemId === relation.objectItemId ||
      !itemsById.has(relation.subjectItemId) ||
      !itemsById.has(relation.objectItemId)
    ) {
      throw repositorySnapshotFault();
    }
    if (
      revision.revision === 1 &&
      (revision.value.reviewState === 'rejected' ||
        revision.value.reviewState === 'withdrawn')
    ) {
      throw repositorySnapshotFault();
    }
  }
  if (
    relationsById.size !== snapshot.relations.length ||
    revisionsByItem.size !== snapshot.revisions.length
  ) {
    throw repositorySnapshotFault();
  }
  return {
    revisionsByItem,
    fragmentInputsByItem,
    relationRevisionsByRelation,
  };
}

function assertWorkspace(
  workspaceId: string,
  snapshot: DeterministicKnowledgeSearchSnapshot,
): void {
  const arrays: readonly (readonly {readonly workspaceId: string}[])[] = [
    snapshot.items,
    snapshot.revisions,
    snapshot.fragmentInputs,
    snapshot.relations,
    snapshot.relationRevisions,
  ];
  if (
    arrays.some((rows) => rows.some((row) => row.workspaceId !== workspaceId))
  ) {
    throw repositorySnapshotFault();
  }
}

function buildRelationMatches(
  request: DeterministicKnowledgeSearchRequest,
  snapshot: DeterministicKnowledgeSearchSnapshot,
  indexes: SnapshotIndexes,
): ReadonlyMap<string, readonly KnowledgeSearchRelationMatch[]> {
  const filter = request.filters.relation;
  if (filter.kind === 'any') {
    return new Map();
  }
  const itemIds = new Set(snapshot.items.map((item) => item.itemId));
  if (!itemIds.has(filter.anchorItemId)) {
    return new Map();
  }
  const typeFilter = new Set(filter.relationTypeKeys);
  const stateFilter = new Set(filter.reviewStates);
  const byItem = new Map<string, KnowledgeSearchRelationMatch[]>();
  for (const relation of snapshot.relations) {
    const revision = indexes.relationRevisionsByRelation.get(
      relation.relationId,
    );
    if (revision === undefined) {
      throw repositorySnapshotFault();
    }
    if (
      (typeFilter.size > 0 && !typeFilter.has(relation.relationTypeKey)) ||
      (stateFilter.size > 0 && !stateFilter.has(revision.value.reviewState))
    ) {
      continue;
    }
    if (
      (filter.direction === 'outgoing' || filter.direction === 'either') &&
      relation.subjectItemId === filter.anchorItemId
    ) {
      addRelationMatch(
        byItem,
        relation.objectItemId,
        relation,
        revision,
        'outgoing',
      );
    }
    if (
      (filter.direction === 'incoming' || filter.direction === 'either') &&
      relation.objectItemId === filter.anchorItemId
    ) {
      addRelationMatch(
        byItem,
        relation.subjectItemId,
        relation,
        revision,
        'incoming',
      );
    }
  }
  for (const rows of byItem.values()) {
    rows.sort(compareRelationMatches);
  }
  return byItem;
}

function addRelationMatch(
  byItem: Map<string, KnowledgeSearchRelationMatch[]>,
  itemId: string,
  relation: KnowledgeSearchRelationState,
  revision: KnowledgeSearchRelationRevisionState,
  direction: 'outgoing' | 'incoming',
): void {
  const matches = byItem.get(itemId) ?? [];
  matches.push(
    defineOwnedRecord({
      relationId: relation.relationId,
      revision: revision.revision,
      revisionId: revision.revisionId,
      direction,
      relationTypeKey: relation.relationTypeKey,
      epistemicRole: revision.value.epistemicRole,
      reviewState: revision.value.reviewState,
      ...(revision.isPrivate === true ? {isPrivate: true as const} : {}),
      ...(!Object.hasOwn(revision.value, 'qualifier')
        ? {}
        : {qualifier: revision.value.qualifier}),
    }),
  );
  byItem.set(itemId, matches);
}

function matchText(
  request: DeterministicKnowledgeSearchRequest,
  revision: KnowledgeSearchRevisionState,
):
  | Readonly<{
      matchRank: KnowledgeSearchMatchRank;
      textMatches: readonly KnowledgeSearchTextMatch[];
    }>
  | undefined {
  const clause = request.text;
  if (clause === undefined) {
    return {matchRank: 4, textMatches: []};
  }
  const query = searchKeyV1(clause.value);
  const matches: KnowledgeSearchTextMatch[] = [];
  for (const field of clause.fields) {
    const raw = field === 'title' ? revision.value.title : revision.value.body;
    if (raw === undefined) {
      continue;
    }
    const candidate = searchKeyV1(raw);
    if (candidate === query) {
      matches.push({
        field,
        kind: 'exact',
        rank: field === 'title' ? 0 : 2,
      });
    } else if (clause.mode === 'substring' && candidate.includes(query)) {
      matches.push({
        field,
        kind: 'substring',
        rank: field === 'title' ? 1 : 3,
      });
    }
  }
  if (matches.length === 0) {
    return undefined;
  }
  const matchRank = Math.min(...matches.map((match) => match.rank));
  return {
    matchRank: matchRank as Exclude<KnowledgeSearchMatchRank, 4>,
    textMatches: matches,
  };
}

function matchSources(
  request: DeterministicKnowledgeSearchRequest,
  inputs: readonly KnowledgeSearchFragmentInputState[],
): readonly KnowledgeSearchSourceMatch[] | undefined {
  const filter = request.filters.source;
  if (filter.kind === 'any') {
    return [];
  }
  const admittedKinds = new Set(filter.inputKinds);
  const matches = inputs
    .filter((input) => {
      if (admittedKinds.size > 0 && !admittedKinds.has(input.inputKind)) {
        return false;
      }
      return filter.kind === 'resource'
        ? input.resourceId === filter.resourceId
        : filter.kind === 'snapshot'
          ? input.snapshotId === filter.snapshotId
          : input.fragmentId === filter.fragmentId;
    })
    .map((input) =>
      defineOwnedRecord({
        inputKind: input.inputKind,
        inputOrdinal: input.inputOrdinal,
        resourceId: input.resourceId,
        snapshotId: input.snapshotId,
        fragmentId: input.fragmentId,
      }),
    );
  if (matches.length === 0) {
    return undefined;
  }
  matches.sort(compareSourceMatches);
  return matches;
}

function materializeItem(
  candidate: SearchCandidate,
): DeterministicKnowledgeSearchItem {
  const visibleRelationMatches = candidate.relationMatches.slice(
    0,
    KNOWLEDGE_SEARCH_LIMITS.relationMatches,
  );
  return defineOwnedRecord({
    itemId: candidate.item.itemId,
    revision: candidate.revision.revision,
    revisionId: candidate.revision.revisionId,
    value: copyItemValue(candidate.revision.value),
    matchRank: candidate.matchRank,
    textMatches: candidate.textMatches.map((match) =>
      defineOwnedRecord({
        field: match.field,
        kind: match.kind,
        rank: match.rank,
      }),
    ),
    sourceMatches: candidate.sourceMatches.map((match) =>
      defineOwnedRecord({
        inputKind: match.inputKind,
        inputOrdinal: match.inputOrdinal,
        resourceId: match.resourceId,
        snapshotId: match.snapshotId,
        fragmentId: match.fragmentId,
      }),
    ),
    relationMatchCount: candidate.relationMatches.length,
    relationMatches: visibleRelationMatches.map((match) =>
      copyRelationMatch(match),
    ),
    relationMatchesTruncated:
      candidate.relationMatches.length >
      KNOWLEDGE_SEARCH_LIMITS.relationMatches,
    ...(candidate.revision.isPrivate === true
      ? {isPrivate: true as const}
      : {}),
  });
}

function copyItemValue(
  value: KnowledgeSearchRevisionState['value'],
): KnowledgeSearchRevisionState['value'] {
  return defineOwnedRecord({
    knowledgeKind: value.knowledgeKind,
    epistemicRole: value.epistemicRole,
    reviewState: value.reviewState,
    title: value.title,
    ...(!Object.hasOwn(value, 'body') ? {} : {body: value.body}),
  });
}

function copyRelationMatch(
  match: KnowledgeSearchRelationMatch,
): KnowledgeSearchRelationMatch {
  return defineOwnedRecord({
    relationId: match.relationId,
    revision: match.revision,
    revisionId: match.revisionId,
    direction: match.direction,
    relationTypeKey: match.relationTypeKey,
    epistemicRole: match.epistemicRole,
    reviewState: match.reviewState,
    ...(match.isPrivate === true ? {isPrivate: true as const} : {}),
    ...(!Object.hasOwn(match, 'qualifier') ? {} : {qualifier: match.qualifier}),
  });
}

function materializeCursor(
  candidate: SearchCandidate,
  querySha256: string,
): KnowledgeSearchCursor {
  return defineOwnedRecord({
    schemaVersion: 1,
    querySha256,
    matchRank: candidate.matchRank,
    normalizedTitle: candidate.normalizedTitle,
    itemId: candidate.item.itemId,
  });
}

function findPageStart(
  candidates: readonly SearchCandidate[],
  after: KnowledgeSearchCursor | undefined,
): number {
  if (after === undefined) {
    return 0;
  }
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = candidates[middle];
    if (candidate === undefined) {
      throw repositorySnapshotFault();
    }
    if (compareCandidateToCursor(candidate, after) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function compareCandidates(
  left: SearchCandidate,
  right: SearchCandidate,
): number {
  const rank = left.matchRank - right.matchRank;
  if (rank !== 0) {
    return rank;
  }
  const title = compareUnsignedUtf8(
    left.normalizedTitle,
    right.normalizedTitle,
  );
  return title !== 0
    ? title
    : compareUnsignedUtf8(left.item.itemId, right.item.itemId);
}

function compareCandidateToCursor(
  candidate: SearchCandidate,
  cursor: KnowledgeSearchCursor,
): number {
  const rank = candidate.matchRank - cursor.matchRank;
  if (rank !== 0) {
    return rank;
  }
  const title = compareUnsignedUtf8(
    candidate.normalizedTitle,
    cursor.normalizedTitle,
  );
  return title !== 0
    ? title
    : compareUnsignedUtf8(candidate.item.itemId, cursor.itemId);
}

function compareSourceMatches(
  left: KnowledgeSearchSourceMatch,
  right: KnowledgeSearchSourceMatch,
): number {
  const kind =
    sourceInputKindOrder(left.inputKind) -
    sourceInputKindOrder(right.inputKind);
  if (kind !== 0) {
    return kind;
  }
  const ordinal = left.inputOrdinal - right.inputOrdinal;
  return ordinal !== 0
    ? ordinal
    : compareUnsignedUtf8(left.fragmentId, right.fragmentId);
}

function compareRelationMatches(
  left: KnowledgeSearchRelationMatch,
  right: KnowledgeSearchRelationMatch,
): number {
  const relationType = compareUnsignedUtf8(
    left.relationTypeKey,
    right.relationTypeKey,
  );
  if (relationType !== 0) {
    return relationType;
  }
  const relationId = compareUnsignedUtf8(left.relationId, right.relationId);
  return relationId !== 0 ? relationId : left.revision - right.revision;
}

function sourceInputKindOrder(kind: 'citation' | 'derivation'): number {
  return kind === 'citation' ? 0 : 1;
}

function assertStrictSort<Row>(
  rows: readonly Row[],
  tuple: (row: Row) => readonly (number | string)[],
): void {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareTuple(tuple(previous), tuple(current)) >= 0
    ) {
      throw repositorySnapshotFault();
    }
  }
}

function compareTuple(
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (
      leftValue === undefined ||
      rightValue === undefined ||
      typeof leftValue !== typeof rightValue
    ) {
      throw repositorySnapshotFault();
    }
    return typeof leftValue === 'number'
      ? leftValue < (rightValue as number)
        ? -1
        : 1
      : compareUnsignedUtf8(leftValue, rightValue as string);
  }
  return left.length - right.length;
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw repositorySnapshotFault();
  }
}

function repositorySnapshotFault(): KnowledgeSearchRepositorySnapshotFault {
  return new KnowledgeSearchRepositorySnapshotFault();
}

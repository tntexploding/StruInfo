import {createHash} from 'node:crypto';

import type {
  CurrentInformationEntry,
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
import {listInformationEntryAssociations} from './information_entry_association.js';
import {informationEntrySearchKey} from './information_entry.js';

export class InformationEntrySearchCursorError extends Error {
  public constructor() {
    super('Information Entry search cursor does not match the query.');
    this.name = 'InformationEntrySearchCursorError';
  }
}

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
): Readonly<InformationEntrySearchResult> {
  const querySha256 = informationEntryQuerySha256(request);
  if (
    request.after !== undefined &&
    request.after.querySha256 !== querySha256
  ) {
    throw new InformationEntrySearchCursorError();
  }

  const visibleEntries = entries.filter(
    (entry) => request.includePrivate || !entry.value.isPrivate,
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
  const matches = visibleEntries.flatMap((entry) => {
    const filterReasons = structuralFilterReasons(entry, request);
    if (filterReasons === undefined) return [];
    const association = associationMatches?.get(entry.entryId);
    if (associationMatches !== undefined && association === undefined)
      return [];
    const matchReasons = textMatchReasons(entry, query);
    if (query !== '' && matchReasons.length === 0) return [];
    return [
      Object.freeze({
        entry,
        matchReasons: Object.freeze(matchReasons),
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
    schemaVersion: 'struinfo.information-entry-search.v1',
    text: informationEntrySearchKey(request.text ?? ''),
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

function textMatchReasons(
  entry: Readonly<CurrentInformationEntry>,
  query: string,
): InformationEntryMatchReason[] {
  if (query === '') return [];
  const reasons: InformationEntryMatchReason[] = [];
  if (informationEntrySearchKey(entry.value.titlePath).includes(query)) {
    reasons.push('title');
  }
  if (informationEntrySearchKey(entry.value.body).includes(query)) {
    reasons.push('body');
  }
  if (
    entry.value.contentKeywords.some((keyword) =>
      keyword.normalizedValue.includes(query),
    )
  ) {
    reasons.push('content_keyword');
  }
  if (
    entry.value.typeKeyword !== undefined &&
    informationEntrySearchKey(
      entry.value.typeCustomName ?? entry.value.typeKeyword,
    ).includes(query)
  ) {
    reasons.push('type_keyword');
  }
  if (
    entry.value.domains.some((domain) =>
      informationEntrySearchKey(domain.customName ?? domain.keyword).includes(
        query,
      ),
    )
  ) {
    reasons.push('domain_keyword');
  }
  return reasons;
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
    const associations = listInformationEntryAssociations(
      currentId,
      entries,
      snapshot,
    ).filter(
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
    schemaVersion: 1 as const,
    querySha256,
    associationDepth: item.association?.depth ?? 0,
    matchReasonCount: item.matchReasons.length,
    associationScore: item.association?.effectiveScore ?? 0,
    capturedAt: item.entry.capturedAt,
    documentOrder: item.entry.value.documentOrder,
    entryId: item.entry.entryId,
  });
}

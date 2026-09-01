import {
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryTypeKeyword,
  type InformationEntryTypeCoverage,
  type InformationEntryTypeReviewCursor,
  type InformationEntryTypeReviewRequest,
  type InformationEntryTypeReviewResult,
} from './information_entry_contract.js';
import type {InformationEntryRepositoryPort} from './information_entry_repository.js';

export async function reviewCurrentInformationEntryTypes(
  repository: InformationEntryRepositoryPort,
  request: Readonly<InformationEntryTypeReviewRequest>,
): Promise<Readonly<InformationEntryTypeReviewResult>> {
  if (repository.reviewCurrentEntryTypes !== undefined) {
    return repository.reviewCurrentEntryTypes(request);
  }
  const entries = await repository.loadCurrentEntries(
    request.workspaceId,
    request.includePrivate,
  );
  return reviewInformationEntryTypes(entries, request);
}

export function reviewInformationEntryTypes(
  entries: readonly Readonly<CurrentInformationEntry>[],
  request: Readonly<InformationEntryTypeReviewRequest>,
): Readonly<InformationEntryTypeReviewResult> {
  const ordered = [...entries].sort(compareEntries);
  const coverage = summarizeInformationEntryTypeCoverage(ordered);
  const filtered = ordered.filter((entry) =>
    request.filter === 'missing'
      ? entry.value.typeKeyword === undefined
      : entry.value.typeKeyword === request.filter,
  );
  const after = request.after;
  const pageCandidates =
    after === undefined
      ? filtered
      : filtered.filter((entry) => isAfterCursor(entry, after));
  const items = Object.freeze(pageCandidates.slice(0, request.limit));
  const last = items.at(-1);
  return Object.freeze({
    coverage,
    items,
    ...(pageCandidates.length > request.limit && last !== undefined
      ? {nextCursor: cursorForEntry(last)}
      : {}),
  });
}

export function summarizeInformationEntryTypeCoverage(
  entries: readonly Readonly<CurrentInformationEntry>[],
): Readonly<InformationEntryTypeCoverage> {
  const counts = new Map<EntryTypeKeyword, number>(
    ENTRY_TYPE_KEYWORDS.map((typeKeyword) => [typeKeyword, 0]),
  );
  let classifiedCount = 0;
  for (const entry of entries) {
    const typeKeyword = entry.value.typeKeyword;
    if (typeKeyword === undefined) continue;
    classifiedCount += 1;
    counts.set(typeKeyword, (counts.get(typeKeyword) ?? 0) + 1);
  }
  return Object.freeze({
    totalCount: entries.length,
    classifiedCount,
    missingCount: entries.length - classifiedCount,
    byType: Object.freeze(
      ENTRY_TYPE_KEYWORDS.map((typeKeyword) =>
        Object.freeze({
          typeKeyword,
          count: counts.get(typeKeyword) ?? 0,
        }),
      ),
    ),
  });
}

function compareEntries(
  left: Readonly<CurrentInformationEntry>,
  right: Readonly<CurrentInformationEntry>,
): number {
  return (
    right.capturedAt.localeCompare(left.capturedAt) ||
    left.snapshotId.localeCompare(right.snapshotId) ||
    left.value.documentOrder - right.value.documentOrder ||
    left.entryId.localeCompare(right.entryId)
  );
}

function isAfterCursor(
  entry: Readonly<CurrentInformationEntry>,
  cursor: Readonly<InformationEntryTypeReviewCursor>,
): boolean {
  if (entry.capturedAt !== cursor.capturedAt) {
    return entry.capturedAt < cursor.capturedAt;
  }
  if (entry.snapshotId !== cursor.snapshotId) {
    return entry.snapshotId > cursor.snapshotId;
  }
  if (entry.value.documentOrder !== cursor.documentOrder) {
    return entry.value.documentOrder > cursor.documentOrder;
  }
  return entry.entryId > cursor.entryId;
}

function cursorForEntry(
  entry: Readonly<CurrentInformationEntry>,
): Readonly<InformationEntryTypeReviewCursor> {
  return Object.freeze({
    capturedAt: entry.capturedAt,
    snapshotId: entry.snapshotId,
    documentOrder: entry.value.documentOrder,
    entryId: entry.entryId,
  });
}

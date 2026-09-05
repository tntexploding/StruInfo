import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {
  InformationEntryAssociationRepositorySnapshot,
  InformationEntryGraphEdge,
} from './information_entry_association_contract.js';
import {prepareInformationEntryAssociationReadIndex} from './information_entry_association.js';
import {toInformationEntryGraphEdge} from './information_entry_knowledge_graph.js';
import {
  sourceReviewMatches,
  type InformationEntrySourceReview,
  type InformationEntrySourceReviewRequest,
  type InformationEntrySourceReviewCursor,
} from './information_entry_source_review.js';

export interface InformationEntrySourceReviewItem {
  readonly entryLow: Readonly<CurrentInformationEntry>;
  readonly entryHigh: Readonly<CurrentInformationEntry>;
  readonly edge: Readonly<InformationEntryGraphEdge>;
  readonly review: Readonly<InformationEntrySourceReview>;
}
export interface InformationEntrySourceReviewPage {
  readonly totalCount: number;
  readonly items: readonly Readonly<InformationEntrySourceReviewItem>[];
  readonly nextCursor?: Readonly<InformationEntrySourceReviewCursor>;
}
export function listInformationEntrySourceReviewItems(
  workspaceId: string,
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  request: Readonly<InformationEntrySourceReviewRequest>,
): readonly Readonly<InformationEntrySourceReviewItem>[] {
  const visible = entries.filter(
    (entry) =>
      entry.workspaceId === workspaceId &&
      (request.privacyScope !== 'public' || !entry.value.isPrivate) &&
      (request.privacyScope !== 'private_only' || entry.value.isPrivate),
  );
  const index = prepareInformationEntryAssociationReadIndex(visible, snapshot);
  const items: InformationEntrySourceReviewItem[] = [];
  for (const entryLow of visible) {
    for (const view of index.list(entryLow.entryId)) {
      if (
        entryLow.entryId >= view.relatedEntry.entryId ||
        view.isBlocked ||
        (view.projection === undefined &&
          view.override?.value.graph === undefined)
      )
        continue;
      const edge = toInformationEntryGraphEdge(
        view,
        entryLow,
        view.relatedEntry,
      );
      const review = edge.sourceReview;
      if (
        review === undefined ||
        !sourceReviewMatches(request.filter, review.status)
      )
        continue;
      items.push(
        Object.freeze({entryLow, entryHigh: view.relatedEntry, edge, review}),
      );
    }
  }
  return Object.freeze(
    items.sort(
      (a, b) =>
        a.edge.entryLowId.localeCompare(b.edge.entryLowId) ||
        a.edge.entryHighId.localeCompare(b.edge.entryHighId),
    ),
  );
}
export function paginateInformationEntrySourceReviews(
  items: readonly Readonly<InformationEntrySourceReviewItem>[],
  request: Readonly<InformationEntrySourceReviewRequest>,
  totalCount = items.length,
): Readonly<InformationEntrySourceReviewPage> {
  const after = request.after;
  const candidates =
    after === undefined
      ? items
      : items.filter(
          (item) =>
            item.edge.entryLowId > after.entryLowId ||
            (item.edge.entryLowId === after.entryLowId &&
              item.edge.entryHighId > after.entryHighId),
        );
  const page = Object.freeze(candidates.slice(0, request.limit));
  const last = page.at(-1);
  return Object.freeze({
    totalCount,
    items: page,
    ...(last === undefined || candidates.length <= request.limit
      ? {}
      : {
          nextCursor: Object.freeze({
            version: 1 as const,
            filter: request.filter,
            privacyScope: request.privacyScope,
            entryLowId: last.edge.entryLowId,
            entryHighId: last.edge.entryHighId,
          }),
        }),
  });
}

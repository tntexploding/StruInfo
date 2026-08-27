import type {
  EntryDomainKeyword,
  EntryRetrievalMode,
  EntryTextSearchField,
  EntryTextSearchMode,
  EntryTypeKeyword,
  InformationEntrySearchResponse,
} from '../api/m1c_api_contract.js';
import type {EntryAdvancedSearchFilters} from './information_entry_search_controls.js';

export type InformationEntrySearchItem = Extract<
  InformationEntrySearchResponse,
  {status: 'ok'}
>['items'][number];

export interface InformationEntryQueryScopeInput {
  readonly query: string;
  readonly retrievalMode?: EntryRetrievalMode;
  readonly textMode: EntryTextSearchMode;
  readonly textFields: readonly EntryTextSearchField[];
  readonly snapshotId: string;
  readonly typeKeyword: '' | EntryTypeKeyword;
  readonly domainKeyword: '' | EntryDomainKeyword;
  readonly advancedFilters: Readonly<EntryAdvancedSearchFilters>;
  readonly includePrivate: boolean;
  readonly onlyPrivate: boolean;
}

export interface InformationEntryComparisonState {
  readonly scopeKey: string;
  readonly items: readonly Readonly<InformationEntrySearchItem>[];
}

const EMPTY_COMPARISON_ITEMS: readonly Readonly<InformationEntrySearchItem>[] =
  Object.freeze([]);

export const EMPTY_INFORMATION_ENTRY_COMPARISON_STATE: Readonly<InformationEntryComparisonState> =
  Object.freeze({
    scopeKey: '',
    items: EMPTY_COMPARISON_ITEMS,
  });

export function informationEntryQueryScopeKey(
  input: Readonly<InformationEntryQueryScopeInput>,
): string {
  const text = input.query.trim();
  const filters = input.advancedFilters;
  const contentKeyword = filters.contentKeyword.trim();
  const sourceKey = filters.sourceKey.trim();
  const typeCustomName = filters.typeCustomName.trim();
  const domainCustomName = filters.domainCustomName.trim();
  const association = filters.association;

  return JSON.stringify({
    schemaVersion: 1,
    ...(text === ''
      ? {}
      : {
          text,
          textMode: input.textMode,
          textFields: [...new Set(input.textFields)].sort(),
          retrievalMode: input.retrievalMode ?? 'lexical',
        }),
    ...(input.snapshotId === '' ? {} : {snapshotId: input.snapshotId}),
    ...(input.typeKeyword === '' ? {} : {typeKeyword: input.typeKeyword}),
    ...(input.typeKeyword !== 'other' || typeCustomName === ''
      ? {}
      : {typeCustomName}),
    ...(input.domainKeyword === ''
      ? {}
      : {
          domainKeyword: input.domainKeyword,
          domainScope: filters.domainScope,
        }),
    ...(input.domainKeyword !== 'other' || domainCustomName === ''
      ? {}
      : {domainCustomName}),
    ...(contentKeyword === '' ? {} : {contentKeyword}),
    ...(sourceKey === '' ? {} : {sourceKey}),
    ...(filters.chunkMode === '' ? {} : {chunkMode: filters.chunkMode}),
    ...(filters.timeFrom === '' && filters.timeTo === ''
      ? {}
      : {
          time: {
            field: filters.timeField,
            ...(filters.timeFrom === '' ? {} : {from: filters.timeFrom}),
            ...(filters.timeTo === '' ? {} : {to: filters.timeTo}),
          },
        }),
    ...(association === undefined
      ? {}
      : {
          association: {
            entryId: association.entryId,
            maximumDepth: association.maximumDepth,
            minimumScore: association.minimumScore,
          },
        }),
    includePrivate: input.includePrivate,
    onlyPrivate: input.onlyPrivate,
  });
}

export function visibleInformationEntryComparisons(
  state: Readonly<InformationEntryComparisonState>,
  scopeKey: string,
): readonly Readonly<InformationEntrySearchItem>[] {
  return state.scopeKey === scopeKey ? state.items : EMPTY_COMPARISON_ITEMS;
}

export function toggleInformationEntryComparison(
  state: Readonly<InformationEntryComparisonState>,
  scopeKey: string,
  item: Readonly<InformationEntrySearchItem>,
): Readonly<InformationEntryComparisonState> {
  const current = visibleInformationEntryComparisons(state, scopeKey);
  const existing = current.findIndex(
    (candidate) => candidate.entry.entryId === item.entry.entryId,
  );
  if (existing >= 0) {
    return Object.freeze({
      scopeKey,
      items: Object.freeze(current.filter((_, index) => index !== existing)),
    });
  }
  if (current.length >= 2) {
    return state.scopeKey === scopeKey
      ? state
      : Object.freeze({scopeKey, items: EMPTY_COMPARISON_ITEMS});
  }
  return Object.freeze({
    scopeKey,
    items: Object.freeze([...current, item]),
  });
}

export function removeInformationEntryComparison(
  state: Readonly<InformationEntryComparisonState>,
  scopeKey: string,
  entryId: string,
): Readonly<InformationEntryComparisonState> {
  const current = visibleInformationEntryComparisons(state, scopeKey);
  return Object.freeze({
    scopeKey,
    items: Object.freeze(
      current.filter((item) => item.entry.entryId !== entryId),
    ),
  });
}

export function clearInformationEntryComparisons(
  scopeKey: string,
): Readonly<InformationEntryComparisonState> {
  return Object.freeze({scopeKey, items: EMPTY_COMPARISON_ITEMS});
}

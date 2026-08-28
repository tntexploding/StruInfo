import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  EntryDomainKeyword,
  EntryRetrievalMode,
  EntryTypeKeyword,
  EntryTextSearchField,
  EntryTextSearchMode,
  InformationEntry,
  InformationEntrySearchCursor,
  InformationEntrySearchResponse,
} from '../api/m1c_api_contract.js';
import type {EntryAdvancedSearchFilters} from './information_entry_search_controls.js';
import type {
  InformationDocumentViewState,
  InformationEntryViewState,
  InformationEntryServices,
} from './information_entry_components.js';
import {createLatestRequestTracker} from './latest_request.js';

export const EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS: Readonly<EntryAdvancedSearchFilters> =
  Object.freeze({
    contentKeyword: '',
    sourceKey: '',
    typeCustomName: '',
    domainCustomName: '',
    domainScope: 'any',
    chunkMode: '',
    timeField: 'published',
    timeFrom: '',
    timeTo: '',
  });

type PageSelection = 'preserve' | 'first' | 'last';

export interface InformationEntryControllerOptions {
  readonly autoSearchDelayMs?: number;
  readonly loadDocuments?: boolean;
  readonly onListDocuments?: InformationEntryServices['onListDocuments'];
  readonly onSearch: InformationEntryServices['onSearch'];
}

export function useInformationEntryController({
  autoSearchDelayMs = 0,
  loadDocuments = false,
  onListDocuments,
  onSearch,
}: InformationEntryControllerOptions) {
  const [query, setQuery] = useState('');
  const [retrievalMode, setRetrievalMode] =
    useState<EntryRetrievalMode>('lexical');
  const [textMode, setTextMode] = useState<EntryTextSearchMode>('substring');
  const [textFields, setTextFields] = useState<readonly EntryTextSearchField[]>(
    Object.freeze(['title', 'body', 'tags']),
  );
  const [snapshotId, setSnapshotId] = useState('');
  const [typeKeyword, setTypeKeyword] = useState<'' | EntryTypeKeyword>('');
  const [domainKeyword, setDomainKeyword] = useState<'' | EntryDomainKeyword>(
    '',
  );
  const [advancedFilters, setAdvancedFilters] = useState<
    Readonly<EntryAdvancedSearchFilters>
  >(EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [onlyPrivate, setOnlyPrivate] = useState(false);
  const [view, setView] = useState<InformationEntryViewState>({
    status: 'loading',
  });
  const [documentView, setDocumentView] =
    useState<InformationDocumentViewState>({status: 'loading'});
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<
    readonly (Readonly<InformationEntrySearchCursor> | undefined)[]
  >(Object.freeze([undefined]));
  const searchRequests = useRef(createLatestRequestTracker());
  const documentRequests = useRef(createLatestRequestTracker());
  const scheduledSearchTimer = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(undefined);
  const effectiveRetrievalMode: EntryRetrievalMode =
    query.trim() === '' || includePrivate || onlyPrivate
      ? 'lexical'
      : retrievalMode;

  const searchRequest = useMemo(
    () =>
      Object.freeze({
        ...(query.trim() === ''
          ? {}
          : {
              text: query.trim(),
              textMode,
              textFields,
              retrievalMode: effectiveRetrievalMode,
            }),
        ...(advancedFilters.contentKeyword.trim() === ''
          ? {}
          : {contentKeyword: advancedFilters.contentKeyword.trim()}),
        ...(advancedFilters.sourceKey.trim() === ''
          ? {}
          : {sourceKey: advancedFilters.sourceKey.trim()}),
        ...(snapshotId === '' ? {} : {snapshotId}),
        ...(typeKeyword === '' ? {} : {typeKeyword}),
        ...(typeKeyword !== 'other' ||
        advancedFilters.typeCustomName.trim() === ''
          ? {}
          : {typeCustomName: advancedFilters.typeCustomName.trim()}),
        ...(domainKeyword === '' ? {} : {domainKeyword}),
        ...(domainKeyword !== 'other' ||
        advancedFilters.domainCustomName.trim() === ''
          ? {}
          : {domainCustomName: advancedFilters.domainCustomName.trim()}),
        domainScope: domainKeyword === '' ? 'any' : advancedFilters.domainScope,
        ...(advancedFilters.chunkMode === ''
          ? {}
          : {chunkMode: advancedFilters.chunkMode}),
        ...(advancedFilters.timeFrom === '' && advancedFilters.timeTo === ''
          ? {}
          : {
              time: {
                field: advancedFilters.timeField,
                ...(advancedFilters.timeFrom === ''
                  ? {}
                  : {from: advancedFilters.timeFrom}),
                ...(advancedFilters.timeTo === ''
                  ? {}
                  : {to: advancedFilters.timeTo}),
              },
            }),
        ...(advancedFilters.association === undefined
          ? {}
          : {
              association: {
                entryId: advancedFilters.association.entryId,
                maximumDepth: advancedFilters.association.maximumDepth,
                minimumScore: advancedFilters.association.minimumScore,
              },
            }),
        includePrivate,
        onlyPrivate,
      }),
    [
      advancedFilters,
      domainKeyword,
      effectiveRetrievalMode,
      includePrivate,
      onlyPrivate,
      query,
      snapshotId,
      textFields,
      textMode,
      typeKeyword,
    ],
  );
  const [lastRequestedSearch, setLastRequestedSearch] = useState(searchRequest);

  const clearScheduledSearch = useCallback(() => {
    if (scheduledSearchTimer.current === undefined) return;
    globalThis.clearTimeout(scheduledSearchTimer.current);
    scheduledSearchTimer.current = undefined;
  }, []);

  useEffect(
    () => () => {
      searchRequests.current.invalidate();
      documentRequests.current.invalidate();
    },
    [],
  );

  const refreshDocuments = useCallback(async () => {
    if (!loadDocuments || onListDocuments === undefined) return;
    const requestId = documentRequests.current.begin();
    setDocumentView({status: 'loading'});
    try {
      const response = await onListDocuments(includePrivate);
      if (!documentRequests.current.isCurrent(requestId)) return;
      if (response.body.status !== 'ok') {
        setDocumentView({
          status: 'error',
          message: describeFailure(response.body),
        });
        return;
      }
      setDocumentView({status: 'ready', response: response.body});
    } catch {
      if (!documentRequests.current.isCurrent(requestId)) return;
      setDocumentView({
        status: 'error',
        message: '无法读取 Document 聚合视图；现有 Entry 没有被修改。',
      });
    }
  }, [includePrivate, loadDocuments, onListDocuments]);

  const executeSearch = useCallback(
    async (
      after?: Readonly<InformationEntrySearchCursor>,
      selection: PageSelection = 'preserve',
    ) => {
      clearScheduledSearch();
      setLastRequestedSearch(searchRequest);
      const requestId = searchRequests.current.begin();
      setView({status: 'loading'});
      try {
        const response = await onSearch({
          ...searchRequest,
          limit: 20,
          ...(after === undefined ? {} : {after}),
        });
        if (!searchRequests.current.isCurrent(requestId)) return;
        if (response.body.status !== 'ok') {
          setView({status: 'error', message: describeFailure(response.body)});
          return;
        }
        const accepted = response.body;
        setView({status: 'ready', response: accepted});
        setSelectedEntryId((current) =>
          selectEntryAfterLoad(accepted.items, current, selection),
        );
      } catch {
        if (!searchRequests.current.isCurrent(requestId)) return;
        setView({
          status: 'error',
          message: '本地 Entry 接口当前不可达；现有条目没有被修改。',
        });
      }
    },
    [clearScheduledSearch, onSearch, searchRequest],
  );

  useEffect(() => {
    const tracker = searchRequests.current;
    let cancelled = false;
    const startSearch = () => {
      scheduledSearchTimer.current = undefined;
      if (cancelled) return;
      setPageIndex(0);
      setPageCursors(Object.freeze([undefined]));
      void executeSearch();
    };
    if (autoSearchDelayMs > 0) {
      scheduledSearchTimer.current = globalThis.setTimeout(
        startSearch,
        autoSearchDelayMs,
      );
    } else {
      globalThis.queueMicrotask(startSearch);
    }
    return () => {
      cancelled = true;
      clearScheduledSearch();
      tracker.invalidate();
    };
  }, [autoSearchDelayMs, clearScheduledSearch, executeSearch]);

  useEffect(() => {
    if (!loadDocuments) return;
    const tracker = documentRequests.current;
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) void refreshDocuments();
    });
    return () => {
      cancelled = true;
      tracker.invalidate();
    };
  }, [loadDocuments, refreshDocuments]);

  const selectedEntry = useMemo<Readonly<InformationEntry> | undefined>(() => {
    if (view.status !== 'ready') return undefined;
    return view.response.items.find(
      (item) => item.entry.entryId === selectedEntryId,
    )?.entry;
  }, [selectedEntryId, view]);

  const selectedEntryIndex =
    view.status === 'ready'
      ? view.response.items.findIndex(
          (item) => item.entry.entryId === selectedEntryId,
        )
      : -1;

  const selectedDocument = useMemo(() => {
    if (documentView.status !== 'ready' || snapshotId === '') return undefined;
    return documentView.response.documents.find(
      (document) => document.snapshotId === snapshotId,
    );
  }, [documentView, snapshotId]);

  function showNextPage(selection: PageSelection = 'preserve') {
    if (view.status !== 'ready' || view.response.nextCursor === undefined) {
      return;
    }
    const nextCursor = view.response.nextCursor;
    const nextPageIndex = pageIndex + 1;
    setPageCursors((current) =>
      Object.freeze([
        ...current.slice(0, nextPageIndex),
        Object.freeze(nextCursor),
      ]),
    );
    setPageIndex(nextPageIndex);
    void executeSearch(nextCursor, selection);
  }

  function showPreviousPage(selection: PageSelection = 'preserve') {
    if (pageIndex === 0) return;
    const previousPageIndex = pageIndex - 1;
    const previousCursor = pageCursors[previousPageIndex];
    setPageIndex(previousPageIndex);
    void executeSearch(previousCursor, selection);
  }

  function clearSearchFilters() {
    setQuery('');
    setTextMode('substring');
    setTextFields(Object.freeze(['title', 'body', 'tags']));
    setRetrievalMode('lexical');
    setSnapshotId('');
    setTypeKeyword('');
    setDomainKeyword('');
    setAdvancedFilters(EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS);
    setIncludePrivate(false);
    setOnlyPrivate(false);
  }

  function setPrivacyScope(scope: 'public' | 'all' | 'private') {
    setIncludePrivate(scope !== 'public');
    setOnlyPrivate(scope === 'private');
    if (scope !== 'public') setRetrievalMode('lexical');
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (value.trim() === '') setRetrievalMode('lexical');
  }

  return {
    advancedFilters,
    clearSearchFilters,
    documentView,
    domainKeyword,
    executeSearch,
    includePrivate,
    onlyPrivate,
    pageIndex,
    query,
    retrievalMode: effectiveRetrievalMode,
    refreshDocuments,
    selectedDocument,
    selectedEntry,
    selectedEntryId,
    selectedEntryIndex,
    searchRequest,
    searchDirty: lastRequestedSearch !== searchRequest,
    setAdvancedFilters,
    setDomainKeyword,
    setIncludePrivate,
    setOnlyPrivate,
    setPrivacyScope,
    setQuery: changeQuery,
    setRetrievalMode,
    setSelectedEntryId,
    setSnapshotId,
    setTextFields,
    setTextMode,
    setTypeKeyword,
    showNextPage,
    showPreviousPage,
    snapshotId,
    textFields,
    textMode,
    typeKeyword,
    view,
  } as const;
}

function selectEntryAfterLoad(
  items: Extract<InformationEntrySearchResponse, {status: 'ok'}>['items'],
  currentEntryId: string | undefined,
  selection: PageSelection,
): string | undefined {
  if (selection === 'first') return items[0]?.entry.entryId;
  if (selection === 'last') return items.at(-1)?.entry.entryId;
  return items.some((item) => item.entry.entryId === currentEntryId)
    ? currentEntryId
    : items[0]?.entry.entryId;
}

function describeFailure(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'issue' in value &&
    typeof value.issue === 'object' &&
    value.issue !== null &&
    'code' in value.issue &&
    typeof value.issue.code === 'string'
  ) {
    return `请求被拒绝：${value.issue.code}`;
  }
  return '请求没有完成；当前数据保持不变。';
}

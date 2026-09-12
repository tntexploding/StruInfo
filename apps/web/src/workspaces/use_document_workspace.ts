import {useCallback, useEffect, useMemo, useState} from 'react';

import type {M1cApiClient} from '../api/m1c_api_client.js';
import type {
  EvidenceSnapshot,
  InformationEntryDocumentView,
  InformationEntrySearchCursor,
  InformationEntrySearchResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';

export interface DocumentWorkspaceSelection {
  readonly snapshotId?: string | undefined;
  readonly includePrivate: boolean;
}

export type DocumentWorkspaceApi = Pick<
  M1cApiClient,
  | 'listInformationEntryDocuments'
  | 'loadEvidenceSnapshot'
  | 'searchInformationEntries'
  | 'materializeInformationEntries'
  | 'reviseInformationEntry'
>;

type EntryPage = Extract<InformationEntrySearchResponse, {status: 'ok'}>;
type ScopedLoad<T> = Readonly<{scope: string; state: Loadable<T>}>;
const LOADING = {status: 'loading'} as const;

export function useDocumentWorkspace({
  active,
  api,
  selection,
}: {
  readonly active: boolean;
  readonly api: DocumentWorkspaceApi;
  readonly selection: Readonly<DocumentWorkspaceSelection>;
}) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshotRefreshes, setSnapshotRefreshes] = useState<
    Readonly<Record<string, number>>
  >({});
  const [documentLoad, setDocumentLoad] =
    useState<ScopedLoad<readonly Readonly<InformationEntryDocumentView>[]>>();
  const [sourceLoad, setSourceLoad] =
    useState<ScopedLoad<Readonly<EvidenceSnapshot>>>();
  const [entryLoad, setEntryLoad] = useState<ScopedLoad<Readonly<EntryPage>>>();
  const [pagination, setPagination] = useState<
    Readonly<
      Record<
        string,
        readonly (Readonly<InformationEntrySearchCursor> | undefined)[]
      >
    >
  >({});
  const privateScope = selection.includePrivate;
  const documentScope = String(privateScope);
  const documents =
    documentLoad?.scope === documentScope ? documentLoad.state : LOADING;
  const selectedDocument =
    documents.status === 'ready'
      ? selection.snapshotId === undefined
        ? documents.value[0]
        : documents.value.find(
            (document) => document.snapshotId === selection.snapshotId,
          )
      : undefined;
  const snapshotId = selectedDocument?.snapshotId;
  const paginationScope = `${snapshotId ?? ''}:${documentScope}`;
  const contentScope =
    paginationScope +
    ':' +
    (snapshotRefreshes[snapshotId ?? ''] ?? 0).toString();
  const cursors = pagination[paginationScope] ?? [undefined];
  const pageIndex = cursors.length - 1;
  const cursor = cursors[pageIndex];
  const entryScope = `${contentScope}:${pageIndex.toString()}`;
  const source =
    sourceLoad?.scope === contentScope ? sourceLoad.state : LOADING;
  const entries = entryLoad?.scope === entryScope ? entryLoad.state : LOADING;

  useEffect(() => {
    if (!active) return;
    const request = new AbortController();
    void api
      .listInformationEntryDocuments({
        includePrivate: privateScope,
        signal: request.signal,
      })
      .then((response) => {
        if (request.signal.aborted) return;
        setDocumentLoad({
          scope: documentScope,
          state:
            response.body.status === 'ok'
              ? {
                  status: 'ready',
                  value: response.body.documents.filter(
                    (document) => privateScope || document.isPrivate !== true,
                  ),
                }
              : {
                  status: 'error',
                  message: describeInformationEntryFailure(response.body),
                },
        });
      })
      .catch(() => {
        if (!request.signal.aborted)
          setDocumentLoad({
            scope: documentScope,
            state: {status: 'error', message: '文档列表暂时不可用，请重试。'},
          });
      });
    return () => {
      request.abort();
    };
  }, [active, api, documentScope, privateScope, refreshVersion]);

  useEffect(() => {
    if (!active || snapshotId === undefined) return;
    const request = new AbortController();
    void api
      .loadEvidenceSnapshot(snapshotId, {
        includePrivate: privateScope,
        signal: request.signal,
      })
      .then((response) => {
        if (request.signal.aborted) return;
        const body = response.body;
        const valid =
          body.status === 'ok' &&
          body.snapshot.snapshotId === snapshotId &&
          (privateScope || body.snapshot.isPrivate !== true);
        setSourceLoad({
          scope: contentScope,
          state: valid
            ? {status: 'ready', value: body.snapshot}
            : {
                status: 'error',
                message: '无法读取这份文档，可能已不在当前可见范围。',
              },
        });
      })
      .catch(() => {
        if (!request.signal.aborted)
          setSourceLoad({
            scope: contentScope,
            state: {
              status: 'error',
              message: '原文读取失败，请重试。条目仍可单独查看。',
            },
          });
      });
    return () => {
      request.abort();
    };
  }, [active, api, contentScope, privateScope, snapshotId]);

  useEffect(() => {
    if (!active || snapshotId === undefined) return;
    const request = new AbortController();
    void api
      .searchInformationEntries(
        {
          snapshotId,
          includePrivate: privateScope,
          limit: 20,
          ...(cursor === undefined ? {} : {after: cursor}),
        },
        {signal: request.signal},
      )
      .then((response) => {
        if (request.signal.aborted) return;
        const body = response.body;
        const valid =
          body.status === 'ok' &&
          body.items.every(
            ({entry}) =>
              entry.snapshotId === snapshotId &&
              (privateScope || !entry.value.isPrivate),
          );
        setEntryLoad({
          scope: entryScope,
          state: valid
            ? {status: 'ready', value: body}
            : {
                status: 'error',
                message: '条目读取失败或范围已变化，请刷新后重试。',
              },
        });
      })
      .catch(() => {
        if (!request.signal.aborted)
          setEntryLoad({
            scope: entryScope,
            state: {
              status: 'error',
              message: '条目暂时无法读取，原文仍可查看。',
            },
          });
      });
    return () => {
      request.abort();
    };
  }, [active, api, cursor, entryScope, privateScope, snapshotId]);

  const refresh = useCallback((targetSnapshotId: string) => {
    setRefreshVersion((version) => version + 1);
    setSnapshotRefreshes((current) => ({
      ...current,
      [targetSnapshotId]: (current[targetSnapshotId] ?? 0) + 1,
    }));
  }, []);
  const nextPage = () => {
    if (entries.status === 'ready' && entries.value.nextCursor !== undefined)
      setPagination((current) => ({
        ...current,
        [paginationScope]: [...cursors, entries.value.nextCursor],
      }));
  };
  const previousPage = () => {
    if (pageIndex > 0)
      setPagination((current) => ({
        ...current,
        [paginationScope]: cursors.slice(0, -1),
      }));
  };
  const updateEntry: DocumentWorkspaceApi['reviseInformationEntry'] = async (
    ...args
  ) => {
    const response = await api.reviseInformationEntry(...args);
    const body = response.body;
    if (
      (body.status === 'applied' || body.status === 'unchanged') &&
      body.entry !== undefined
    ) {
      const updated = body.entry;
      setEntryLoad((current) =>
        current?.scope !== entryScope || current.state.status !== 'ready'
          ? current
          : {
              scope: entryScope,
              state: {
                status: 'ready',
                value: {
                  ...current.state.value,
                  items: current.state.value.items.map((item) =>
                    item.entry.entryId === updated.entryId
                      ? {...item, entry: updated}
                      : item,
                  ),
                },
              },
            },
      );
    }
    if (body.status === 'applied' || body.status === 'unchanged') {
      setRefreshVersion((version) => version + 1);
      if (body.entry === undefined && snapshotId !== undefined)
        refresh(snapshotId);
    }
    return response;
  };
  const snapshotTitle = useMemo(() => {
    if (source.status !== 'ready') return undefined;
    const heading = source.value.structures
      .flatMap((structure) => structure.fragments)
      .find((fragment) => fragment.nodeKind === 'heading');
    return heading?.selectedText;
  }, [source]);
  return {
    documents,
    selectedDocument,
    source,
    entries,
    snapshotTitle,
    pageIndex,
    nextPage,
    previousPage,
    refresh,
    updateEntry,
  };
}

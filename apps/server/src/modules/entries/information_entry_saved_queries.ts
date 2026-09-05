import type {InformationEntrySearchRequest} from './information_entry_contract.js';
import {decodeEntrySearchBody} from './information_entry_search_request.js';

export const MAX_ENTRY_SAVED_QUERIES = 20;
export type EntrySavedQueryConditions = Omit<
  InformationEntrySearchRequest,
  'limit' | 'after'
>;

export interface EntrySavedQuery {
  readonly viewId: string;
  readonly name: string;
  readonly query: Readonly<EntrySavedQueryConditions>;
  readonly selectedEntryId?: string;
}
export interface EntrySavedQueries {
  readonly version: 1;
  readonly revision: number;
  readonly views: readonly Readonly<EntrySavedQuery>[];
}
export const DEFAULT_ENTRY_SAVED_QUERIES: Readonly<EntrySavedQueries> =
  Object.freeze({version: 1, revision: 0, views: Object.freeze([])});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const QUERY_FIELDS = [
  'text',
  'retrievalMode',
  'textMode',
  'textFields',
  'contentKeyword',
  'sourceKey',
  'snapshotId',
  'typeKeyword',
  'typeCustomName',
  'domainKeyword',
  'domainCustomName',
  'domainScope',
  'chunkMode',
  'time',
  'association',
  'includePrivate',
  'onlyPrivate',
];

export function decodeEntrySavedQuery(
  value: unknown,
): Readonly<EntrySavedQuery> | undefined {
  if (
    !closed(value, ['viewId', 'name', 'query', 'selectedEntryId']) ||
    typeof value.viewId !== 'string' ||
    !UUID.test(value.viewId) ||
    typeof value.name !== 'string' ||
    (value.selectedEntryId !== undefined &&
      (typeof value.selectedEntryId !== 'string' ||
        !UUID.test(value.selectedEntryId)))
  )
    return undefined;
  const name = value.name.trim().normalize('NFC');
  if (name === '' || Array.from(name).length > 80) return undefined;
  if (
    !closed(value.query, QUERY_FIELDS) ||
    (value.query.time !== undefined &&
      !closed(value.query.time, ['field', 'from', 'to'])) ||
    (value.query.association !== undefined &&
      !closed(value.query.association, [
        'entryId',
        'maximumDepth',
        'minimumScore',
      ]))
  )
    return undefined;
  const decoded = decodeEntrySearchBody({...value.query, limit: 20});
  if (
    decoded === undefined ||
    (decoded.retrievalMode !== 'lexical' && decoded.includePrivate)
  )
    return undefined;
  const query = {...decoded};
  delete (query as {limit?: number}).limit;
  return Object.freeze({
    viewId: value.viewId,
    name,
    query: Object.freeze(query),
    ...(value.selectedEntryId === undefined
      ? {}
      : {selectedEntryId: value.selectedEntryId}),
  });
}

export function decodeEntrySavedQueries(
  value: unknown,
): Readonly<EntrySavedQueries> | undefined {
  if (
    !closed(value, ['version', 'revision', 'views']) ||
    value.version !== 1 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.views) ||
    value.views.length > MAX_ENTRY_SAVED_QUERIES
  )
    return undefined;
  const views: Readonly<EntrySavedQuery>[] = [];
  for (const raw of value.views) {
    const view = decodeEntrySavedQuery(raw);
    if (
      view === undefined ||
      views.some(
        (existing) =>
          existing.viewId === view.viewId || existing.name === view.name,
      )
    )
      return undefined;
    views.push(view);
  }
  return Object.freeze({
    version: 1,
    revision: value.revision,
    views: Object.freeze(views),
  });
}

export type EntrySavedQueryWrite = Readonly<{
  expectedRevision: number;
  viewId: string;
}> &
  (
    | Readonly<{operation: 'save'; view: Readonly<EntrySavedQuery>}>
    | Readonly<{operation: 'rename'; name: string}>
    | Readonly<{operation: 'delete'}>
  );
export function decodeEntrySavedQueryWrite(
  value: unknown,
): Readonly<EntrySavedQueryWrite> | undefined {
  if (
    !closed(value, [
      'expectedRevision',
      'operation',
      'viewId',
      'name',
      'query',
      'selectedEntryId',
    ]) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    typeof value.viewId !== 'string' ||
    !UUID.test(value.viewId)
  )
    return undefined;
  const common = {
    expectedRevision: value.expectedRevision,
    viewId: value.viewId,
  };
  if (value.operation === 'save') {
    const view = decodeEntrySavedQuery({
      viewId: value.viewId,
      name: value.name,
      query: value.query,
      ...(value.selectedEntryId === undefined
        ? {}
        : {selectedEntryId: value.selectedEntryId}),
    });
    return view === undefined
      ? undefined
      : Object.freeze({...common, operation: 'save', view});
  }
  if (value.query !== undefined || value.selectedEntryId !== undefined)
    return undefined;
  if (value.operation === 'delete' && value.name === undefined)
    return Object.freeze({...common, operation: 'delete'});
  if (value.operation !== 'rename' || typeof value.name !== 'string')
    return undefined;
  const name = value.name.trim().normalize('NFC');
  return name === '' || Array.from(name).length > 80
    ? undefined
    : Object.freeze({...common, operation: 'rename', name});
}

export function reviseEntrySavedQueries(
  current: Readonly<EntrySavedQueries>,
  write: Readonly<EntrySavedQueryWrite>,
):
  | Readonly<{
      status: 'applied' | 'unchanged';
      state: Readonly<EntrySavedQueries>;
    }>
  | Readonly<{status: 'rejected'; code: string}> {
  if (write.expectedRevision !== current.revision)
    return {status: 'rejected', code: 'saved_queries_revision_conflict'};
  const existing = current.views.find((view) => view.viewId === write.viewId);
  if (write.operation !== 'save' && existing === undefined)
    return {status: 'rejected', code: 'saved_query_not_found'};
  const next =
    write.operation === 'save'
      ? write.view
      : write.operation === 'rename' && existing !== undefined
        ? {...existing, name: write.name}
        : undefined;
  if (
    next !== undefined &&
    current.views.some(
      (view) => view.viewId !== next.viewId && view.name === next.name,
    )
  )
    return {status: 'rejected', code: 'saved_query_name_exists'};
  const views = current.views.filter((view) => view.viewId !== write.viewId);
  if (next !== undefined) {
    const position =
      existing === undefined ? views.length : current.views.indexOf(existing);
    views.splice(position, 0, next);
  }
  if (views.length > MAX_ENTRY_SAVED_QUERIES)
    return {status: 'rejected', code: 'saved_query_limit'};
  if (JSON.stringify(views) === JSON.stringify(current.views))
    return {status: 'unchanged', state: current};
  if (current.revision >= Number.MAX_SAFE_INTEGER)
    return {status: 'rejected', code: 'saved_queries_revision_conflict'};
  return {
    status: 'applied',
    state: Object.freeze({
      version: 1,
      revision: current.revision + 1,
      views: Object.freeze(views),
    }),
  };
}

function closed(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

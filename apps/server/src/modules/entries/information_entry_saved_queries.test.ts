import {describe, expect, it} from 'vitest';
import {
  decodeEntrySavedQueries,
  decodeEntrySavedQuery,
  decodeEntrySavedQueryWrite,
  DEFAULT_ENTRY_SAVED_QUERIES,
  reviseEntrySavedQueries,
} from './information_entry_saved_queries.js';

const ID = '11111111-1111-4111-8111-111111111111';
const SELECTED = '22222222-2222-4222-8222-222222222222';
const view = {
  viewId: ID,
  name: 'Synthetic query',
  query: {includePrivate: false, text: 'Synthetic'},
  selectedEntryId: SELECTED,
};
describe('saved Entry queries', () => {
  it('owns normalized query conditions and only the selected identity', () => {
    const fields = ['title', 'tags'];
    const decoded = decodeEntrySavedQuery({
      ...view,
      name: ' Synthetic query ',
      query: {...view.query, textFields: fields},
    });
    expect(decoded).toMatchObject({
      name: view.name,
      selectedEntryId: SELECTED,
      query: {textFields: ['title', 'tags'], retrievalMode: 'lexical'},
    });
    expect(decoded?.query).not.toHaveProperty('limit');
    fields[0] = 'body';
    expect(decoded?.query.textFields).toEqual(['title', 'tags']);
  });
  it('rejects result payloads, cursors, unbounded names and invalid search semantics', () => {
    for (const patch of [
      {after: {}},
      {limit: 80},
      {answer: 'Synthetic'},
      {text: 'x'.repeat(301)},
      {typeKeyword: 'other'},
      {domainScope: 'primary'},
      {time: {field: 'published', from: '2026-02-30'}},
      {time: {field: 'published', from: '2026-01-01', body: 'Synthetic'}},
      {association: {entryId: ID, maximumDepth: 3, minimumScore: 0}},
      {includePrivate: true, retrievalMode: 'semantic'},
    ])
      expect(
        decodeEntrySavedQuery({...view, query: {...view.query, ...patch}}),
      ).toBeUndefined();
    expect(
      decodeEntrySavedQuery({...view, name: '😀'.repeat(81)}),
    ).toBeUndefined();
    expect(
      decodeEntrySavedQuery({...view, selectedEntryId: '../entry'}),
    ).toBeUndefined();
    expect(decodeEntrySavedQuery({...view, body: 'Synthetic'})).toBeUndefined();
  });
  it('retains explicit privacy intent without executing a query', () => {
    expect(
      decodeEntrySavedQuery({
        ...view,
        query: {includePrivate: true, onlyPrivate: true},
      })?.query,
    ).toMatchObject({includePrivate: true, onlyPrivate: true});
    expect(
      decodeEntrySavedQuery({
        ...view,
        query: {includePrivate: false, onlyPrivate: true},
      }),
    ).toBeUndefined();
  });
  it('updates conditions, renames without rewriting them and deletes only the view', () => {
    const write = decodeEntrySavedQueryWrite({
      ...view,
      expectedRevision: 0,
      operation: 'save',
    });
    if (write === undefined) throw new Error('Invalid synthetic write.');
    const saved = reviseEntrySavedQueries(DEFAULT_ENTRY_SAVED_QUERIES, write);
    if (saved.status === 'rejected') throw new Error(saved.code);
    const renamed = reviseEntrySavedQueries(saved.state, {
      operation: 'rename',
      expectedRevision: 1,
      viewId: ID,
      name: 'Synthetic renamed',
    });
    if (renamed.status === 'rejected') throw new Error(renamed.code);
    expect(renamed.state.views[0]?.query).toEqual(saved.state.views[0]?.query);
    expect(renamed.state.views[0]?.selectedEntryId).toBe(SELECTED);
    expect(
      reviseEntrySavedQueries(renamed.state, {
        operation: 'delete',
        expectedRevision: 2,
        viewId: ID,
      }),
    ).toEqual({status: 'applied', state: {version: 1, revision: 3, views: []}});
  });
  it('rejects stale edits, duplicate names and a twenty-first view', () => {
    const state = decodeEntrySavedQueries({
      version: 1,
      revision: 3,
      views: [view],
    });
    if (state === undefined) throw new Error('Invalid synthetic state.');
    expect(
      reviseEntrySavedQueries(state, {
        operation: 'delete',
        expectedRevision: 2,
        viewId: ID,
      }),
    ).toMatchObject({
      status: 'rejected',
      code: 'saved_queries_revision_conflict',
    });
    expect(
      reviseEntrySavedQueries(state, {
        operation: 'save',
        expectedRevision: 3,
        viewId: SELECTED,
        view: {...view, viewId: SELECTED},
      }),
    ).toMatchObject({code: 'saved_query_name_exists'});
    const full = {
      version: 1 as const,
      revision: 0,
      views: Array.from({length: 20}, (_, i) => ({
        ...view,
        viewId: i.toString(),
        name: 'Synthetic ' + i.toString(),
      })),
    };
    expect(
      reviseEntrySavedQueries(full, {
        operation: 'save',
        expectedRevision: 0,
        viewId: ID,
        view,
      }),
    ).toMatchObject({code: 'saved_query_limit'});
    expect(
      decodeEntrySavedQueries({version: 1, revision: 0, views: [view, view]}),
    ).toBeUndefined();
    expect(
      decodeEntrySavedQueryWrite({
        ...view,
        expectedRevision: 0,
        operation: 'delete',
      }),
    ).toBeUndefined();
  });
});

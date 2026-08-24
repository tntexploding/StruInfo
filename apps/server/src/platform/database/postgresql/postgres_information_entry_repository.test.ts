import {describe, expect, it, vi} from 'vitest';

import type {InformationEntryMaterializeRow} from '../../../modules/entries/index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {PostgresInformationEntryRepository} from './postgres_information_entry_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const FRAGMENT_ID = '66666666-6666-4666-8666-666666666666';

describe('PostgresInformationEntryRepository', () => {
  it('treats an existing source materialization as an equal replay', async () => {
    const statements: string[] = [];
    const pool = createPool((sql) => {
      statements.push(sql);
      if (sql.includes('FROM struinfo.workspace WHERE')) {
        return rows({workspace_id: WORKSPACE_ID});
      }
      if (sql.includes('information_entry_fragment_input')) {
        return rows({
          fragment_id: FRAGMENT_ID,
          start_code_point: null,
          end_code_point: null,
        });
      }
      if (sql.includes('FROM struinfo.information_entry')) {
        return rows({
          resource_id: RESOURCE_ID,
          snapshot_id: SNAPSHOT_ID,
          document_order: 0,
          chunk_mode: 'split',
          split_rule_version: 'struinfo.entry-split.section.v1',
          is_private: false,
        });
      }
      return rows();
    });
    const repository = new PostgresInformationEntryRepository(pool);

    await expect(
      repository.materializeEntries([materializeRow()]),
    ).resolves.toEqual({
      outcome: 'existing',
      createdCount: 0,
    });
    expect(
      statements.some((sql) => sql.includes('FROM struinfo.information_entry')),
    ).toBe(true);
    expect(statements.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
  });

  it('writes a typed range row for a ranged source materialization', async () => {
    const statements: string[] = [];
    const pool = createPool((sql) => {
      statements.push(sql);
      if (sql.includes('FROM struinfo.workspace WHERE')) {
        return rows({workspace_id: WORKSPACE_ID});
      }
      if (sql.startsWith('INSERT INTO')) {
        return {rows: [], rowCount: 1};
      }
      return rows();
    });
    const repository = new PostgresInformationEntryRepository(pool);

    await expect(
      repository.materializeEntries([
        materializeRow([{startCodePoint: 2, endCodePoint: 8}]),
      ]),
    ).resolves.toEqual({outcome: 'created', createdCount: 1});
    expect(
      statements.some((sql) =>
        sql.startsWith('INSERT INTO struinfo.information_entry_fragment_range'),
      ),
    ).toBe(true);
  });
});

function materializeRow(
  fragmentRanges?: readonly Readonly<{
    startCodePoint: number;
    endCodePoint: number;
  }>[],
): Readonly<InformationEntryMaterializeRow> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: ENTRY_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revisionId: REVISION_ID,
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic Entry',
      body: 'Synthetic body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: false,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([FRAGMENT_ID]),
      ...(fragmentRanges === undefined
        ? {}
        : {fragmentRanges: Object.freeze(fragmentRanges)}),
    }),
  });
}

function createPool(
  respond: (sql: string) => PostgresQueryResult<Row>,
): PostgresPoolBoundary {
  const client: PostgresClientBoundary = {
    query<QueryRow extends Row>(sql: string) {
      return Promise.resolve(respond(sql) as PostgresQueryResult<QueryRow>);
    },
    executeSimple: () => Promise.reject(new Error('unexpected executeSimple')),
    release: vi.fn(),
  };
  return {
    query: () => Promise.reject(new Error('unexpected pool query')),
    connect: () => Promise.resolve(client),
    end: () => Promise.resolve(),
  };
}

type Row = Readonly<Record<string, unknown>>;

function rows(...values: readonly Row[]): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}

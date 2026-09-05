import {describe, expect, it, vi} from 'vitest';

import type {InformationEntryMaterializeRow} from '../../../modules/entries/index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  COUNT_CURRENT_INFORMATION_ENTRY_BROWSE_SQL,
  PostgresInformationEntryRepository,
  READ_CURRENT_INFORMATION_ENTRY_BROWSE_PAGE_SQL,
} from './postgres_information_entry_repository.js';

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

  it('reads type coverage and hydrates only one bounded correction page', async () => {
    const calls: Readonly<{sql: string; parameters?: readonly unknown[]}>[] =
      [];
    const nextEntryId = '77777777-7777-4777-8777-777777777777';
    const capturedAt = new Date('2040-01-02T03:04:05.000Z');
    const pool = createPool((sql, parameters) => {
      calls.push({sql, ...(parameters === undefined ? {} : {parameters})});
      if (sql.includes('GROUP BY e.type_keyword')) {
        return rows(
          {type_keyword: null, entry_count: 2},
          {type_keyword: 'argument', entry_count: 3},
        );
      }
      if (sql.includes('LIMIT $8')) {
        return rows(
          {
            entry_id: ENTRY_ID,
            snapshot_id: SNAPSHOT_ID,
            document_order: 0,
            captured_at: capturedAt,
          },
          {
            entry_id: nextEntryId,
            snapshot_id: SNAPSHOT_ID,
            document_order: 1,
            captured_at: capturedAt,
          },
        );
      }
      if (
        sql.includes('FROM struinfo.information_entry AS e') &&
        sql.includes('e.entry_id = ANY')
      ) {
        return rows({
          workspace_id: WORKSPACE_ID,
          entry_id: ENTRY_ID,
          resource_id: RESOURCE_ID,
          snapshot_id: SNAPSHOT_ID,
          current_revision: 1,
          current_revision_id: REVISION_ID,
          document_order: 0,
          title_path: 'Synthetic type review',
          body: 'Synthetic body',
          body_sha256: 'a'.repeat(64),
          chunk_mode: 'split',
          split_rule_version: 'synthetic.type-review.v1',
          is_private: false,
          type_keyword: null,
          type_custom_name: null,
          usefulness_score: null,
          interest_score: null,
          source_key: 'synthetic:type-review',
          canonical_uri: null,
          captured_at: capturedAt,
          published_at: null,
        });
      }
      if (sql.includes('information_entry_fragment_input')) {
        return rows({
          entry_id: ENTRY_ID,
          input_ordinal: 0,
          fragment_id: FRAGMENT_ID,
          start_code_point: null,
          end_code_point: null,
        });
      }
      return rows();
    });
    const repository = new PostgresInformationEntryRepository(pool);

    const result = await repository.reviewCurrentEntryTypes({
      workspaceId: WORKSPACE_ID,
      includePrivate: false,
      filter: 'missing',
      limit: 1,
    });

    expect(result.coverage).toMatchObject({
      totalCount: 5,
      classifiedCount: 3,
      missingCount: 2,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.entryId).toBe(ENTRY_ID);
    expect(result.nextCursor).toEqual({
      capturedAt: '2040-01-02T03:04:05.000Z',
      snapshotId: SNAPSHOT_ID,
      documentOrder: 0,
      entryId: ENTRY_ID,
    });
    expect(
      calls.find(({sql}) => sql.includes('LIMIT $8'))?.parameters?.at(-1),
    ).toBe(2);
  });

  it('counts and hydrates only one chronological browse page', async () => {
    const calls: Readonly<{sql: string; parameters?: readonly unknown[]}>[] =
      [];
    const capturedAt = new Date('2040-01-02T03:04:05.000Z');
    const pool = createPool((sql, parameters) => {
      calls.push({sql, ...(parameters === undefined ? {} : {parameters})});
      if (sql === COUNT_CURRENT_INFORMATION_ENTRY_BROWSE_SQL) {
        return rows({total_count: 14_910});
      }
      if (sql === READ_CURRENT_INFORMATION_ENTRY_BROWSE_PAGE_SQL) {
        return rows({entry_id: ENTRY_ID});
      }
      if (
        sql.includes('e.current_revision') &&
        sql.includes('e.entry_id = ANY')
      ) {
        return rows({
          workspace_id: WORKSPACE_ID,
          entry_id: ENTRY_ID,
          resource_id: RESOURCE_ID,
          snapshot_id: SNAPSHOT_ID,
          current_revision: 1,
          current_revision_id: REVISION_ID,
          document_order: 0,
          title_path: 'Synthetic browse',
          body: 'Synthetic body',
          body_sha256: 'a'.repeat(64),
          chunk_mode: 'split',
          split_rule_version: 'synthetic.browse.v1',
          is_private: false,
          type_keyword: null,
          type_custom_name: null,
          usefulness_score: null,
          interest_score: null,
          source_key: 'synthetic:browse',
          canonical_uri: null,
          captured_at: capturedAt,
          published_at: null,
        });
      }
      if (sql.includes('information_entry_fragment_input')) {
        return rows({
          entry_id: ENTRY_ID,
          input_ordinal: 0,
          fragment_id: FRAGMENT_ID,
          start_code_point: null,
          end_code_point: null,
        });
      }
      return rows();
    });
    const repository = new PostgresInformationEntryRepository(pool);

    await expect(
      repository.loadCurrentEntryBrowsePage(WORKSPACE_ID, 'public', 2),
    ).resolves.toMatchObject({
      totalCount: 14_910,
      entries: [{entryId: ENTRY_ID, value: {titlePath: 'Synthetic browse'}}],
    });
    expect(
      calls.find(
        ({sql}) => sql === READ_CURRENT_INFORMATION_ENTRY_BROWSE_PAGE_SQL,
      )?.parameters,
    ).toEqual([WORKSPACE_ID, 'public', null, null, null, 2]);
    expect(
      calls.filter(
        ({sql}) =>
          sql.includes('e.current_revision') &&
          sql.includes('e.entry_id = ANY'),
      ),
    ).toHaveLength(1);
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
  respond: (
    sql: string,
    parameters?: readonly unknown[],
  ) => PostgresQueryResult<Row>,
): PostgresPoolBoundary {
  const client: PostgresClientBoundary = {
    query<QueryRow extends Row>(sql: string, parameters?: readonly unknown[]) {
      return Promise.resolve(
        respond(sql, parameters) as PostgresQueryResult<QueryRow>,
      );
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

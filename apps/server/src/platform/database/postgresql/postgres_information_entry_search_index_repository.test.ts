import {describe, expect, it, vi} from 'vitest';

import {INFORMATION_ENTRY_TERM_TOKENIZER_VERSION} from '../../../modules/entries/index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresInformationEntrySearchIndexRepository,
  READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL,
  READ_INFORMATION_ENTRY_TERM_POSTINGS_SQL,
} from './postgres_information_entry_search_index_repository.js';
import {READ_WORKSPACE_SQL} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';

describe('PostgresInformationEntrySearchIndexRepository', () => {
  it('maps a complete model-bound index snapshot under a repeatable-read load', async () => {
    const repository = new PostgresInformationEntrySearchIndexRepository(
      createPool((sql) => {
        if (sql === READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL) {
          return rows({
            entry_id: ENTRY_ID,
            entry_revision: 2,
            entry_revision_id: REVISION_ID,
            projection_sha256: 'a'.repeat(64),
            tokenizer_version: INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
            embedding_provider: 'synthetic-provider',
            embedding_model: 'synthetic-model',
            embedding_dimensions: 2,
            embedding: ['1', '0'],
          });
        }
        if (sql === READ_INFORMATION_ENTRY_TERM_POSTINGS_SQL) {
          return rows({
            entry_id: ENTRY_ID,
            field: 'body',
            term: 'synthetic',
            occurrences: 2,
          });
        }
        return rows();
      }),
    );

    await expect(repository.loadSearchIndex(WORKSPACE_ID)).resolves.toEqual({
      projections: [
        {
          entryId: ENTRY_ID,
          entryRevision: 2,
          entryRevisionId: REVISION_ID,
          projectionSha256: 'a'.repeat(64),
          tokenizerVersion: INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
          embeddingProvider: 'synthetic-provider',
          embeddingModel: 'synthetic-model',
          embedding: [1, 0],
        },
      ],
      postings: [
        {entryId: ENTRY_ID, field: 'body', term: 'synthetic', occurrences: 2},
      ],
    });
  });

  it('replaces the whole workspace index after taking the workspace lock', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const repository = new PostgresInformationEntrySearchIndexRepository(
      createPool((sql, parameters) => {
        statements.push({
          sql,
          ...(parameters === undefined ? {} : {parameters}),
        });
        return sql === READ_WORKSPACE_SQL
          ? rows({workspace_id: WORKSPACE_ID})
          : rows();
      }),
    );

    await repository.replaceSearchIndex(WORKSPACE_ID, {
      projections: [
        {
          entryId: ENTRY_ID,
          entryRevision: 1,
          entryRevisionId: REVISION_ID,
          projectionSha256: 'b'.repeat(64),
          tokenizerVersion: INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
        },
      ],
      postings: [
        {entryId: ENTRY_ID, field: 'title', term: 'alpha', occurrences: 1},
      ],
    });

    expect(statements.some(({sql}) => sql === READ_WORKSPACE_SQL)).toBe(true);
    expect(
      statements.some(({sql}) =>
        sql.startsWith('DELETE FROM struinfo.information_entry_term_posting'),
      ),
    ).toBe(true);
    expect(
      statements.some(({sql}) =>
        sql.startsWith(
          'INSERT INTO struinfo.information_entry_search_projection',
        ),
      ),
    ).toBe(true);
    expect(
      statements.some(
        ({sql, parameters}) =>
          sql.startsWith(
            'INSERT INTO struinfo.information_entry_term_posting',
          ) && parameters?.[3] === 'alpha',
      ),
    ).toBe(true);
  });
});

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

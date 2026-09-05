import {describe, expect, it, vi} from 'vitest';

import {INFORMATION_ENTRY_TERM_TOKENIZER_VERSION} from '../../../modules/entries/index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresInformationEntrySearchIndexRepository,
  FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL,
  READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL,
  READ_INFORMATION_ENTRY_SEARCH_INDEX_METRICS_SQL,
  READ_INFORMATION_ENTRY_INDEX_COMMIT_STATE_SQL,
  READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL,
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
        if (sql === READ_INFORMATION_ENTRY_INDEX_COMMIT_STATE_SQL)
          return rows({
            entry_id: ENTRY_ID,
            current_revision: 1,
            current_revision_id: REVISION_ID,
            is_private: false,
            is_current_structure: true,
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

  it('reads aggregate index metrics without loading projection or posting rows', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const repository = new PostgresInformationEntrySearchIndexRepository(
      createPool((sql, parameters) => {
        statements.push({
          sql,
          ...(parameters === undefined ? {} : {parameters}),
        });
        return sql === READ_INFORMATION_ENTRY_SEARCH_INDEX_METRICS_SQL
          ? rows({
              public_entry_count: 14_910,
              current_projection_count: 14_900,
              embedded_projection_count: 14_800,
              stale_projection_count: 10,
              posting_count: 2_989_278,
            })
          : rows();
      }),
    );

    await expect(
      repository.loadSearchIndexMetrics(
        WORKSPACE_ID,
        'synthetic-provider',
        'synthetic-model',
      ),
    ).resolves.toEqual({
      publicEntryCount: 14_910,
      currentProjectionCount: 14_900,
      embeddedProjectionCount: 14_800,
      staleProjectionCount: 10,
      postingCount: 2_989_278,
    });
    expect(statements).toContainEqual({
      sql: READ_INFORMATION_ENTRY_SEARCH_INDEX_METRICS_SQL,
      parameters: [WORKSPACE_ID, 'synthetic-provider', 'synthetic-model'],
    });
    expect(
      statements.some(
        ({sql}) =>
          sql === READ_INFORMATION_ENTRY_SEARCH_PROJECTIONS_SQL ||
          sql === READ_INFORMATION_ENTRY_TERM_POSTINGS_SQL,
      ),
    ).toBe(false);
  });

  it('returns indexed lexical candidates only when every public Entry projection is current', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const repository = new PostgresInformationEntrySearchIndexRepository(
      createPool((sql, parameters) => {
        statements.push({
          sql,
          ...(parameters === undefined ? {} : {parameters}),
        });
        if (sql === READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL) {
          return rows({
            public_entry_count: 14_910,
            current_projection_count: 14_910,
          });
        }
        if (sql === FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL) {
          return rows({entry_id: ENTRY_ID});
        }
        return rows();
      }),
    );

    await expect(
      repository.findLexicalCandidateEntryIds(WORKSPACE_ID, {
        fields: ['title', 'body'],
        terms: ['postgresql'],
      }),
    ).resolves.toEqual([ENTRY_ID]);
    expect(
      statements.find(
        ({sql}) => sql === FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL,
      )?.parameters,
    ).toEqual([WORKSPACE_ID, ['title', 'body'], ['postgresql']]);
    expect(
      statements.find(
        ({sql}) => sql === READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL,
      )?.parameters,
    ).toEqual([WORKSPACE_ID, 'struinfo.entry-terms.unicode-v1', 4_096]);
    expect(READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL).toContain(
      'count(*)',
    );
    expect(READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL).toContain(
      '< $3::integer',
    );
  });

  it('requires the complete current projection before narrowing candidates', async () => {
    const candidateQuery = vi.fn();
    const repository = new PostgresInformationEntrySearchIndexRepository(
      createPool((sql) => {
        if (sql === READ_INFORMATION_ENTRY_SEARCH_INDEX_READINESS_SQL) {
          return rows({public_entry_count: 407, current_projection_count: 406});
        }
        if (sql === FIND_INFORMATION_ENTRY_LEXICAL_CANDIDATES_SQL) {
          candidateQuery();
        }
        return rows();
      }),
    );

    await expect(
      repository.findLexicalCandidateEntryIds(WORKSPACE_ID, {
        fields: ['tags'],
        terms: ['docker'],
      }),
    ).resolves.toBeUndefined();
    expect(candidateQuery).not.toHaveBeenCalled();
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

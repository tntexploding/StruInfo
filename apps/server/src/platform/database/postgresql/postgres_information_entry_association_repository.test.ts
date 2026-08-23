import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  DELETE_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
  PostgresInformationEntryAssociationRepository,
} from './postgres_information_entry_association_repository.js';
import {READ_WORKSPACE_SQL} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('PostgresInformationEntryAssociationRepository', () => {
  it('replaces only the requested privacy scope while leaving manual overrides untouched', async () => {
    const statements: Readonly<{
      sql: string;
      parameters?: readonly unknown[];
    }>[] = [];
    const pool = createPool((sql, parameters) => {
      statements.push({sql, ...(parameters === undefined ? {} : {parameters})});
      return sql === READ_WORKSPACE_SQL
        ? rows({workspace_id: WORKSPACE_ID})
        : rows();
    });
    const repository = new PostgresInformationEntryAssociationRepository(pool);

    await expect(
      repository.replaceAssociationProjections(WORKSPACE_ID, [], false),
    ).resolves.toBe(0);
    await expect(
      repository.replaceAssociationProjections(WORKSPACE_ID, [], true),
    ).resolves.toBe(0);

    const replacements = statements.filter(
      ({sql}) => sql === DELETE_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
    );
    expect(replacements.map(({parameters}) => parameters)).toEqual([
      [WORKSPACE_ID, false],
      [WORKSPACE_ID, true],
    ]);
    expect(DELETE_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL).toContain(
      'NOT low_entry.is_private AND NOT high_entry.is_private',
    );
    expect(
      statements.some(({sql}) =>
        sql.includes('information_entry_association_override'),
      ),
    ).toBe(false);
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

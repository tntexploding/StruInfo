import {describe, expect, it, vi} from 'vitest';

import {createEmptyM1cDomainSnapshot} from '../../../workspace_transfer/m1c_workspace_transfer.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresM1cDomainTransferRepository,
  READ_WORKSPACE_FOR_TRANSFER_SQL,
} from './postgres_workspace_transfer_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2040-01-02T03:04:05.000Z';

describe('PostgresM1cDomainTransferRepository', () => {
  it('exports every domain table inside one repeatable-read snapshot', async () => {
    const {pool, statements, release} = createPool((sql) => {
      if (sql.includes('FROM struinfo.workspace AS t')) {
        return rows([
          {row_payload: {workspace_id: WORKSPACE_ID, created_at: CREATED_AT}},
        ]);
      }
      return rows([]);
    });
    const repository = new PostgresM1cDomainTransferRepository(pool);

    const snapshot = await repository.exportWorkspace(WORKSPACE_ID);

    expect(snapshot.tables).toHaveLength(36);
    expect(snapshot.tables[0]).toMatchObject({name: 'workspace'});
    expect(statements[0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('restores all non-empty tables only when the workspace is absent', async () => {
    const {pool, statements, parameters} = createPool((sql) =>
      sql === READ_WORKSPACE_FOR_TRANSFER_SQL ? rows([]) : rows([]),
    );
    const repository = new PostgresM1cDomainTransferRepository(pool);
    const snapshot = createEmptyM1cDomainSnapshot(WORKSPACE_ID, CREATED_AT);

    await repository.restoreEmptyWorkspace(WORKSPACE_ID, snapshot);

    expect(statements).toContain('SET CONSTRAINTS ALL DEFERRED');
    expect(statements).toContainEqual(
      expect.stringContaining(
        'jsonb_populate_recordset(NULL::struinfo.workspace, $1::jsonb)',
      ),
    );
    expect(parameters).toContainEqual([
      JSON.stringify(snapshot.tables[0]?.rows),
    ]);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('refuses to merge a Bundle into an existing workspace', async () => {
    const {pool, statements} = createPool((sql) =>
      sql === READ_WORKSPACE_FOR_TRANSFER_SQL
        ? rows([{workspace_id: WORKSPACE_ID}])
        : rows([]),
    );
    const repository = new PostgresM1cDomainTransferRepository(pool);

    await expect(
      repository.restoreEmptyWorkspace(
        WORKSPACE_ID,
        createEmptyM1cDomainSnapshot(WORKSPACE_ID, CREATED_AT),
      ),
    ).rejects.toEqual(expect.objectContaining({code: 'workspace_not_empty'}));
    expect(statements.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
  });
});

function createPool(
  resolveQuery: (
    sql: string,
    parameters: readonly unknown[],
  ) => PostgresQueryResult<Readonly<Record<string, unknown>>>,
): Readonly<{
  pool: PostgresPoolBoundary;
  statements: string[];
  parameters: readonly unknown[][];
  release: ReturnType<typeof vi.fn>;
}> {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const release = vi.fn();
  const client: PostgresClientBoundary = {
    query<Row extends Readonly<Record<string, unknown>>>(
      sql: string,
      values: readonly unknown[] = [],
    ) {
      statements.push(sql);
      parameters.push([...values]);
      return Promise.resolve(
        resolveQuery(sql, values) as PostgresQueryResult<Row>,
      );
    },
    executeSimple: () => Promise.reject(new Error('unexpected executeSimple')),
    release,
  };
  return {
    statements,
    parameters,
    release,
    pool: {
      query: () => Promise.reject(new Error('unexpected pool query')),
      connect: () => Promise.resolve(client),
      end: () => Promise.resolve(),
    },
  };
}

function rows<Row extends Readonly<Record<string, unknown>>>(
  values: readonly Row[],
): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}

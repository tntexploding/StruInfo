import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {PostgresInformationDocumentWorkingCopyRepository} from './postgres_information_document_working_copy_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const DERIVED_SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const BODY_SHA = 'a'.repeat(64);

describe('PostgresInformationDocumentWorkingCopyRepository', () => {
  it('creates one current draft under the workspace lock', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const repository = new PostgresInformationDocumentWorkingCopyRepository(
      createPool((sql, parameters) => {
        statements.push({
          sql,
          ...(parameters === undefined ? {} : {parameters}),
        });
        if (sql.includes('FROM struinfo.workspace WHERE')) {
          return rows({workspace_id: WORKSPACE_ID});
        }
        if (
          sql.startsWith(
            'INSERT INTO struinfo.information_document_working_copy',
          )
        ) {
          return affected();
        }
        return rows();
      }),
    );

    await expect(
      repository.save({
        workspaceId: WORKSPACE_ID,
        sourceSnapshotId: SNAPSHOT_ID,
        expectedRevision: 0,
        draftBody: 'Edited document.',
        bodySha256: BODY_SHA,
      }),
    ).resolves.toEqual({
      outcome: 'applied',
      value: {
        workspaceId: WORKSPACE_ID,
        sourceSnapshotId: SNAPSHOT_ID,
        revision: 1,
        state: 'editing',
        draftBody: 'Edited document.',
        bodySha256: BODY_SHA,
      },
    });
    expect(
      statements.find((value) =>
        value.sql.startsWith(
          'INSERT INTO struinfo.information_document_working_copy',
        ),
      )?.parameters,
    ).toEqual([WORKSPACE_ID, SNAPSHOT_ID, 'Edited document.', BODY_SHA]);
    expect(statements.at(-1)?.sql).toBe('COMMIT');
  });

  it('commits only the exact saved revision to one derived Snapshot', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const repository = new PostgresInformationDocumentWorkingCopyRepository(
      createPool((sql, parameters) => {
        statements.push({
          sql,
          ...(parameters === undefined ? {} : {parameters}),
        });
        if (sql.includes('FROM struinfo.workspace WHERE')) {
          return rows({workspace_id: WORKSPACE_ID});
        }
        if (
          sql.includes('information_document_working_copy') &&
          sql.includes('FOR UPDATE')
        ) {
          return rows({
            source_snapshot_id: SNAPSHOT_ID,
            revision: 2,
            state: 'editing',
            draft_body: 'Edited document.',
            body_sha256: BODY_SHA,
            derived_resource_id: null,
            derived_snapshot_id: null,
          });
        }
        if (
          sql.startsWith('UPDATE struinfo.information_document_working_copy')
        ) {
          return affected();
        }
        return rows();
      }),
    );

    await expect(
      repository.commit({
        workspaceId: WORKSPACE_ID,
        sourceSnapshotId: SNAPSHOT_ID,
        expectedRevision: 2,
        bodySha256: BODY_SHA,
        derivedResourceId: RESOURCE_ID,
        derivedSnapshotId: DERIVED_SNAPSHOT_ID,
      }),
    ).resolves.toMatchObject({
      outcome: 'committed',
      value: {
        state: 'committed',
        revision: 2,
        derivedResourceId: RESOURCE_ID,
        derivedSnapshotId: DERIVED_SNAPSHOT_ID,
      },
    });
    expect(
      statements.find((value) =>
        value.sql.startsWith(
          'UPDATE struinfo.information_document_working_copy',
        ),
      )?.parameters,
    ).toEqual([WORKSPACE_ID, SNAPSHOT_ID, RESOURCE_ID, DERIVED_SNAPSHOT_ID, 2]);
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

function affected(): PostgresQueryResult<Row> {
  return {rows: [], rowCount: 1};
}

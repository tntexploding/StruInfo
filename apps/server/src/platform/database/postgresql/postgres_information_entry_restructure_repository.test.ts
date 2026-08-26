import {describe, expect, it, vi} from 'vitest';

import type {InformationEntryRestructureWrite} from '../../../modules/entries/index.js';
import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {PostgresInformationEntryRestructureRepository} from './postgres_information_entry_restructure_repository.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const PREDECESSOR_ID = '44444444-4444-4444-8444-444444444444';
const PREDECESSOR_REVISION_ID = '55555555-5555-4555-8555-555555555555';
const SUCCESSOR_ID = '66666666-6666-4666-8666-666666666666';
const SUCCESSOR_REVISION_ID = '77777777-7777-4777-8777-777777777777';
const FRAGMENT_ID = '88888888-8888-4888-8888-888888888888';

describe('PostgresInformationEntryRestructureRepository', () => {
  it('retires the old structure and inserts its successor in one workspace transaction', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const pool = createPool((sql, parameters) => {
      statements.push({sql, ...(parameters === undefined ? {} : {parameters})});
      if (sql.includes('FROM struinfo.workspace WHERE')) {
        return rows({workspace_id: WORKSPACE_ID});
      }
      if (
        sql.includes('FROM struinfo.information_entry') &&
        sql.includes('snapshot_id = $2')
      ) {
        return rows({
          entry_id: PREDECESSOR_ID,
          current_revision: 1,
          current_revision_id: PREDECESSOR_REVISION_ID,
        });
      }
      if (sql.includes('information_entry_association_override')) return rows();
      if (sql.startsWith('UPDATE struinfo.information_entry SET')) {
        return affected();
      }
      if (sql.startsWith('INSERT INTO')) return affected();
      return rows();
    });
    const repository = new PostgresInformationEntryRestructureRepository(pool);

    await expect(repository.applyEntryRestructure(write())).resolves.toBe(
      'applied',
    );
    expect(
      statements.find((statement) =>
        statement.sql.startsWith(
          'DELETE FROM struinfo.information_entry_association_projection',
        ),
      )?.parameters,
    ).toEqual([WORKSPACE_ID, false]);
    expect(
      statements.some((statement) =>
        statement.sql.startsWith('INSERT INTO struinfo.information_entry ('),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.startsWith(
          'INSERT INTO struinfo.information_entry_lineage',
        ),
      ),
    ).toBe(true);
    expect(statements.at(-1)?.sql).toBe('COMMIT');
  });

  it('returns stale before writes when the current structure changed', async () => {
    const statements: string[] = [];
    const pool = createPool((sql) => {
      statements.push(sql);
      if (sql.includes('FROM struinfo.workspace WHERE')) {
        return rows({workspace_id: WORKSPACE_ID});
      }
      return rows();
    });
    const repository = new PostgresInformationEntryRestructureRepository(pool);

    await expect(repository.applyEntryRestructure(write())).resolves.toBe(
      'stale',
    );
    expect(
      statements.some(
        (statement) =>
          statement.startsWith('UPDATE struinfo.information_entry SET') ||
          statement.startsWith('INSERT INTO struinfo.information_entry'),
      ),
    ).toBe(false);
  });
});

function write(): Readonly<InformationEntryRestructureWrite> {
  const value = Object.freeze({
    documentOrder: 0,
    titlePath: 'Restructured Entry',
    body: 'Synthetic body.',
    bodySha256: 'a'.repeat(64),
    chunkMode: 'split' as const,
    splitRuleVersion: 'struinfo.entry-restructure.manual-range.v1',
    isPrivate: false,
    contentKeywords: Object.freeze([]),
    domains: Object.freeze([]),
    fragmentIds: Object.freeze([FRAGMENT_ID]),
  });
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    snapshotId: SNAPSHOT_ID,
    includePrivate: false,
    expectedEntries: Object.freeze([
      Object.freeze({
        entryId: PREDECESSOR_ID,
        revision: 1,
        revisionId: PREDECESSOR_REVISION_ID,
      }),
    ]),
    expectedOverrides: Object.freeze([]),
    successors: Object.freeze([
      Object.freeze({
        operation: 'insert' as const,
        row: Object.freeze({
          workspaceId: WORKSPACE_ID,
          entryId: SUCCESSOR_ID,
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          revisionId: SUCCESSOR_REVISION_ID,
          value,
        }),
        predecessorEntryIds: Object.freeze([PREDECESSOR_ID]),
        annotationStatus: 'preserved' as const,
      }),
    ]),
    retiredEntryIds: Object.freeze([PREDECESSOR_ID]),
    lineage: Object.freeze([
      Object.freeze({
        successorEntryId: SUCCESSOR_ID,
        predecessorEntryId: PREDECESSOR_ID,
        kind: 'boundary_from' as const,
      }),
    ]),
    overrideTransfers: Object.freeze([]),
    projections: Object.freeze([]),
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

function affected(): PostgresQueryResult<Row> {
  return {rows: [], rowCount: 1};
}

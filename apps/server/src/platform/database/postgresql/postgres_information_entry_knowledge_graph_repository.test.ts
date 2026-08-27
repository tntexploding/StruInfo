import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresInformationEntryAssociationRepository,
  READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL,
  READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
} from './postgres_information_entry_association_repository.js';
import {READ_WORKSPACE_SQL} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_A = '22222222-2222-4222-8222-222222222222';
const ENTRY_B = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

describe('Postgres Information Entry knowledge graph persistence', () => {
  it('maps the three graph fields from the current override row', async () => {
    const pool = createPool((sql) =>
      sql === READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL
        ? rows({
            workspace_id: WORKSPACE_ID,
            entry_low_id: ENTRY_A,
            entry_high_id: ENTRY_B,
            current_revision: 2,
            current_revision_id: REVISION_ID,
            action: 'restore',
            manual_adjustment: 0,
            is_blocked: false,
            graph_origin: 'association',
            graph_label: '扩展自',
            graph_direction: 'low_to_high',
            graph_semantic_kind: 'supports',
            graph_verification_status: 'source_checked',
            graph_note: '已核对两端来源',
          })
        : rows(),
    );
    const repository = new PostgresInformationEntryAssociationRepository(pool);

    await expect(
      repository.loadAssociationSnapshot(WORKSPACE_ID, false),
    ).resolves.toMatchObject({
      projections: [],
      overrides: [
        {
          revision: 2,
          value: {
            action: 'restore',
            graph: {
              origin: 'association',
              label: '扩展自',
              direction: 'low_to_high',
              semanticKind: 'supports',
              verificationStatus: 'source_checked',
              note: '已核对两端来源',
            },
          },
        },
      ],
    });
    expect(READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL).toContain(
      'ORDER BY projection.entry_low_id',
    );
  });

  it('writes a user relation as owned scalar parameters on the existing pair identity', async () => {
    const statements: {sql: string; parameters?: readonly unknown[]}[] = [];
    const pool = createPool((sql, parameters) => {
      statements.push({sql, ...(parameters === undefined ? {} : {parameters})});
      if (sql === READ_WORKSPACE_SQL) return rows({workspace_id: WORKSPACE_ID});
      if (sql.includes('FROM struinfo.information_entry\n')) {
        return rows(
          {entry_id: ENTRY_A, is_private: false},
          {entry_id: ENTRY_B, is_private: false},
        );
      }
      if (sql.includes('FOR UPDATE')) return rows();
      if (
        sql.includes(
          'INSERT INTO struinfo.information_entry_association_override',
        )
      ) {
        return affected(1);
      }
      return rows();
    });
    const repository = new PostgresInformationEntryAssociationRepository(pool);

    await expect(
      repository.writeAssociationOverride({
        workspaceId: WORKSPACE_ID,
        entryLowId: ENTRY_A,
        entryHighId: ENTRY_B,
        expectedRevision: 0,
        revisionId: REVISION_ID,
        includePrivate: false,
        value: {
          action: 'enhance',
          manualAdjustment: 0,
          isBlocked: false,
          graph: {
            origin: 'user',
            label: '补充说明',
            direction: 'symmetric',
            semanticKind: 'related',
            verificationStatus: 'unreviewed',
            note: '待核对',
          },
        },
      }),
    ).resolves.toBe('applied');

    const insert = statements.find(({sql}) =>
      sql.includes(
        'INSERT INTO struinfo.information_entry_association_override',
      ),
    );
    expect(insert?.parameters).toEqual([
      WORKSPACE_ID,
      ENTRY_A,
      ENTRY_B,
      REVISION_ID,
      'enhance',
      0,
      false,
      'user',
      '补充说明',
      'symmetric',
      'related',
      'unreviewed',
      '待核对',
    ]);
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

function affected(rowCount: number): PostgresQueryResult<Row> {
  return {rows: [], rowCount};
}

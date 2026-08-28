import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {PostgresProcessingRunRepository} from './postgres_processing_run_repository.js';
import {
  ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
  READ_WORKSPACE_SQL,
} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const FRAGMENT_ID = '55555555-5555-4555-8555-555555555555';

describe('PostgresProcessingRunRepository', () => {
  it('loads recent runs with typed proposals and exact Fragment evidence', async () => {
    const pool = createPool((sql) => {
      if (
        sql.includes('FROM struinfo.processing_run') &&
        sql.includes('LIMIT $2')
      ) {
        return rows({
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          idempotency_key: 'synthetic-run',
          origin: 'deterministic',
          provider_key: null,
          status: 'running',
          target_snapshot_id: null,
          privacy_scope: 'public_only',
          current_stage: 'tags',
          current_step: '生成标签提案',
          completed_units: 1,
          total_units: 3,
          attempt: 1,
          current_version: 2,
          error_code: null,
          created_at: '2040-01-02T03:04:05.000Z',
          started_at: '2040-01-02T03:04:06.000Z',
          finished_at: null,
          updated_at: '2040-01-02T03:04:07.000Z',
        });
      }
      if (sql.includes('FROM struinfo.processing_proposal_fragment_input')) {
        return rows({
          proposal_id: PROPOSAL_ID,
          input_ordinal: 0,
          fragment_id: FRAGMENT_ID,
        });
      }
      if (sql.includes('FROM struinfo.processing_proposal')) {
        return rows({
          workspace_id: WORKSPACE_ID,
          proposal_id: PROPOSAL_ID,
          run_id: RUN_ID,
          proposal_ordinal: 0,
          stage: 'tags',
          proposal_kind: 'tags',
          target_snapshot_id: null,
          target_entry_id: ENTRY_ID,
          related_entry_id: null,
          status: 'pending_review',
          summary: '建议补充标签',
          created_at: '2040-01-02T03:04:07.000Z',
          decided_at: null,
        });
      }
      return rows();
    });

    await expect(
      new PostgresProcessingRunRepository(pool).listRecentRuns(
        WORKSPACE_ID,
        20,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        runId: RUN_ID,
        origin: 'deterministic',
        status: 'running',
        proposals: [
          expect.objectContaining({
            proposalId: PROPOSAL_ID,
            kind: 'tags',
            targetEntryId: ENTRY_ID,
            fragmentIds: [FRAGMENT_ID],
          }),
        ],
      }),
    ]);
  });

  it('creates a deterministic run under the workspace lock', async () => {
    const statements: string[] = [];
    const pool = createPool((sql) => {
      statements.push(sql);
      if (sql === READ_WORKSPACE_SQL) return rows({workspace_id: WORKSPACE_ID});
      if (sql === ACQUIRE_WORKSPACE_WRITE_LOCK_SQL) return rows({});
      if (sql.includes('WHERE workspace_id = $1 AND idempotency_key = $2')) {
        return rows();
      }
      if (sql.startsWith('INSERT INTO struinfo.processing_run')) {
        return affected(1);
      }
      return rows();
    });

    await expect(
      new PostgresProcessingRunRepository(pool).createRun({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        idempotencyKey: 'synthetic-run',
        origin: 'deterministic',
        privacyScope: 'public_only',
        initialStage: 'split',
      }),
    ).resolves.toBe('applied');
    expect(statements).toContain(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL);
    expect(
      statements.some((sql) =>
        sql.startsWith('INSERT INTO struinfo.processing_run'),
      ),
    ).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
  });
});

type Row = Readonly<Record<string, unknown>>;

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

function rows(...values: readonly Row[]): PostgresQueryResult<Row> {
  return {rows: values, rowCount: values.length};
}

function affected(rowCount: number): PostgresQueryResult<Row> {
  return {rows: [], rowCount};
}

import {describe, expect, it, vi} from 'vitest';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import {
  PostgresEntryAutomationExecutionRepository,
  READ_ENTRY_AUTOMATION_CLAIMS_SQL,
  READ_ENTRY_AUTOMATION_EXECUTION_SQL,
  READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL,
} from './postgres_entry_automation_execution_repository.js';
import {
  ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
  READ_WORKSPACE_SQL,
} from './workspace_write_lock.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('PostgresEntryAutomationExecutionRepository', () => {
  it('loads the closed execution header and ordered typed claims', async () => {
    const repository = new PostgresEntryAutomationExecutionRepository(
      createPool((sql) => {
        if (sql === READ_ENTRY_AUTOMATION_EXECUTION_SQL) {
          return rows(executionRow('running', 2));
        }
        if (sql === READ_ENTRY_AUTOMATION_CLAIMS_SQL) {
          return rows(claimRow('claimed'));
        }
        return rows();
      }),
    );

    await expect(
      repository.loadExecution(WORKSPACE_ID, RUN_ID),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      idempotencyKey: 'synthetic-automation',
      requestSha256: SHA_A,
      planSha256: SHA_B,
      policyRevision: 4,
      profileRevision: 2,
      includePrivate: false,
      status: 'running',
      version: 2,
      claims: [
        expect.objectContaining({
          ordinal: 0,
          entryId: ENTRY_ID,
          entryRevision: 1,
          entryRevisionId: REVISION_ID,
          route: 'advance_candidate',
          reason: 'advance_threshold_met',
          status: 'claimed',
        }),
      ],
    });
  });

  it('initializes run, typed header and claims atomically under workspace lock', async () => {
    const statements: string[] = [];
    const repository = new PostgresEntryAutomationExecutionRepository(
      createPool((sql) => {
        statements.push(sql);
        if (sql === READ_WORKSPACE_SQL)
          return rows({workspace_id: WORKSPACE_ID});
        if (sql === ACQUIRE_WORKSPACE_WRITE_LOCK_SQL) return rows({});
        if (
          sql.includes('WHERE r.workspace_id = $1 AND r.idempotency_key = $2')
        ) {
          return rows();
        }
        if (sql.includes('FROM struinfo.information_entry')) {
          return rows({
            entry_id: ENTRY_ID,
            current_revision: 1,
            current_revision_id: REVISION_ID,
          });
        }
        if (sql.startsWith('INSERT INTO')) return affected(1);
        return rows();
      }),
    );

    await expect(repository.initializeExecution(initialize())).resolves.toBe(
      'applied',
    );
    expect(statements).toContain(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL);
    expect(
      statements.some((sql) =>
        sql.startsWith('INSERT INTO struinfo.processing_entry_automation_run'),
      ),
    ).toBe(true);
    expect(
      statements.some((sql) =>
        sql.startsWith(
          'INSERT INTO struinfo.processing_entry_automation_claim',
        ),
      ),
    ).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('completes claims and the ProcessingRun in one transaction after revision fencing', async () => {
    const statements: string[] = [];
    const repository = new PostgresEntryAutomationExecutionRepository(
      createPool((sql) => {
        statements.push(sql);
        if (sql === READ_WORKSPACE_SQL)
          return rows({workspace_id: WORKSPACE_ID});
        if (sql === ACQUIRE_WORKSPACE_WRITE_LOCK_SQL) return rows({});
        if (sql.includes('FOR UPDATE')) {
          return rows({status: 'running', current_version: 2});
        }
        if (sql === READ_ENTRY_AUTOMATION_CLAIMS_SQL) {
          return rows(claimRow('claimed'));
        }
        if (sql.includes('FROM struinfo.information_entry')) {
          return rows({
            entry_id: ENTRY_ID,
            current_revision: 1,
            current_revision_id: REVISION_ID,
          });
        }
        if (sql.startsWith('UPDATE struinfo.')) return affected(1);
        if (
          sql.startsWith(
            'INSERT INTO struinfo.processing_entry_automation_work_item',
          )
        ) {
          return affected(1);
        }
        return rows();
      }),
    );

    await expect(
      repository.settleExecution({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        expectedVersion: 2,
        status: 'succeeded',
      }),
    ).resolves.toBe('applied');
    expect(statements.some((sql) => sql.includes("status = 'completed'"))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.includes("status = 'succeeded'"))).toBe(
      true,
    );
    expect(
      statements.some((sql) =>
        sql.startsWith(
          'INSERT INTO struinfo.processing_entry_automation_work_item',
        ),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (sql) =>
          sql.includes("state = 'cancelled'") &&
          sql.includes('processing_entry_automation_action'),
      ),
    ).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('cancels only pending automatic actions when routing fails', async () => {
    const statements: string[] = [];
    const repository = new PostgresEntryAutomationExecutionRepository(
      createPool((sql) => {
        statements.push(sql);
        if (sql === READ_WORKSPACE_SQL)
          return rows({workspace_id: WORKSPACE_ID});
        if (sql === ACQUIRE_WORKSPACE_WRITE_LOCK_SQL) return rows({});
        if (sql.includes('FOR UPDATE')) {
          return rows({status: 'running', current_version: 2});
        }
        if (sql === READ_ENTRY_AUTOMATION_CLAIMS_SQL) {
          return rows(claimRow('claimed'));
        }
        if (sql.startsWith('UPDATE struinfo.')) return affected(1);
        return rows();
      }),
    );

    await expect(
      repository.settleExecution({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        expectedVersion: 2,
        status: 'failed',
        errorCode: 'automation_execution_failed',
      }),
    ).resolves.toBe('applied');
    expect(
      statements.some(
        (sql) =>
          sql.includes("state = 'cancelled'") &&
          sql.includes('processing_entry_automation_action'),
      ),
    ).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('loads queue rows and updates only owner state under the workspace lock', async () => {
    const statements: string[] = [];
    const repository = new PostgresEntryAutomationExecutionRepository(
      createPool((sql) => {
        statements.push(sql);
        if (sql === READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL) {
          return rows(workItemRow('pending', 1));
        }
        if (sql === READ_WORKSPACE_SQL)
          return rows({workspace_id: WORKSPACE_ID});
        if (sql === ACQUIRE_WORKSPACE_WRITE_LOCK_SQL) return rows({});
        if (sql.includes('FOR UPDATE')) {
          return rows({state: 'pending', current_version: 1});
        }
        if (sql.startsWith('UPDATE struinfo.')) return affected(1);
        return rows();
      }),
    );

    await expect(repository.listWorkItems(WORKSPACE_ID, 10)).resolves.toEqual([
      expect.objectContaining({
        entryId: ENTRY_ID,
        state: 'pending',
        version: 1,
      }),
    ]);
    await expect(
      repository.updateWorkItem(WORKSPACE_ID, RUN_ID, 0, 1, 'completed'),
    ).resolves.toBe('applied');
    expect(statements).toContain(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL);
    expect(statements.at(-1)).toBe('COMMIT');
  });
});

function initialize() {
  return {
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    idempotencyKey: 'synthetic-automation',
    requestSha256: SHA_A,
    planSha256: SHA_B,
    policyRevision: 4,
    profileRevision: 2,
    includePrivate: false,
    claims: [
      {
        ordinal: 0,
        entryId: ENTRY_ID,
        entryRevision: 1,
        entryRevisionId: REVISION_ID,
        route: 'advance_candidate' as const,
        reason: 'advance_threshold_met' as const,
      },
    ],
  };
}

function executionRow(status: string, version: number): Row {
  return {
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
    idempotency_key: 'synthetic-automation',
    origin: 'deterministic',
    provider_key: null,
    status,
    target_snapshot_id: null,
    privacy_scope: 'public_only',
    current_stage: 'tags',
    current_version: version,
    error_code: null,
    request_sha256: SHA_A,
    plan_sha256: SHA_B,
    policy_revision: '4',
    profile_revision: '2',
  };
}

function claimRow(status: string): Row {
  return {
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
    claim_ordinal: 0,
    entry_id: ENTRY_ID,
    entry_revision: 1,
    entry_revision_id: REVISION_ID,
    route: 'advance_candidate',
    reason: 'advance_threshold_met',
    status,
    error_code: null,
    created_at: '2040-01-02T03:04:05.000Z',
    finished_at: null,
  };
}

function workItemRow(state: string, version: number): Row {
  return {
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
    claim_ordinal: 0,
    entry_id: ENTRY_ID,
    entry_revision: 1,
    entry_revision_id: REVISION_ID,
    route: 'advance_candidate',
    reason: 'advance_threshold_met',
    state,
    current_version: version,
    created_at: '2040-01-02T03:04:05.000Z',
    updated_at: '2040-01-02T03:04:05.000Z',
    resolved_at: null,
  };
}

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

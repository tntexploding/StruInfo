import {
  ENTRY_AUTOMATION_CLAIM_STATUSES,
  ENTRY_AUTOMATION_WORK_ITEM_STATES,
  PROCESSING_RUN_STATUSES,
  type EntryAutomationClaim,
  type EntryAutomationClaimInput,
  type EntryAutomationExecution,
  type EntryAutomationExecutionInitialize,
  type EntryAutomationExecutionRepositoryPort,
  type EntryAutomationExecutionSettle,
  type EntryAutomationWorkItem,
  type EntryAutomationWorkItemState,
  type EntryAutomationWorkQueueRepositoryPort,
  type ProcessingRunWriteOutcome,
} from '../../../modules/processing/index.js';
import {
  INFORMATION_ENTRY_AUTOMATION_REASONS,
  INFORMATION_ENTRY_AUTOMATION_ROUTES,
} from '../../../modules/entries/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

export const READ_ENTRY_AUTOMATION_EXECUTION_SQL = sql(
  'SELECT r.workspace_id::text, r.run_id::text, r.idempotency_key,',
  '  r.origin, r.provider_key, r.status, r.target_snapshot_id::text,',
  '  r.privacy_scope, r.current_stage, r.current_version, r.error_code,',
  '  a.request_sha256, a.plan_sha256, a.policy_revision, a.profile_revision',
  'FROM struinfo.processing_run AS r',
  'JOIN struinfo.processing_entry_automation_run AS a',
  '  ON a.workspace_id = r.workspace_id AND a.run_id = r.run_id',
  'WHERE r.workspace_id = $1 AND r.run_id = $2',
);

export const READ_ENTRY_AUTOMATION_EXECUTION_BY_KEY_SQL = sql(
  'SELECT r.workspace_id::text, r.run_id::text, r.idempotency_key,',
  '  r.origin, r.provider_key, r.status, r.target_snapshot_id::text,',
  '  r.privacy_scope, r.current_stage, r.current_version, r.error_code,',
  '  a.request_sha256, a.plan_sha256, a.policy_revision, a.profile_revision',
  'FROM struinfo.processing_run AS r',
  'LEFT JOIN struinfo.processing_entry_automation_run AS a',
  '  ON a.workspace_id = r.workspace_id AND a.run_id = r.run_id',
  'WHERE r.workspace_id = $1 AND r.idempotency_key = $2',
);

export const READ_ENTRY_AUTOMATION_CLAIMS_SQL = sql(
  'SELECT workspace_id::text, run_id::text, claim_ordinal, entry_id::text,',
  '  entry_revision, entry_revision_id::text, route, reason, status,',
  '  error_code, created_at, finished_at',
  'FROM struinfo.processing_entry_automation_claim',
  'WHERE workspace_id = $1 AND run_id = $2',
  'ORDER BY claim_ordinal',
);

const READ_CURRENT_ENTRY_REVISIONS_SQL = sql(
  'SELECT entry_id::text, current_revision, current_revision_id::text',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND entry_id = ANY($2::uuid[])',
  'ORDER BY entry_id',
);

export const READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL = sql(
  'SELECT work.workspace_id::text, work.run_id::text, work.claim_ordinal,',
  '  claim.entry_id::text, claim.entry_revision,',
  '  claim.entry_revision_id::text, claim.route, claim.reason,',
  '  work.state, work.current_version, work.created_at, work.updated_at,',
  '  work.resolved_at',
  'FROM struinfo.processing_entry_automation_work_item AS work',
  'JOIN struinfo.processing_entry_automation_claim AS claim',
  '  ON claim.workspace_id = work.workspace_id',
  '  AND claim.run_id = work.run_id',
  '  AND claim.claim_ordinal = work.claim_ordinal',
  'WHERE work.workspace_id = $1',
  "ORDER BY CASE work.state WHEN 'pending' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,",
  '  work.updated_at DESC, work.run_id, work.claim_ordinal',
  'LIMIT $2',
);

const READ_ENTRY_AUTOMATION_WORK_ITEM_SQL = sql(
  'SELECT work.workspace_id::text, work.run_id::text, work.claim_ordinal,',
  '  claim.entry_id::text, claim.entry_revision,',
  '  claim.entry_revision_id::text, claim.route, claim.reason,',
  '  work.state, work.current_version, work.created_at, work.updated_at,',
  '  work.resolved_at',
  'FROM struinfo.processing_entry_automation_work_item AS work',
  'JOIN struinfo.processing_entry_automation_claim AS claim',
  '  ON claim.workspace_id = work.workspace_id',
  '  AND claim.run_id = work.run_id',
  '  AND claim.claim_ordinal = work.claim_ordinal',
  'WHERE work.workspace_id = $1 AND work.run_id = $2',
  '  AND work.claim_ordinal = $3',
);

const LOCK_AUTOMATION_RUN_SQL = sql(
  'SELECT status, current_version',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND run_id = $2',
  'FOR UPDATE',
);

const INSERT_AUTOMATION_RUN_SQL = sql(
  'INSERT INTO struinfo.processing_run (',
  '  workspace_id, run_id, idempotency_key, origin, provider_key,',
  '  target_snapshot_id, privacy_scope, current_stage, current_step, status',
  ") VALUES ($1, $2, $3, 'deterministic', NULL, NULL, $4, 'tags',",
  "  'automation_claimed', 'queued')",
);

const INSERT_AUTOMATION_HEADER_SQL = sql(
  'INSERT INTO struinfo.processing_entry_automation_run (',
  '  workspace_id, run_id, request_sha256, plan_sha256,',
  '  policy_revision, profile_revision',
  ') VALUES ($1, $2, $3, $4, $5, $6)',
);

const INSERT_AUTOMATION_CLAIM_SQL = sql(
  'INSERT INTO struinfo.processing_entry_automation_claim (',
  '  workspace_id, run_id, claim_ordinal, entry_id, entry_revision,',
  '  entry_revision_id, route, reason',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
);

const START_AUTOMATION_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'running', current_step = 'automation_routing',",
  '  total_units = $4, current_version = current_version + 1,',
  '  started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND current_version = $3',
);

const COMPLETE_AUTOMATION_CLAIMS_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_claim SET',
  "  status = 'completed', error_code = NULL, finished_at = CURRENT_TIMESTAMP",
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'claimed'",
);

const INSERT_AUTOMATION_WORK_ITEMS_SQL = sql(
  'INSERT INTO struinfo.processing_entry_automation_work_item (',
  '  workspace_id, run_id, claim_ordinal',
  ') SELECT workspace_id, run_id, claim_ordinal',
  'FROM struinfo.processing_entry_automation_claim',
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'completed'",
);

const LOCK_AUTOMATION_WORK_ITEM_SQL = sql(
  'SELECT state, current_version',
  'FROM struinfo.processing_entry_automation_work_item',
  'WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  'FOR UPDATE',
);

const UPDATE_AUTOMATION_WORK_ITEM_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_work_item SET',
  '  state = $5, current_version = current_version + 1,',
  '  updated_at = CURRENT_TIMESTAMP,',
  "  resolved_at = CASE WHEN $5 = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END",
  'WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  '  AND current_version = $4',
);

const COMPENSATE_AUTOMATION_CLAIMS_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_claim SET',
  "  status = 'compensated', error_code = $3, finished_at = CURRENT_TIMESTAMP",
  "WHERE workspace_id = $1 AND run_id = $2 AND status = 'claimed'",
);

const SUCCEED_AUTOMATION_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'succeeded', current_step = 'automation_complete',",
  '  completed_units = $4, total_units = $4, error_code = NULL,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND current_version = $3',
);

const FAIL_AUTOMATION_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'failed', current_step = 'automation_compensated',",
  '  completed_units = 0, total_units = $4, error_code = $5,',
  '  current_version = current_version + 1, finished_at = CURRENT_TIMESTAMP,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND current_version = $3',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresEntryAutomationExecutionRepository
  implements
    EntryAutomationExecutionRepositoryPort,
    EntryAutomationWorkQueueRepositoryPort
{
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public loadExecution(
    workspaceIdInput: string,
    runIdInput: string,
  ): Promise<Readonly<EntryAutomationExecution> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => loadExecution(client, workspaceId, runId),
    );
  }

  public initializeExecution(
    initialize: Readonly<EntryAutomationExecutionInitialize>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertInitialize(initialize);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, initialize.workspaceId);
        const existingRows = await client.query<Row>(
          READ_ENTRY_AUTOMATION_EXECUTION_BY_KEY_SQL,
          [initialize.workspaceId, initialize.idempotencyKey],
        );
        if (existingRows.rows.length > 1) throw new PostgresAdapterError();
        const existing = existingRows.rows[0];
        if (existing !== undefined) {
          if (existing.request_sha256 === null) return 'conflict';
          const claims = await readClaims(
            client,
            initialize.workspaceId,
            canonicalUuid(existing.run_id),
          );
          return sameInitialization(existing, claims, initialize)
            ? 'unchanged'
            : 'conflict';
        }
        await assertCurrentEntries(
          client,
          initialize.workspaceId,
          initialize.claims,
        );
        expectOneAffected(
          (
            await client.query<Row>(INSERT_AUTOMATION_RUN_SQL, [
              initialize.workspaceId,
              initialize.runId,
              initialize.idempotencyKey,
              initialize.includePrivate ? 'include_private' : 'public_only',
            ])
          ).rowCount,
        );
        expectOneAffected(
          (
            await client.query<Row>(INSERT_AUTOMATION_HEADER_SQL, [
              initialize.workspaceId,
              initialize.runId,
              initialize.requestSha256,
              initialize.planSha256,
              initialize.policyRevision,
              initialize.profileRevision,
            ])
          ).rowCount,
        );
        for (const claim of initialize.claims) {
          expectOneAffected(
            (
              await client.query<Row>(INSERT_AUTOMATION_CLAIM_SQL, [
                initialize.workspaceId,
                initialize.runId,
                claim.ordinal,
                claim.entryId,
                claim.entryRevision,
                claim.entryRevisionId,
                claim.route,
                claim.reason,
              ])
            ).rowCount,
          );
        }
        return 'applied';
      },
    );
  }

  public startExecution(
    workspaceIdInput: string,
    runIdInput: string,
    expectedVersionInput: number,
  ): Promise<ProcessingRunWriteOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    const expectedVersion = integer(expectedVersionInput, 1);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await lockRun(client, workspaceId, runId);
        if (locked === undefined) return 'not_found';
        const status = enumValue(locked.status, PROCESSING_RUN_STATUSES);
        if (status === 'running') return 'unchanged';
        if (status !== 'queued') return 'terminal';
        if (integer(locked.current_version, 1) !== expectedVersion)
          return 'stale';
        const claims = await readClaims(client, workspaceId, runId);
        if (claims.length === 0) throw new PostgresAdapterError();
        await assertCurrentEntries(client, workspaceId, claims);
        expectOneAffected(
          (
            await client.query<Row>(START_AUTOMATION_RUN_SQL, [
              workspaceId,
              runId,
              expectedVersion,
              claims.length,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }

  public settleExecution(
    settle: Readonly<EntryAutomationExecutionSettle>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertSettle(settle);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, settle.workspaceId);
        const locked = await lockRun(client, settle.workspaceId, settle.runId);
        if (locked === undefined) return 'not_found';
        const status = enumValue(locked.status, PROCESSING_RUN_STATUSES);
        if (status === settle.status) return 'unchanged';
        if (
          status === 'succeeded' ||
          status === 'failed' ||
          status === 'cancelled'
        ) {
          return 'terminal';
        }
        if (integer(locked.current_version, 1) !== settle.expectedVersion) {
          return 'stale';
        }
        if (settle.status === 'succeeded' && status !== 'running') {
          return 'terminal';
        }
        const claims = await readClaims(
          client,
          settle.workspaceId,
          settle.runId,
        );
        if (
          claims.length === 0 ||
          claims.some((claim) => claim.status !== 'claimed')
        ) {
          throw new PostgresAdapterError();
        }
        if (settle.status === 'succeeded') {
          await assertCurrentEntries(client, settle.workspaceId, claims);
          if (
            (
              await client.query<Row>(COMPLETE_AUTOMATION_CLAIMS_SQL, [
                settle.workspaceId,
                settle.runId,
              ])
            ).rowCount !== claims.length
          ) {
            throw new PostgresAdapterError();
          }
          if (
            (
              await client.query<Row>(INSERT_AUTOMATION_WORK_ITEMS_SQL, [
                settle.workspaceId,
                settle.runId,
              ])
            ).rowCount !== claims.length
          ) {
            throw new PostgresAdapterError();
          }
          expectOneAffected(
            (
              await client.query<Row>(SUCCEED_AUTOMATION_RUN_SQL, [
                settle.workspaceId,
                settle.runId,
                settle.expectedVersion,
                claims.length,
              ])
            ).rowCount,
          );
        } else {
          const errorCode = settle.errorCode;
          if (errorCode === undefined) throw new PostgresAdapterError();
          if (
            (
              await client.query<Row>(COMPENSATE_AUTOMATION_CLAIMS_SQL, [
                settle.workspaceId,
                settle.runId,
                errorCode,
              ])
            ).rowCount !== claims.length
          ) {
            throw new PostgresAdapterError();
          }
          expectOneAffected(
            (
              await client.query<Row>(FAIL_AUTOMATION_RUN_SQL, [
                settle.workspaceId,
                settle.runId,
                settle.expectedVersion,
                claims.length,
                errorCode,
              ])
            ).rowCount,
          );
        }
        return 'applied';
      },
    );
  }

  public listWorkItems(
    workspaceIdInput: string,
    maximumInput: number,
  ): Promise<readonly Readonly<EntryAutomationWorkItem>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const maximum = integer(maximumInput, 1);
    if (maximum > 500) throw new PostgresAdapterError();
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL,
          [workspaceId, maximum],
        );
        return Object.freeze(result.rows.map(mapWorkItem));
      },
    );
  }

  public loadWorkItem(
    workspaceIdInput: string,
    runIdInput: string,
    claimOrdinalInput: number,
  ): Promise<Readonly<EntryAutomationWorkItem> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    const claimOrdinal = integer(claimOrdinalInput, 0);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_ENTRY_AUTOMATION_WORK_ITEM_SQL,
          [workspaceId, runId, claimOrdinal],
        );
        if (result.rows.length > 1) throw new PostgresAdapterError();
        return result.rows[0] === undefined
          ? undefined
          : mapWorkItem(result.rows[0]);
      },
    );
  }

  public updateWorkItem(
    workspaceIdInput: string,
    runIdInput: string,
    claimOrdinalInput: number,
    expectedVersionInput: number,
    stateInput: EntryAutomationWorkItemState,
  ): Promise<ProcessingRunWriteOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    const claimOrdinal = integer(claimOrdinalInput, 0);
    const expectedVersion = integer(expectedVersionInput, 1);
    const state = enumValue(stateInput, ENTRY_AUTOMATION_WORK_ITEM_STATES);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(LOCK_AUTOMATION_WORK_ITEM_SQL, [
          workspaceId,
          runId,
          claimOrdinal,
        ]);
        if (locked.rows.length > 1) throw new PostgresAdapterError();
        const row = locked.rows[0];
        if (row === undefined) return 'not_found';
        if (integer(row.current_version, 1) !== expectedVersion) return 'stale';
        if (enumValue(row.state, ENTRY_AUTOMATION_WORK_ITEM_STATES) === state) {
          return 'unchanged';
        }
        expectOneAffected(
          (
            await client.query<Row>(UPDATE_AUTOMATION_WORK_ITEM_SQL, [
              workspaceId,
              runId,
              claimOrdinal,
              expectedVersion,
              state,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }
}

async function loadExecution(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
): Promise<Readonly<EntryAutomationExecution> | undefined> {
  const result = await client.query<Row>(READ_ENTRY_AUTOMATION_EXECUTION_SQL, [
    workspaceId,
    runId,
  ]);
  if (result.rows.length === 0) return undefined;
  if (result.rows.length !== 1 || result.rows[0] === undefined) {
    throw new PostgresAdapterError();
  }
  return mapExecution(
    result.rows[0],
    await readClaims(client, workspaceId, runId),
  );
}

async function readClaims(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
): Promise<readonly Readonly<EntryAutomationClaim>[]> {
  const result = await client.query<Row>(READ_ENTRY_AUTOMATION_CLAIMS_SQL, [
    workspaceId,
    runId,
  ]);
  return Object.freeze(
    result.rows.map((row, index) => {
      if (integer(row.claim_ordinal) !== index)
        throw new PostgresAdapterError();
      const errorCode = optionalText(row.error_code);
      const finishedAt = optionalTimestamp(row.finished_at);
      return Object.freeze({
        workspaceId: canonicalUuid(row.workspace_id),
        runId: canonicalUuid(row.run_id),
        ordinal: index,
        entryId: canonicalUuid(row.entry_id),
        entryRevision: integer(row.entry_revision, 1),
        entryRevisionId: canonicalUuid(row.entry_revision_id),
        route: enumValue(row.route, INFORMATION_ENTRY_AUTOMATION_ROUTES),
        reason: enumValue(row.reason, INFORMATION_ENTRY_AUTOMATION_REASONS),
        status: enumValue(row.status, ENTRY_AUTOMATION_CLAIM_STATUSES),
        ...(errorCode === undefined ? {} : {errorCode}),
        createdAt: timestamp(row.created_at),
        ...(finishedAt === undefined ? {} : {finishedAt}),
      });
    }),
  );
}

function mapExecution(
  row: Row,
  claims: readonly Readonly<EntryAutomationClaim>[],
): Readonly<EntryAutomationExecution> {
  if (
    row.origin !== 'deterministic' ||
    row.provider_key !== null ||
    row.target_snapshot_id !== null ||
    row.current_stage !== 'tags' ||
    (row.privacy_scope !== 'public_only' &&
      row.privacy_scope !== 'include_private')
  ) {
    throw new PostgresAdapterError();
  }
  const errorCode = optionalText(row.error_code);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    runId: canonicalUuid(row.run_id),
    idempotencyKey: text(row.idempotency_key),
    requestSha256: sha256(row.request_sha256),
    planSha256: sha256(row.plan_sha256),
    policyRevision: safeNonNegativeInteger(row.policy_revision),
    profileRevision: safeNonNegativeInteger(row.profile_revision),
    includePrivate: row.privacy_scope === 'include_private',
    status: enumValue(row.status, PROCESSING_RUN_STATUSES),
    version: integer(row.current_version, 1),
    ...(errorCode === undefined ? {} : {errorCode}),
    claims,
  });
}

function mapWorkItem(row: Row): Readonly<EntryAutomationWorkItem> {
  const resolvedAt = optionalTimestamp(row.resolved_at);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    runId: canonicalUuid(row.run_id),
    claimOrdinal: integer(row.claim_ordinal, 0),
    entryId: canonicalUuid(row.entry_id),
    entryRevision: integer(row.entry_revision, 1),
    entryRevisionId: canonicalUuid(row.entry_revision_id),
    route: enumValue(row.route, INFORMATION_ENTRY_AUTOMATION_ROUTES),
    reason: enumValue(row.reason, INFORMATION_ENTRY_AUTOMATION_REASONS),
    state: enumValue(row.state, ENTRY_AUTOMATION_WORK_ITEM_STATES),
    version: integer(row.current_version, 1),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    ...(resolvedAt === undefined ? {} : {resolvedAt}),
  });
}

async function lockRun(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
): Promise<Row | undefined> {
  const locked = await client.query<Row>(LOCK_AUTOMATION_RUN_SQL, [
    workspaceId,
    runId,
  ]);
  if (locked.rows.length > 1) throw new PostgresAdapterError();
  return locked.rows[0];
}

async function assertCurrentEntries(
  client: PostgresClientBoundary,
  workspaceId: string,
  claims: readonly Readonly<EntryAutomationClaimInput>[],
): Promise<void> {
  const result = await client.query<Row>(READ_CURRENT_ENTRY_REVISIONS_SQL, [
    workspaceId,
    claims.map((claim) => claim.entryId),
  ]);
  if (result.rows.length !== claims.length) throw new PostgresAdapterError();
  const current = new Map(
    result.rows.map((row) => [canonicalUuid(row.entry_id), row]),
  );
  for (const claim of claims) {
    const row = current.get(claim.entryId);
    if (
      row === undefined ||
      integer(row.current_revision, 1) !== claim.entryRevision ||
      canonicalUuid(row.current_revision_id) !== claim.entryRevisionId
    ) {
      throw new PostgresAdapterError();
    }
  }
}

function assertInitialize(
  value: Readonly<EntryAutomationExecutionInitialize>,
): void {
  canonicalUuid(value.workspaceId);
  canonicalUuid(value.runId);
  boundedText(value.idempotencyKey, 200);
  sha256(value.requestSha256);
  sha256(value.planSha256);
  safeNonNegativeInteger(value.policyRevision);
  safeNonNegativeInteger(value.profileRevision);
  if (typeof value.includePrivate !== 'boolean')
    throw new PostgresAdapterError();
  if (value.claims.length < 1 || value.claims.length > 100) {
    throw new PostgresAdapterError();
  }
  const entryIds = new Set<string>();
  for (const [ordinal, claim] of value.claims.entries()) {
    if (claim.ordinal !== ordinal) throw new PostgresAdapterError();
    canonicalUuid(claim.entryId);
    canonicalUuid(claim.entryRevisionId);
    integer(claim.entryRevision, 1);
    enumValue(claim.route, INFORMATION_ENTRY_AUTOMATION_ROUTES);
    enumValue(claim.reason, INFORMATION_ENTRY_AUTOMATION_REASONS);
    if (entryIds.has(claim.entryId) || !validRouteReason(claim)) {
      throw new PostgresAdapterError();
    }
    entryIds.add(claim.entryId);
  }
}

function assertSettle(value: Readonly<EntryAutomationExecutionSettle>): void {
  canonicalUuid(value.workspaceId);
  canonicalUuid(value.runId);
  integer(value.expectedVersion, 1);
  if (value.status === 'succeeded') {
    if (value.errorCode !== undefined) throw new PostgresAdapterError();
    return;
  }
  if (
    value.errorCode !== 'automation_revalidation_failed' &&
    value.errorCode !== 'automation_execution_failed'
  ) {
    throw new PostgresAdapterError();
  }
}

function sameInitialization(
  row: Row,
  claims: readonly Readonly<EntryAutomationClaim>[],
  initialize: Readonly<EntryAutomationExecutionInitialize>,
): boolean {
  return (
    row.workspace_id === initialize.workspaceId &&
    row.run_id === initialize.runId &&
    row.idempotency_key === initialize.idempotencyKey &&
    row.origin === 'deterministic' &&
    row.provider_key === null &&
    row.target_snapshot_id === null &&
    row.current_stage === 'tags' &&
    row.privacy_scope ===
      (initialize.includePrivate ? 'include_private' : 'public_only') &&
    row.request_sha256 === initialize.requestSha256 &&
    row.plan_sha256 === initialize.planSha256 &&
    safeNonNegativeInteger(row.policy_revision) === initialize.policyRevision &&
    safeNonNegativeInteger(row.profile_revision) ===
      initialize.profileRevision &&
    claims.length === initialize.claims.length &&
    claims.every((claim, index) => sameClaim(claim, initialize.claims[index]))
  );
}

function sameClaim(
  left: Readonly<EntryAutomationClaimInput>,
  right: Readonly<EntryAutomationClaimInput> | undefined,
): boolean {
  return (
    right?.ordinal === left.ordinal &&
    left.entryId === right.entryId &&
    left.entryRevision === right.entryRevision &&
    left.entryRevisionId === right.entryRevisionId &&
    left.route === right.route &&
    left.reason === right.reason
  );
}

function validRouteReason(claim: Readonly<EntryAutomationClaimInput>): boolean {
  if (claim.route === 'advance_candidate') {
    return claim.reason === 'advance_threshold_met';
  }
  if (claim.route === 'defer_candidate') {
    return claim.reason === 'defer_threshold_met';
  }
  return (
    claim.reason !== 'advance_threshold_met' &&
    claim.reason !== 'defer_threshold_met'
  );
}

function boundedText(value: unknown, maximum: number): string {
  const result = text(value);
  if (
    result.trim() !== result ||
    result.length === 0 ||
    Array.from(result).length > maximum ||
    containsControlCharacter(result)
  ) {
    throw new PostgresAdapterError();
  }
  return result;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function safeNonNegativeInteger(value: unknown): number {
  const parsed =
    typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new PostgresAdapterError();
  }
  return parsed;
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(date.getTime())) throw new PostgresAdapterError();
  return date.toISOString();
}

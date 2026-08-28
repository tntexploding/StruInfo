import {
  PROCESSING_PRIVACY_SCOPES,
  PROCESSING_PROPOSAL_KINDS,
  PROCESSING_PROPOSAL_STATUSES,
  PROCESSING_RUN_ORIGINS,
  PROCESSING_RUN_STATUSES,
  PROCESSING_STAGES,
  assertProcessingProposalAppend,
  assertProcessingRunCreate,
  assertProcessingRunProgress,
  canTransitionProcessingRun,
  type ProcessingProposal,
  type ProcessingProposalAppend,
  type ProcessingRun,
  type ProcessingRunCreate,
  type ProcessingRunProgressWrite,
  type ProcessingRunRepositoryPort,
  type ProcessingRunWriteOutcome,
} from '../../../modules/processing/index.js';

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
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

const READ_RECENT_RUNS_SQL = sql(
  'SELECT workspace_id::text, run_id::text, idempotency_key, origin,',
  '  provider_key, status, target_snapshot_id::text, privacy_scope,',
  '  current_stage, current_step, completed_units, total_units, attempt,',
  '  current_version, error_code, created_at, started_at, finished_at, updated_at',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1',
  'ORDER BY created_at DESC, run_id DESC',
  'LIMIT $2',
);

const READ_RUN_PROPOSALS_SQL = sql(
  'SELECT workspace_id::text, proposal_id::text, run_id::text,',
  '  proposal_ordinal, stage, proposal_kind, target_snapshot_id::text,',
  '  target_entry_id::text, related_entry_id::text, status, summary,',
  '  created_at, decided_at',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND run_id = ANY($2::uuid[])',
  'ORDER BY run_id, proposal_ordinal',
);

const READ_PROPOSAL_INPUTS_SQL = sql(
  'SELECT proposal_id::text, input_ordinal, fragment_id::text',
  'FROM struinfo.processing_proposal_fragment_input',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, input_ordinal',
);

const READ_RUN_BY_IDEMPOTENCY_KEY_SQL = sql(
  'SELECT run_id::text, idempotency_key, origin, provider_key,',
  '  target_snapshot_id::text, privacy_scope, current_stage, current_step',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND idempotency_key = $2',
);

const INSERT_RUN_SQL = sql(
  'INSERT INTO struinfo.processing_run (',
  '  workspace_id, run_id, idempotency_key, origin, provider_key,',
  '  target_snapshot_id, privacy_scope, current_stage, current_step, status',
  ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')",
);

const LOCK_RUN_SQL = sql(
  'SELECT status, current_version, current_stage, current_step,',
  '  completed_units, total_units, error_code',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND run_id = $2',
  'FOR UPDATE',
);

const UPDATE_RUN_PROGRESS_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  '  status = $4, current_stage = $5, current_step = $6,',
  '  completed_units = $7, total_units = $8, error_code = $9,',
  '  current_version = current_version + 1,',
  "  started_at = CASE WHEN status = 'queued' AND $4 = 'running' THEN CURRENT_TIMESTAMP ELSE started_at END,",
  "  finished_at = CASE WHEN $4 IN ('succeeded', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END,",
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND current_version = $3',
);

const CANCEL_RUN_SQL = sql(
  'UPDATE struinfo.processing_run SET',
  "  status = 'cancelled', current_version = current_version + 1,",
  '  finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND current_version = $3',
);

const READ_PROPOSAL_BY_ORDINAL_SQL = sql(
  'SELECT proposal_id::text, stage, proposal_kind, target_snapshot_id::text,',
  '  target_entry_id::text, related_entry_id::text, summary',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND run_id = $2 AND proposal_ordinal = $3',
);

const READ_ONE_PROPOSAL_INPUTS_SQL = sql(
  'SELECT fragment_id::text',
  'FROM struinfo.processing_proposal_fragment_input',
  'WHERE workspace_id = $1 AND proposal_id = $2',
  'ORDER BY input_ordinal',
);

const INSERT_PROPOSAL_SQL = sql(
  'INSERT INTO struinfo.processing_proposal (',
  '  workspace_id, proposal_id, run_id, proposal_ordinal, stage,',
  '  proposal_kind, target_snapshot_id, target_entry_id, related_entry_id, summary',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
);

const INSERT_PROPOSAL_INPUT_SQL = sql(
  'INSERT INTO struinfo.processing_proposal_fragment_input (',
  '  workspace_id, proposal_id, input_ordinal, fragment_id',
  ') VALUES ($1, $2, $3, $4)',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresProcessingRunRepository implements ProcessingRunRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public listRecentRuns(
    workspaceIdInput: string,
    limitInput: number,
  ): Promise<readonly Readonly<ProcessingRun>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    if (
      !Number.isSafeInteger(limitInput) ||
      limitInput < 1 ||
      limitInput > 100
    ) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const runRows = await client.query<Row>(READ_RECENT_RUNS_SQL, [
          workspaceId,
          limitInput,
        ]);
        if (runRows.rows.length === 0) return Object.freeze([]);
        const runIds = runRows.rows.map((row) => canonicalUuid(row.run_id));
        const proposalRows = await client.query<Row>(READ_RUN_PROPOSALS_SQL, [
          workspaceId,
          runIds,
        ]);
        const proposalIds = proposalRows.rows.map((row) =>
          canonicalUuid(row.proposal_id),
        );
        const inputRows =
          proposalIds.length === 0
            ? Object.freeze([])
            : (
                await client.query<Row>(READ_PROPOSAL_INPUTS_SQL, [
                  workspaceId,
                  proposalIds,
                ])
              ).rows;
        const fragmentsByProposal = new Map<string, string[]>();
        for (const row of inputRows) {
          const proposalId = canonicalUuid(row.proposal_id);
          const ordinal = integer(row.input_ordinal);
          const values = fragmentsByProposal.get(proposalId) ?? [];
          if (ordinal !== values.length) throw new PostgresAdapterError();
          values.push(canonicalUuid(row.fragment_id));
          fragmentsByProposal.set(proposalId, values);
        }
        const proposalsByRun = new Map<string, ProcessingProposal[]>();
        for (const row of proposalRows.rows) {
          const proposalId = canonicalUuid(row.proposal_id);
          const proposal = mapProposal(
            row,
            fragmentsByProposal.get(proposalId) ?? [],
          );
          const values = proposalsByRun.get(proposal.runId) ?? [];
          values.push(proposal);
          proposalsByRun.set(proposal.runId, values);
        }
        return Object.freeze(
          runRows.rows.map((row) => {
            const runId = canonicalUuid(row.run_id);
            return mapRun(row, proposalsByRun.get(runId) ?? []);
          }),
        );
      },
    );
  }

  public createRun(
    create: Readonly<ProcessingRunCreate>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertProcessingRunCreate(create);
    const workspaceId = canonicalUuid(create.workspaceId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const existing = await client.query<Row>(
          READ_RUN_BY_IDEMPOTENCY_KEY_SQL,
          [workspaceId, create.idempotencyKey],
        );
        if (existing.rows.length > 1) throw new PostgresAdapterError();
        if (existing.rows[0] !== undefined) {
          return sameRunCreate(existing.rows[0], create)
            ? 'unchanged'
            : 'conflict';
        }
        const inserted = await client.query<Row>(INSERT_RUN_SQL, [
          workspaceId,
          canonicalUuid(create.runId),
          create.idempotencyKey,
          create.origin,
          create.providerKey ?? null,
          create.targetSnapshotId ?? null,
          create.privacyScope,
          create.initialStage,
          create.initialStep ?? null,
        ]);
        expectOneAffected(inserted.rowCount);
        return 'applied';
      },
    );
  }

  public writeProgress(
    write: Readonly<ProcessingRunProgressWrite>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertProcessingRunProgress(write);
    return this.#updateLocked(
      write.workspaceId,
      write.runId,
      async (client, row) => {
        const version = integer(row.current_version, 1);
        if (version !== write.expectedVersion) return 'stale';
        const status = enumValue(row.status, PROCESSING_RUN_STATUSES);
        if (!canTransitionProcessingRun(status, write.status))
          return 'terminal';
        if (sameProgress(row, write)) return 'unchanged';
        const updated = await client.query<Row>(UPDATE_RUN_PROGRESS_SQL, [
          write.workspaceId,
          write.runId,
          write.expectedVersion,
          write.status,
          write.currentStage,
          write.currentStep ?? null,
          write.completedUnits,
          write.totalUnits ?? null,
          write.errorCode ?? null,
        ]);
        expectOneAffected(updated.rowCount);
        return 'applied';
      },
    );
  }

  public cancelRun(
    workspaceIdInput: string,
    runIdInput: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new PostgresAdapterError();
    }
    return this.#updateLocked(workspaceId, runId, async (client, row) => {
      if (integer(row.current_version, 1) !== expectedVersion) return 'stale';
      const status = enumValue(row.status, PROCESSING_RUN_STATUSES);
      if (!canTransitionProcessingRun(status, 'cancelled')) return 'terminal';
      const updated = await client.query<Row>(CANCEL_RUN_SQL, [
        workspaceId,
        runId,
        expectedVersion,
      ]);
      expectOneAffected(updated.rowCount);
      return 'applied';
    });
  }

  public appendProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (
      proposal.splitPayload !== undefined ||
      proposal.tagPayload !== undefined ||
      proposal.associationPayload !== undefined
    )
      throw new PostgresAdapterError();
    assertProcessingProposalAppend(proposal);
    const workspaceId = canonicalUuid(proposal.workspaceId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const run = await client.query<Row>(LOCK_RUN_SQL, [
          workspaceId,
          canonicalUuid(proposal.runId),
        ]);
        if (run.rows.length === 0) return 'not_found';
        if (run.rows.length !== 1) throw new PostgresAdapterError();
        if (run.rows[0]?.status !== 'running') return 'terminal';
        const existing = await client.query<Row>(READ_PROPOSAL_BY_ORDINAL_SQL, [
          workspaceId,
          proposal.runId,
          proposal.ordinal,
        ]);
        if (existing.rows.length > 1) throw new PostgresAdapterError();
        if (existing.rows[0] !== undefined) {
          const inputs = await client.query<Row>(READ_ONE_PROPOSAL_INPUTS_SQL, [
            workspaceId,
            existing.rows[0].proposal_id,
          ]);
          return sameProposal(existing.rows[0], inputs.rows, proposal)
            ? 'unchanged'
            : 'conflict';
        }
        const inserted = await client.query<Row>(INSERT_PROPOSAL_SQL, [
          workspaceId,
          canonicalUuid(proposal.proposalId),
          canonicalUuid(proposal.runId),
          proposal.ordinal,
          proposal.stage,
          proposal.kind,
          proposal.targetSnapshotId ?? null,
          proposal.targetEntryId ?? null,
          proposal.relatedEntryId ?? null,
          proposal.summary,
        ]);
        expectOneAffected(inserted.rowCount);
        for (const [ordinal, fragmentId] of proposal.fragmentIds.entries()) {
          const input = await client.query<Row>(INSERT_PROPOSAL_INPUT_SQL, [
            workspaceId,
            proposal.proposalId,
            ordinal,
            canonicalUuid(fragmentId),
          ]);
          expectOneAffected(input.rowCount);
        }
        return 'applied';
      },
    );
  }

  async #updateLocked(
    workspaceIdInput: string,
    runIdInput: string,
    update: (
      client: PostgresClientBoundary,
      row: Row,
    ) => Promise<ProcessingRunWriteOutcome>,
  ): Promise<ProcessingRunWriteOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const current = await client.query<Row>(LOCK_RUN_SQL, [
          workspaceId,
          runId,
        ]);
        if (current.rows.length === 0) return 'not_found';
        if (current.rows.length !== 1 || current.rows[0] === undefined) {
          throw new PostgresAdapterError();
        }
        return update(client, current.rows[0]);
      },
    );
  }
}

function mapRun(
  row: Row,
  proposals: readonly Readonly<ProcessingProposal>[],
): ProcessingRun {
  const providerKey = optionalText(row.provider_key);
  const targetSnapshotId = optionalUuid(row.target_snapshot_id);
  const currentStep = optionalText(row.current_step);
  const totalUnits = optionalInteger(row.total_units, 1);
  const errorCode = optionalText(row.error_code);
  const startedAt = optionalTimestamp(row.started_at);
  const finishedAt = optionalTimestamp(row.finished_at);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    runId: canonicalUuid(row.run_id),
    idempotencyKey: text(row.idempotency_key),
    origin: enumValue(row.origin, PROCESSING_RUN_ORIGINS),
    ...(providerKey === undefined ? {} : {providerKey}),
    status: enumValue(row.status, PROCESSING_RUN_STATUSES),
    ...(targetSnapshotId === undefined ? {} : {targetSnapshotId}),
    privacyScope: enumValue(row.privacy_scope, PROCESSING_PRIVACY_SCOPES),
    currentStage: enumValue(row.current_stage, PROCESSING_STAGES),
    ...(currentStep === undefined ? {} : {currentStep}),
    completedUnits: integer(row.completed_units),
    ...(totalUnits === undefined ? {} : {totalUnits}),
    attempt: integer(row.attempt, 1),
    version: integer(row.current_version, 1),
    ...(errorCode === undefined ? {} : {errorCode}),
    createdAt: timestamp(row.created_at),
    ...(startedAt === undefined ? {} : {startedAt}),
    ...(finishedAt === undefined ? {} : {finishedAt}),
    updatedAt: timestamp(row.updated_at),
    proposals: Object.freeze([...proposals]),
  });
}

function mapProposal(
  row: Row,
  fragmentIds: readonly string[],
): ProcessingProposal {
  const targetSnapshotId = optionalUuid(row.target_snapshot_id);
  const targetEntryId = optionalUuid(row.target_entry_id);
  const relatedEntryId = optionalUuid(row.related_entry_id);
  const decidedAt = optionalTimestamp(row.decided_at);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    proposalId: canonicalUuid(row.proposal_id),
    runId: canonicalUuid(row.run_id),
    ordinal: integer(row.proposal_ordinal),
    stage: enumValue(row.stage, ['split', 'tags', 'associations'] as const),
    kind: enumValue(row.proposal_kind, PROCESSING_PROPOSAL_KINDS),
    ...(targetSnapshotId === undefined ? {} : {targetSnapshotId}),
    ...(targetEntryId === undefined ? {} : {targetEntryId}),
    ...(relatedEntryId === undefined ? {} : {relatedEntryId}),
    status: enumValue(row.status, PROCESSING_PROPOSAL_STATUSES),
    summary: text(row.summary),
    fragmentIds: Object.freeze([...fragmentIds]),
    createdAt: timestamp(row.created_at),
    ...(decidedAt === undefined ? {} : {decidedAt}),
  });
}

function sameRunCreate(
  row: Row,
  create: Readonly<ProcessingRunCreate>,
): boolean {
  return (
    canonicalUuid(row.run_id) === create.runId &&
    row.idempotency_key === create.idempotencyKey &&
    row.origin === create.origin &&
    optionalText(row.provider_key) === create.providerKey &&
    optionalUuid(row.target_snapshot_id) === create.targetSnapshotId &&
    row.privacy_scope === create.privacyScope &&
    row.current_stage === create.initialStage &&
    optionalText(row.current_step) === create.initialStep
  );
}

function sameProgress(
  row: Row,
  write: Readonly<ProcessingRunProgressWrite>,
): boolean {
  return (
    row.status === write.status &&
    row.current_stage === write.currentStage &&
    optionalText(row.current_step) === write.currentStep &&
    integer(row.completed_units) === write.completedUnits &&
    optionalInteger(row.total_units, 1) === write.totalUnits &&
    optionalText(row.error_code) === write.errorCode
  );
}

function sameProposal(
  row: Row,
  inputRows: readonly Row[],
  proposal: Readonly<ProcessingProposalAppend>,
): boolean {
  return (
    canonicalUuid(row.proposal_id) === proposal.proposalId &&
    row.stage === proposal.stage &&
    row.proposal_kind === proposal.kind &&
    optionalUuid(row.target_snapshot_id) === proposal.targetSnapshotId &&
    optionalUuid(row.target_entry_id) === proposal.targetEntryId &&
    optionalUuid(row.related_entry_id) === proposal.relatedEntryId &&
    row.summary === proposal.summary &&
    inputRows.length === proposal.fragmentIds.length &&
    inputRows.every(
      (input, index) =>
        canonicalUuid(input.fragment_id) === proposal.fragmentIds[index],
    )
  );
}

function optionalUuid(value: unknown): string | undefined {
  return value === null ? undefined : canonicalUuid(value);
}

function optionalInteger(value: unknown, minimum: number): number | undefined {
  return value === null ? undefined : integer(value, minimum);
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(date.getTime())) throw new PostgresAdapterError();
  return date.toISOString();
}

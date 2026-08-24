import {INFORMATION_ENTRY_GRAPH_DIRECTIONS} from '../../../modules/entries/index.js';
import {
  PROCESSING_PROPOSAL_KINDS,
  PROCESSING_PROPOSAL_STATUSES,
  assertProcessingAssociationProposalPayload,
  assertProcessingProposalAppend,
  type AiAssociationProposalRepositoryPort,
  type ProcessingAssociationProposalPayload,
  type ProcessingProposal,
  type ProcessingProposalAppend,
  type ProcessingProposalDecision,
  type ProcessingProposalDecisionOutcome,
  type ProcessingRun,
  type ProcessingRunCreate,
  type ProcessingRunProgressWrite,
  type ProcessingRunWriteOutcome,
} from '../../../modules/processing/index.js';

import {PostgresAiTagProposalRepository} from './postgres_ai_tag_proposal_repository.js';
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
  PostgresAdapterError,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

const READ_PAIR_PROPOSALS_SQL = sql(
  'SELECT workspace_id::text, proposal_id::text, run_id::text,',
  '  proposal_ordinal, stage, proposal_kind, target_snapshot_id::text,',
  '  target_entry_id::text, related_entry_id::text, status, summary,',
  '  created_at, decided_at',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND target_entry_id = $2 AND related_entry_id = $3',
  "  AND proposal_kind = 'association'",
  'ORDER BY created_at DESC, proposal_id DESC',
  'LIMIT $4',
);

const READ_INPUTS_SQL = sql(
  'SELECT proposal_id::text, input_ordinal, fragment_id::text',
  'FROM struinfo.processing_proposal_fragment_input',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, input_ordinal',
);

const READ_PAYLOADS_SQL = sql(
  'SELECT proposal_id::text, expected_entry_low_revision,',
  '  expected_entry_high_revision, expected_override_revision,',
  '  provider_model, prompt_version, relation_label, graph_direction',
  'FROM struinfo.processing_association_proposal',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id',
);

const LOCK_RUN_SQL = sql(
  'SELECT status',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND run_id = $2',
  'FOR UPDATE',
);

const READ_PROPOSAL_BY_ORDINAL_SQL = sql(
  'SELECT proposal_id::text, stage, proposal_kind, target_entry_id::text,',
  '  related_entry_id::text, summary',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND run_id = $2 AND proposal_ordinal = $3',
);

const INSERT_PROPOSAL_SQL = sql(
  'INSERT INTO struinfo.processing_proposal (',
  '  workspace_id, proposal_id, run_id, proposal_ordinal, stage,',
  '  proposal_kind, target_snapshot_id, target_entry_id, related_entry_id, summary',
  ') VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)',
);

const INSERT_INPUT_SQL = sql(
  'INSERT INTO struinfo.processing_proposal_fragment_input (',
  '  workspace_id, proposal_id, input_ordinal, fragment_id',
  ') VALUES ($1, $2, $3, $4)',
);

const INSERT_PAYLOAD_SQL = sql(
  'INSERT INTO struinfo.processing_association_proposal (',
  '  workspace_id, proposal_id, expected_entry_low_revision,',
  '  expected_entry_high_revision, expected_override_revision,',
  '  provider_model, prompt_version, relation_label, graph_direction',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresAiAssociationProposalRepository implements AiAssociationProposalRepositoryPort {
  readonly #base: PostgresAiTagProposalRepository;
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#base = new PostgresAiTagProposalRepository(pool);
    this.#pool = pool;
  }

  public createRun(
    create: Readonly<ProcessingRunCreate>,
  ): Promise<ProcessingRunWriteOutcome> {
    return this.#base.createRun(create);
  }

  public writeProgress(
    write: Readonly<ProcessingRunProgressWrite>,
  ): Promise<ProcessingRunWriteOutcome> {
    return this.#base.writeProgress(write);
  }

  public cancelRun(
    workspaceId: string,
    runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome> {
    return this.#base.cancelRun(workspaceId, runId, expectedVersion);
  }

  public appendProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (
      proposal.splitPayload !== undefined ||
      proposal.tagPayload !== undefined ||
      proposal.associationPayload !== undefined
    ) {
      throw new PostgresAdapterError();
    }
    return this.#base.appendProposal(proposal);
  }

  public listRecentRuns(
    workspaceId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingRun>[]> {
    return this.#base.listRecentRuns(workspaceId, limit);
  }

  public loadRun(
    workspaceId: string,
    runId: string,
  ): Promise<Readonly<ProcessingRun> | undefined> {
    return this.#base.loadRun(workspaceId, runId);
  }

  public decideProposal(
    workspaceId: string,
    proposalId: string,
    decision: ProcessingProposalDecision,
  ): Promise<ProcessingProposalDecisionOutcome> {
    return this.#base.decideProposal(workspaceId, proposalId, decision);
  }

  public listAssociationProposalsForPair(
    workspaceIdInput: string,
    entryLowIdInput: string,
    entryHighIdInput: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const entryLowId = canonicalUuid(entryLowIdInput);
    const entryHighId = canonicalUuid(entryHighIdInput);
    if (
      entryLowId >= entryHighId ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const rows = await client.query<Row>(READ_PAIR_PROPOSALS_SQL, [
          workspaceId,
          entryLowId,
          entryHighId,
          limit,
        ]);
        return loadRows(client, workspaceId, rows.rows);
      },
    );
  }

  public appendAssociationProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertProcessingProposalAppend(proposal);
    const associationPayload = proposal.associationPayload;
    if (proposal.kind !== 'association' || associationPayload === undefined) {
      throw new PostgresAdapterError();
    }
    assertProcessingAssociationProposalPayload(associationPayload);
    const workspaceId = canonicalUuid(proposal.workspaceId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const run = await client.query<Row>(LOCK_RUN_SQL, [
          workspaceId,
          proposal.runId,
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
          const row = existing.rows[0];
          return row.proposal_id === proposal.proposalId &&
            row.stage === proposal.stage &&
            row.proposal_kind === proposal.kind &&
            row.target_entry_id === proposal.targetEntryId &&
            row.related_entry_id === proposal.relatedEntryId &&
            row.summary === proposal.summary
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
          canonicalUuid(proposal.targetEntryId),
          canonicalUuid(proposal.relatedEntryId),
          proposal.summary,
        ]);
        expectOneAffected(inserted.rowCount);
        for (const [ordinal, fragmentId] of proposal.fragmentIds.entries()) {
          expectOneAffected(
            (
              await client.query<Row>(INSERT_INPUT_SQL, [
                workspaceId,
                proposal.proposalId,
                ordinal,
                canonicalUuid(fragmentId),
              ])
            ).rowCount,
          );
        }
        expectOneAffected(
          (
            await client.query<Row>(INSERT_PAYLOAD_SQL, [
              workspaceId,
              proposal.proposalId,
              associationPayload.expectedEntryLowRevision,
              associationPayload.expectedEntryHighRevision,
              associationPayload.expectedOverrideRevision,
              associationPayload.providerModel,
              associationPayload.promptVersion,
              associationPayload.relationLabel,
              associationPayload.direction,
            ])
          ).rowCount,
        );
        return 'applied';
      },
    );
  }
}

async function loadRows(
  client: PostgresClientBoundary,
  workspaceId: string,
  rows: readonly Row[],
): Promise<readonly Readonly<ProcessingProposal>[]> {
  if (rows.length === 0) return Object.freeze([]);
  const proposalIds = rows.map((row) => canonicalUuid(row.proposal_id));
  const [inputRows, payloadRows] = await Promise.all([
    client.query<Row>(READ_INPUTS_SQL, [workspaceId, proposalIds]),
    client.query<Row>(READ_PAYLOADS_SQL, [workspaceId, proposalIds]),
  ]);
  const inputs = groupOrderedInputs(inputRows.rows);
  const payloads = new Map<
    string,
    Readonly<ProcessingAssociationProposalPayload>
  >();
  for (const row of payloadRows.rows) {
    const proposalId = canonicalUuid(row.proposal_id);
    const payload = Object.freeze({
      expectedEntryLowRevision: integer(row.expected_entry_low_revision, 1),
      expectedEntryHighRevision: integer(row.expected_entry_high_revision, 1),
      expectedOverrideRevision: integer(row.expected_override_revision),
      providerModel: text(row.provider_model),
      promptVersion: text(row.prompt_version),
      relationLabel: text(row.relation_label),
      direction: enumValue(
        row.graph_direction,
        INFORMATION_ENTRY_GRAPH_DIRECTIONS,
      ),
    });
    assertProcessingAssociationProposalPayload(payload);
    payloads.set(proposalId, payload);
  }
  return Object.freeze(
    rows.map((row) => {
      const proposalId = canonicalUuid(row.proposal_id);
      const targetSnapshotId = optionalUuid(row.target_snapshot_id);
      const targetEntryId = optionalUuid(row.target_entry_id);
      const relatedEntryId = optionalUuid(row.related_entry_id);
      const decidedAt = optionalTimestamp(row.decided_at);
      const associationPayload = payloads.get(proposalId);
      return Object.freeze({
        workspaceId: canonicalUuid(row.workspace_id),
        proposalId,
        runId: canonicalUuid(row.run_id),
        ordinal: integer(row.proposal_ordinal),
        stage: enumValue(row.stage, ['split', 'tags', 'associations'] as const),
        kind: enumValue(row.proposal_kind, PROCESSING_PROPOSAL_KINDS),
        ...(targetSnapshotId === undefined ? {} : {targetSnapshotId}),
        ...(targetEntryId === undefined ? {} : {targetEntryId}),
        ...(relatedEntryId === undefined ? {} : {relatedEntryId}),
        status: enumValue(row.status, PROCESSING_PROPOSAL_STATUSES),
        summary: text(row.summary),
        fragmentIds: Object.freeze(inputs.get(proposalId) ?? []),
        ...(associationPayload === undefined ? {} : {associationPayload}),
        createdAt: timestamp(row.created_at),
        ...(decidedAt === undefined ? {} : {decidedAt}),
      });
    }),
  );
}

function groupOrderedInputs(rows: readonly Row[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const proposalId = canonicalUuid(row.proposal_id);
    const ordinal = integer(row.input_ordinal);
    const values = result.get(proposalId) ?? [];
    if (ordinal !== values.length) throw new PostgresAdapterError();
    values.push(canonicalUuid(row.fragment_id));
    result.set(proposalId, values);
  }
  return result;
}

function optionalUuid(value: unknown): string | undefined {
  return value === null ? undefined : canonicalUuid(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(date.getTime())) throw new PostgresAdapterError();
  return date.toISOString();
}

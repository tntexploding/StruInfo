import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  informationEntrySearchKey,
} from '../../../modules/entries/index.js';
import {
  PROCESSING_PRIVACY_SCOPES,
  PROCESSING_PROPOSAL_KINDS,
  PROCESSING_PROPOSAL_STATUSES,
  PROCESSING_RUN_ORIGINS,
  PROCESSING_RUN_STATUSES,
  PROCESSING_STAGES,
  assertProcessingProposalAppend,
  assertProcessingSplitProposalPayload,
  assertProcessingTagProposalPayload,
  type AiSplitProposalRepositoryPort,
  type AiTagProposalRepositoryPort,
  type ProcessingProposal,
  type ProcessingProposalAppend,
  type ProcessingProposalDecision,
  type ProcessingProposalDecisionOutcome,
  type ProcessingRun,
  type ProcessingRunCreate,
  type ProcessingRunProgressWrite,
  type ProcessingRunWriteOutcome,
  type ProcessingSplitProposalPayload,
  type ProcessingTagProposalPayload,
} from '../../../modules/processing/index.js';

import {PostgresProcessingRunRepository} from './postgres_processing_run_repository.js';
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

const READ_RUN_SQL = sql(
  'SELECT workspace_id::text, run_id::text, idempotency_key, origin,',
  '  provider_key, status, target_snapshot_id::text, privacy_scope,',
  '  current_stage, current_step, completed_units, total_units, attempt,',
  '  current_version, error_code, created_at, started_at, finished_at, updated_at',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND run_id = $2',
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

const READ_ENTRY_TAG_PROPOSALS_SQL = sql(
  'SELECT workspace_id::text, proposal_id::text, run_id::text,',
  '  proposal_ordinal, stage, proposal_kind, target_snapshot_id::text,',
  '  target_entry_id::text, related_entry_id::text, status, summary,',
  '  created_at, decided_at',
  'FROM struinfo.processing_proposal',
  "WHERE workspace_id = $1 AND target_entry_id = $2 AND proposal_kind = 'tags'",
  'ORDER BY created_at DESC, proposal_id DESC',
  'LIMIT $3',
);

const READ_SNAPSHOT_SPLIT_PROPOSALS_SQL = sql(
  'SELECT workspace_id::text, proposal_id::text, run_id::text,',
  '  proposal_ordinal, stage, proposal_kind, target_snapshot_id::text,',
  '  target_entry_id::text, related_entry_id::text, status, summary,',
  '  created_at, decided_at',
  'FROM struinfo.processing_proposal',
  "WHERE workspace_id = $1 AND target_snapshot_id = $2 AND proposal_kind = 'split'",
  'ORDER BY created_at DESC, proposal_id DESC',
  'LIMIT $3',
);

const READ_SPLIT_PAYLOADS_SQL = sql(
  'SELECT proposal_id::text, provider_model, prompt_version, split_rule_version',
  'FROM struinfo.processing_split_proposal',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id',
);
const READ_SPLIT_ENTRIES_SQL = sql(
  'SELECT proposal_id::text, entry_ordinal, title_path',
  'FROM struinfo.processing_split_proposal_entry',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, entry_ordinal',
);
const READ_SPLIT_ENTRY_FRAGMENTS_SQL = sql(
  'SELECT proposal_id::text, entry_ordinal, fragment_ordinal, fragment_id::text',
  'FROM struinfo.processing_split_proposal_entry_fragment',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, entry_ordinal, fragment_ordinal',
);
const READ_PROPOSAL_INPUTS_SQL = sql(
  'SELECT proposal_id::text, input_ordinal, fragment_id::text',
  'FROM struinfo.processing_proposal_fragment_input',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, input_ordinal',
);

const READ_TAG_PAYLOADS_SQL = sql(
  'SELECT proposal_id::text, expected_entry_revision, provider_model,',
  '  prompt_version, type_keyword, type_custom_name',
  'FROM struinfo.processing_tag_proposal',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id',
);

const READ_TAG_KEYWORDS_SQL = sql(
  'SELECT proposal_id::text, keyword_ordinal, display_value, normalized_value',
  'FROM struinfo.processing_tag_proposal_content_keyword',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, keyword_ordinal',
);

const READ_TAG_DOMAINS_SQL = sql(
  'SELECT proposal_id::text, domain_ordinal, domain_keyword, custom_name',
  'FROM struinfo.processing_tag_proposal_domain',
  'WHERE workspace_id = $1 AND proposal_id = ANY($2::uuid[])',
  'ORDER BY proposal_id, domain_ordinal',
);

const LOCK_RUN_SQL = sql(
  'SELECT status',
  'FROM struinfo.processing_run',
  'WHERE workspace_id = $1 AND run_id = $2',
  'FOR UPDATE',
);

const READ_PROPOSAL_BY_ORDINAL_SQL = sql(
  'SELECT proposal_id::text, stage, proposal_kind, target_snapshot_id::text, target_entry_id::text, summary',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND run_id = $2 AND proposal_ordinal = $3',
);

const INSERT_PROPOSAL_SQL = sql(
  'INSERT INTO struinfo.processing_proposal (',
  '  workspace_id, proposal_id, run_id, proposal_ordinal, stage,',
  '  proposal_kind, target_snapshot_id, target_entry_id, related_entry_id, summary',
  ') VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, NULL, $8)',
);

const INSERT_SPLIT_PROPOSAL_SQL = sql(
  'INSERT INTO struinfo.processing_proposal (',
  '  workspace_id, proposal_id, run_id, proposal_ordinal, stage,',
  '  proposal_kind, target_snapshot_id, target_entry_id, related_entry_id, summary',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8)',
);
const INSERT_SPLIT_PAYLOAD_SQL = sql(
  'INSERT INTO struinfo.processing_split_proposal (',
  '  workspace_id, proposal_id, provider_model, prompt_version, split_rule_version',
  ') VALUES ($1, $2, $3, $4, $5)',
);
const INSERT_SPLIT_ENTRY_SQL = sql(
  'INSERT INTO struinfo.processing_split_proposal_entry (',
  '  workspace_id, proposal_id, entry_ordinal, title_path',
  ') VALUES ($1, $2, $3, $4)',
);
const INSERT_SPLIT_ENTRY_FRAGMENT_SQL = sql(
  'INSERT INTO struinfo.processing_split_proposal_entry_fragment (',
  '  workspace_id, proposal_id, entry_ordinal, fragment_ordinal, fragment_id',
  ') VALUES ($1, $2, $3, $4, $5)',
);
const INSERT_PROPOSAL_INPUT_SQL = sql(
  'INSERT INTO struinfo.processing_proposal_fragment_input (',
  '  workspace_id, proposal_id, input_ordinal, fragment_id',
  ') VALUES ($1, $2, $3, $4)',
);

const INSERT_TAG_PAYLOAD_SQL = sql(
  'INSERT INTO struinfo.processing_tag_proposal (',
  '  workspace_id, proposal_id, expected_entry_revision, provider_model,',
  '  prompt_version, type_keyword, type_custom_name',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7)',
);

const INSERT_TAG_KEYWORD_SQL = sql(
  'INSERT INTO struinfo.processing_tag_proposal_content_keyword (',
  '  workspace_id, proposal_id, keyword_ordinal, display_value, normalized_value',
  ') VALUES ($1, $2, $3, $4, $5)',
);

const INSERT_TAG_DOMAIN_SQL = sql(
  'INSERT INTO struinfo.processing_tag_proposal_domain (',
  '  workspace_id, proposal_id, domain_ordinal, domain_keyword, custom_name',
  ') VALUES ($1, $2, $3, $4, $5)',
);

const LOCK_PROPOSAL_SQL = sql(
  'SELECT status',
  'FROM struinfo.processing_proposal',
  'WHERE workspace_id = $1 AND proposal_id = $2',
  'FOR UPDATE',
);

const DECIDE_PROPOSAL_SQL = sql(
  'UPDATE struinfo.processing_proposal',
  'SET status = $3, decided_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND proposal_id = $2',
);

type Row = Readonly<Record<string, unknown>>;

/** Adds the first closed payload without changing the provider-neutral repository. */
export class PostgresAiTagProposalRepository
  implements AiTagProposalRepositoryPort, AiSplitProposalRepositoryPort
{
  readonly #base: PostgresProcessingRunRepository;
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#base = new PostgresProcessingRunRepository(pool);
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

  public async listRecentRuns(
    workspaceId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingRun>[]> {
    const runs = await this.#base.listRecentRuns(workspaceId, limit);
    if (runs.length === 0) return runs;
    const proposalIds = runs.flatMap((run) =>
      run.proposals.map((proposal) => proposal.proposalId),
    );
    const [tagPayloads, splitPayloads] = await Promise.all([
      this.#loadTagPayloads(workspaceId, proposalIds),
      this.#loadSplitPayloads(workspaceId, proposalIds),
    ]);
    return Object.freeze(
      runs.map((run) =>
        Object.freeze({
          ...run,
          proposals: Object.freeze(
            run.proposals.map((proposal) =>
              attachPayload(proposal, tagPayloads, splitPayloads),
            ),
          ),
        }),
      ),
    );
  }

  public loadRun(
    workspaceIdInput: string,
    runIdInput: string,
  ): Promise<Readonly<ProcessingRun> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const runRows = await client.query<Row>(READ_RUN_SQL, [
          workspaceId,
          runId,
        ]);
        if (runRows.rows.length === 0) return undefined;
        if (runRows.rows.length !== 1 || runRows.rows[0] === undefined) {
          throw new PostgresAdapterError();
        }
        const proposals = await loadProposals(client, workspaceId, runId);
        return mapRun(runRows.rows[0], proposals);
      },
    );
  }

  public listTagProposalsForEntry(
    workspaceIdInput: string,
    entryIdInput: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const entryId = canonicalUuid(entryIdInput);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const rows = await client.query<Row>(READ_ENTRY_TAG_PROPOSALS_SQL, [
          workspaceId,
          entryId,
          limit,
        ]);
        return loadProposalRows(client, workspaceId, rows.rows);
      },
    );
  }

  public appendTagProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertProcessingProposalAppend(proposal);
    if (proposal.kind !== 'tags' || proposal.tagPayload === undefined) {
      throw new PostgresAdapterError();
    }
    const tagPayload = proposal.tagPayload;
    assertProcessingTagProposalPayload(tagPayload);
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
          const loaded = await loadProposalRows(client, workspaceId, [
            proposalEnvelopeRow(existing.rows[0], workspaceId, proposal),
          ]);
          return loaded[0] !== undefined && sameTagProposal(loaded[0], proposal)
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
        await insertTagPayload(
          client,
          workspaceId,
          proposal.proposalId,
          tagPayload,
        );
        return 'applied';
      },
    );
  }

  public listSplitProposalsForSnapshot(
    workspaceIdInput: string,
    snapshotIdInput: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const snapshotId = canonicalUuid(snapshotIdInput);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new PostgresAdapterError();
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const rows = await client.query<Row>(
          READ_SNAPSHOT_SPLIT_PROPOSALS_SQL,
          [workspaceId, snapshotId, limit],
        );
        return loadProposalRows(client, workspaceId, rows.rows);
      },
    );
  }

  public appendSplitProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome> {
    assertProcessingProposalAppend(proposal);
    const payload = proposal.splitPayload;
    if (proposal.kind !== 'split' || payload === undefined)
      throw new PostgresAdapterError();
    assertProcessingSplitProposalPayload(payload);
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
          const loaded = await loadProposalRows(client, workspaceId, [
            proposalEnvelopeRow(existing.rows[0], workspaceId, proposal),
          ]);
          return loaded[0] !== undefined &&
            sameSplitProposal(loaded[0], proposal)
            ? 'unchanged'
            : 'conflict';
        }
        expectOneAffected(
          (
            await client.query<Row>(INSERT_SPLIT_PROPOSAL_SQL, [
              workspaceId,
              canonicalUuid(proposal.proposalId),
              canonicalUuid(proposal.runId),
              proposal.ordinal,
              proposal.stage,
              proposal.kind,
              canonicalUuid(proposal.targetSnapshotId),
              proposal.summary,
            ])
          ).rowCount,
        );
        for (const [ordinal, fragmentId] of proposal.fragmentIds.entries()) {
          expectOneAffected(
            (
              await client.query<Row>(INSERT_PROPOSAL_INPUT_SQL, [
                workspaceId,
                proposal.proposalId,
                ordinal,
                canonicalUuid(fragmentId),
              ])
            ).rowCount,
          );
        }
        await insertSplitPayload(
          client,
          workspaceId,
          proposal.proposalId,
          payload,
        );
        return 'applied';
      },
    );
  }
  public decideProposal(
    workspaceIdInput: string,
    proposalIdInput: string,
    decision: ProcessingProposalDecision,
  ): Promise<ProcessingProposalDecisionOutcome> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const proposalId = canonicalUuid(proposalIdInput);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const current = await client.query<Row>(LOCK_PROPOSAL_SQL, [
          workspaceId,
          proposalId,
        ]);
        if (current.rows.length === 0) return 'not_found';
        if (current.rows.length !== 1) throw new PostgresAdapterError();
        const status = enumValue(
          current.rows[0]?.status,
          PROCESSING_PROPOSAL_STATUSES,
        );
        if (status === decision) return 'unchanged';
        if (status !== 'pending_review') return 'terminal';
        const updated = await client.query<Row>(DECIDE_PROPOSAL_SQL, [
          workspaceId,
          proposalId,
          decision,
        ]);
        expectOneAffected(updated.rowCount);
        return 'applied';
      },
    );
  }

  async #loadSplitPayloads(
    workspaceId: string,
    proposalIds: readonly string[],
  ): Promise<ReadonlyMap<string, Readonly<ProcessingSplitProposalPayload>>> {
    if (proposalIds.length === 0) return new Map();
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      (client) =>
        loadSplitPayloads(client, canonicalUuid(workspaceId), proposalIds),
    );
  }
  async #loadTagPayloads(
    workspaceId: string,
    proposalIds: readonly string[],
  ): Promise<ReadonlyMap<string, Readonly<ProcessingTagProposalPayload>>> {
    if (proposalIds.length === 0) return new Map();
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      (client) =>
        loadTagPayloads(client, canonicalUuid(workspaceId), proposalIds),
    );
  }
}

async function loadProposals(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
): Promise<readonly Readonly<ProcessingProposal>[]> {
  const rows = await client.query<Row>(READ_RUN_PROPOSALS_SQL, [
    workspaceId,
    [runId],
  ]);
  return loadProposalRows(client, workspaceId, rows.rows);
}

async function loadProposalRows(
  client: PostgresClientBoundary,
  workspaceId: string,
  rows: readonly Row[],
): Promise<readonly Readonly<ProcessingProposal>[]> {
  if (rows.length === 0) return Object.freeze([]);
  const proposalIds = rows.map((row) => canonicalUuid(row.proposal_id));
  const [inputResult, tagPayloads, splitPayloads] = await Promise.all([
    client.query<Row>(READ_PROPOSAL_INPUTS_SQL, [workspaceId, proposalIds]),
    loadTagPayloads(client, workspaceId, proposalIds),
    loadSplitPayloads(client, workspaceId, proposalIds),
  ]);
  const inputs = groupOrdered(
    inputResult.rows,
    'proposal_id',
    'input_ordinal',
    (row) => canonicalUuid(row.fragment_id),
  );
  return Object.freeze(
    rows.map((row) =>
      mapProposal(
        row,
        inputs.get(canonicalUuid(row.proposal_id)) ?? [],
        tagPayloads,
        splitPayloads,
      ),
    ),
  );
}

async function loadTagPayloads(
  client: PostgresClientBoundary,
  workspaceId: string,
  proposalIdsInput: readonly string[],
): Promise<ReadonlyMap<string, Readonly<ProcessingTagProposalPayload>>> {
  const proposalIds = proposalIdsInput.map(canonicalUuid);
  if (proposalIds.length === 0) return new Map();
  const [headers, keywordRows, domainRows] = await Promise.all([
    client.query<Row>(READ_TAG_PAYLOADS_SQL, [workspaceId, proposalIds]),
    client.query<Row>(READ_TAG_KEYWORDS_SQL, [workspaceId, proposalIds]),
    client.query<Row>(READ_TAG_DOMAINS_SQL, [workspaceId, proposalIds]),
  ]);
  const keywords = groupOrdered(
    keywordRows.rows,
    'proposal_id',
    'keyword_ordinal',
    (row) =>
      Object.freeze({
        displayValue: text(row.display_value),
        normalizedValue: text(row.normalized_value),
      }),
  );
  const domains = groupOrdered(
    domainRows.rows,
    'proposal_id',
    'domain_ordinal',
    (row) => {
      const customName = optionalText(row.custom_name);
      return Object.freeze({
        keyword: enumValue(row.domain_keyword, ENTRY_DOMAIN_KEYWORDS),
        ...(customName === undefined ? {} : {customName}),
      });
    },
  );
  const result = new Map<string, Readonly<ProcessingTagProposalPayload>>();
  for (const row of headers.rows) {
    const proposalId = canonicalUuid(row.proposal_id);
    const typeCustomName = optionalText(row.type_custom_name);
    const payload = Object.freeze({
      expectedEntryRevision: integer(row.expected_entry_revision, 1),
      providerModel: text(row.provider_model),
      promptVersion: text(row.prompt_version),
      contentKeywords: Object.freeze(keywords.get(proposalId) ?? []),
      typeKeyword: enumValue(row.type_keyword, ENTRY_TYPE_KEYWORDS),
      ...(typeCustomName === undefined ? {} : {typeCustomName}),
      domains: Object.freeze(domains.get(proposalId) ?? []),
    });
    assertProcessingTagProposalPayload(payload);
    result.set(proposalId, payload);
  }
  return result;
}

function groupOrdered<T>(
  rows: readonly Row[],
  identityColumn: string,
  ordinalColumn: string,
  map: (row: Row) => T,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const identity = canonicalUuid(row[identityColumn]);
    const ordinal = integer(row[ordinalColumn]);
    const values = result.get(identity) ?? [];
    if (ordinal !== values.length) throw new PostgresAdapterError();
    values.push(map(row));
    result.set(identity, values);
  }
  return result;
}

async function insertTagPayload(
  client: PostgresClientBoundary,
  workspaceId: string,
  proposalId: string,
  payload: Readonly<ProcessingTagProposalPayload>,
): Promise<void> {
  expectOneAffected(
    (
      await client.query<Row>(INSERT_TAG_PAYLOAD_SQL, [
        workspaceId,
        proposalId,
        payload.expectedEntryRevision,
        payload.providerModel,
        payload.promptVersion,
        payload.typeKeyword,
        payload.typeCustomName ?? null,
      ])
    ).rowCount,
  );
  for (const [ordinal, keyword] of payload.contentKeywords.entries()) {
    if (
      informationEntrySearchKey(keyword.displayValue) !==
      keyword.normalizedValue
    ) {
      throw new PostgresAdapterError();
    }
    expectOneAffected(
      (
        await client.query<Row>(INSERT_TAG_KEYWORD_SQL, [
          workspaceId,
          proposalId,
          ordinal,
          keyword.displayValue,
          keyword.normalizedValue,
        ])
      ).rowCount,
    );
  }
  for (const [ordinal, domain] of payload.domains.entries()) {
    expectOneAffected(
      (
        await client.query<Row>(INSERT_TAG_DOMAIN_SQL, [
          workspaceId,
          proposalId,
          ordinal,
          domain.keyword,
          domain.customName ?? null,
        ])
      ).rowCount,
    );
  }
}

function mapProposal(
  row: Row,
  fragmentIds: readonly string[],
  tagPayloads: ReadonlyMap<string, Readonly<ProcessingTagProposalPayload>>,
  splitPayloads: ReadonlyMap<string, Readonly<ProcessingSplitProposalPayload>>,
): ProcessingProposal {
  const proposalId = canonicalUuid(row.proposal_id);
  const targetSnapshotId = optionalUuid(row.target_snapshot_id);
  const targetEntryId = optionalUuid(row.target_entry_id);
  const relatedEntryId = optionalUuid(row.related_entry_id);
  const decidedAt = optionalTimestamp(row.decided_at);
  const tagPayload = tagPayloads.get(proposalId);
  const splitPayload = splitPayloads.get(proposalId);
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
    fragmentIds: Object.freeze([...fragmentIds]),
    ...(splitPayload === undefined ? {} : {splitPayload}),
    ...(tagPayload === undefined ? {} : {tagPayload}),
    createdAt: timestamp(row.created_at),
    ...(decidedAt === undefined ? {} : {decidedAt}),
  });
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

function attachPayload(
  proposal: Readonly<ProcessingProposal>,
  tagPayloads: ReadonlyMap<string, Readonly<ProcessingTagProposalPayload>>,
  splitPayloads: ReadonlyMap<string, Readonly<ProcessingSplitProposalPayload>>,
): Readonly<ProcessingProposal> {
  const tagPayload = tagPayloads.get(proposal.proposalId);
  const splitPayload = splitPayloads.get(proposal.proposalId);
  return tagPayload === undefined && splitPayload === undefined
    ? proposal
    : Object.freeze({
        ...proposal,
        ...(splitPayload === undefined ? {} : {splitPayload}),
        ...(tagPayload === undefined ? {} : {tagPayload}),
      });
}

function sameTagProposal(
  current: Readonly<ProcessingProposal>,
  expected: Readonly<ProcessingProposalAppend>,
): boolean {
  return (
    current.proposalId === expected.proposalId &&
    current.targetEntryId === expected.targetEntryId &&
    current.summary === expected.summary &&
    JSON.stringify(current.fragmentIds) ===
      JSON.stringify(expected.fragmentIds) &&
    JSON.stringify(current.tagPayload) === JSON.stringify(expected.tagPayload)
  );
}

function proposalEnvelopeRow(
  row: Row,
  workspaceId: string,
  proposal: Readonly<ProcessingProposalAppend>,
): Row {
  return Object.freeze({
    workspace_id: workspaceId,
    proposal_id: row.proposal_id,
    run_id: proposal.runId,
    proposal_ordinal: proposal.ordinal,
    stage: row.stage,
    proposal_kind: row.proposal_kind,
    target_snapshot_id: row.target_snapshot_id,
    target_entry_id: row.target_entry_id,
    related_entry_id: null,
    status: 'pending_review',
    summary: row.summary,
    created_at: new Date(0),
    decided_at: null,
  });
}

async function loadSplitPayloads(
  client: PostgresClientBoundary,
  workspaceId: string,
  proposalIdsInput: readonly string[],
): Promise<ReadonlyMap<string, Readonly<ProcessingSplitProposalPayload>>> {
  const proposalIds = proposalIdsInput.map(canonicalUuid);
  if (proposalIds.length === 0) return new Map();
  const [headers, entriesResult, fragmentsResult] = await Promise.all([
    client.query<Row>(READ_SPLIT_PAYLOADS_SQL, [workspaceId, proposalIds]),
    client.query<Row>(READ_SPLIT_ENTRIES_SQL, [workspaceId, proposalIds]),
    client.query<Row>(READ_SPLIT_ENTRY_FRAGMENTS_SQL, [
      workspaceId,
      proposalIds,
    ]),
  ]);
  const fragments = new Map<string, string[]>();
  for (const row of fragmentsResult.rows) {
    const proposalId = canonicalUuid(row.proposal_id);
    const entryOrdinal = integer(row.entry_ordinal);
    const key = `${proposalId}:${entryOrdinal.toString()}`;
    const values = fragments.get(key) ?? [];
    if (integer(row.fragment_ordinal) !== values.length)
      throw new PostgresAdapterError();
    values.push(canonicalUuid(row.fragment_id));
    fragments.set(key, values);
  }
  const entries = groupOrdered(
    entriesResult.rows,
    'proposal_id',
    'entry_ordinal',
    (row) => {
      const proposalId = canonicalUuid(row.proposal_id);
      const entryOrdinal = integer(row.entry_ordinal);
      return Object.freeze({
        titlePath: text(row.title_path),
        fragmentIds: Object.freeze(
          fragments.get(`${proposalId}:${entryOrdinal.toString()}`) ?? [],
        ),
      });
    },
  );
  const result = new Map<string, Readonly<ProcessingSplitProposalPayload>>();
  for (const row of headers.rows) {
    const proposalId = canonicalUuid(row.proposal_id);
    const payload = Object.freeze({
      providerModel: text(row.provider_model),
      promptVersion: text(row.prompt_version),
      splitRuleVersion: text(
        row.split_rule_version,
      ) as 'struinfo.entry-split.ai-group.v1',
      entries: Object.freeze(entries.get(proposalId) ?? []),
    });
    assertProcessingSplitProposalPayload(payload);
    result.set(proposalId, payload);
  }
  return result;
}

async function insertSplitPayload(
  client: PostgresClientBoundary,
  workspaceId: string,
  proposalId: string,
  payload: Readonly<ProcessingSplitProposalPayload>,
): Promise<void> {
  expectOneAffected(
    (
      await client.query<Row>(INSERT_SPLIT_PAYLOAD_SQL, [
        workspaceId,
        proposalId,
        payload.providerModel,
        payload.promptVersion,
        payload.splitRuleVersion,
      ])
    ).rowCount,
  );
  for (const [entryOrdinal, entry] of payload.entries.entries()) {
    expectOneAffected(
      (
        await client.query<Row>(INSERT_SPLIT_ENTRY_SQL, [
          workspaceId,
          proposalId,
          entryOrdinal,
          entry.titlePath,
        ])
      ).rowCount,
    );
    for (const [fragmentOrdinal, fragmentId] of entry.fragmentIds.entries()) {
      expectOneAffected(
        (
          await client.query<Row>(INSERT_SPLIT_ENTRY_FRAGMENT_SQL, [
            workspaceId,
            proposalId,
            entryOrdinal,
            fragmentOrdinal,
            canonicalUuid(fragmentId),
          ])
        ).rowCount,
      );
    }
  }
}

function sameSplitProposal(
  current: Readonly<ProcessingProposal>,
  expected: Readonly<ProcessingProposalAppend>,
): boolean {
  return (
    current.proposalId === expected.proposalId &&
    current.targetSnapshotId === expected.targetSnapshotId &&
    current.summary === expected.summary &&
    JSON.stringify(current.fragmentIds) ===
      JSON.stringify(expected.fragmentIds) &&
    JSON.stringify(current.splitPayload) ===
      JSON.stringify(expected.splitPayload)
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

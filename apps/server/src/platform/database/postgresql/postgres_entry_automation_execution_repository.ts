import {
  ENTRY_AUTOMATION_CLAIM_STATUSES,
  ENTRY_AUTOMATION_ACTION_STATES,
  ENTRY_AUTOMATION_WORK_ITEM_STATES,
  PROCESSING_RUN_STATUSES,
  type EntryAutomationClaim,
  type EntryAutomationClaimInput,
  type EntryAutomationExecution,
  type EntryAutomationExecutionInitialize,
  type EntryAutomationExecutionRepositoryPort,
  type EntryAutomationExecutionSettle,
  type EntryAutomationAction,
  type EntryAutomationActionKeyword,
  type EntryAutomationActionRepositoryPort,
  type EntryAutomationActionWriteOutcome,
  type EntryAutomationWorkItem,
  type EntryAutomationWorkItemState,
  type EntryAutomationWorkQueueRepositoryPort,
  type ProcessingRunWriteOutcome,
} from '../../../modules/processing/index.js';
import {
  deriveInformationEntryRevisionId,
  deterministicEntryTagOriginVersion,
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

const READ_ENTRY_AUTOMATION_ACTION_AUTHORITIES_SQL = sql(
  'SELECT claim_ordinal, deterministic_tags_enabled,',
  '  rebuild_associations_enabled, origin_version',
  'FROM struinfo.processing_entry_automation_action',
  'WHERE workspace_id = $1 AND run_id = $2',
  'ORDER BY claim_ordinal',
);

const READ_CURRENT_ENTRY_REVISIONS_SQL = sql(
  'SELECT entry_id::text, current_revision, current_revision_id::text',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND entry_id = ANY($2::uuid[])',
  '  AND is_current_structure',
  'ORDER BY entry_id',
);

export const READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL = sql(
  'SELECT work.workspace_id::text, work.run_id::text, work.claim_ordinal,',
  '  claim.entry_id::text, claim.entry_revision,',
  '  claim.entry_revision_id::text, claim.route, claim.reason,',
  '  work.state, work.current_version, work.created_at, work.updated_at,',
  '  work.resolved_at, action.deterministic_tags_enabled,',
  '  action.rebuild_associations_enabled, action.state AS action_state,',
  '  action.origin_version, action.result_entry_revision,',
  '  action.result_entry_revision_id::text, action.added_tag_count,',
  '  action.association_projection_count,',
  '  action.current_version AS action_version,',
  '  action.created_at AS action_created_at,',
  '  action.updated_at AS action_updated_at,',
  '  action.completed_at AS action_completed_at',
  'FROM struinfo.processing_entry_automation_work_item AS work',
  'JOIN struinfo.processing_entry_automation_claim AS claim',
  '  ON claim.workspace_id = work.workspace_id',
  '  AND claim.run_id = work.run_id',
  '  AND claim.claim_ordinal = work.claim_ordinal',
  'LEFT JOIN struinfo.processing_entry_automation_action AS action',
  '  ON action.workspace_id = work.workspace_id',
  '  AND action.run_id = work.run_id',
  '  AND action.claim_ordinal = work.claim_ordinal',
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
  '  work.resolved_at, action.deterministic_tags_enabled,',
  '  action.rebuild_associations_enabled, action.state AS action_state,',
  '  action.origin_version, action.result_entry_revision,',
  '  action.result_entry_revision_id::text, action.added_tag_count,',
  '  action.association_projection_count,',
  '  action.current_version AS action_version,',
  '  action.created_at AS action_created_at,',
  '  action.updated_at AS action_updated_at,',
  '  action.completed_at AS action_completed_at',
  'FROM struinfo.processing_entry_automation_work_item AS work',
  'JOIN struinfo.processing_entry_automation_claim AS claim',
  '  ON claim.workspace_id = work.workspace_id',
  '  AND claim.run_id = work.run_id',
  '  AND claim.claim_ordinal = work.claim_ordinal',
  'LEFT JOIN struinfo.processing_entry_automation_action AS action',
  '  ON action.workspace_id = work.workspace_id',
  '  AND action.run_id = work.run_id',
  '  AND action.claim_ordinal = work.claim_ordinal',
  'WHERE work.workspace_id = $1 AND work.run_id = $2',
  '  AND work.claim_ordinal = $3',
);

const READ_ENTRY_AUTOMATION_RUN_WORK_ITEMS_SQL = sql(
  READ_ENTRY_AUTOMATION_WORK_ITEMS_SQL.replace(
    'WHERE work.workspace_id = $1',
    'WHERE work.workspace_id = $1 AND work.run_id = $2',
  ).replace('LIMIT $2', ''),
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

const INSERT_AUTOMATION_ACTION_SQL = sql(
  'INSERT INTO struinfo.processing_entry_automation_action (',
  '  workspace_id, run_id, claim_ordinal, deterministic_tags_enabled,',
  '  rebuild_associations_enabled, origin_version',
  ') VALUES ($1, $2, $3, $4, $5, $6)',
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

const CANCEL_AUTOMATION_ACTIONS_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_action SET',
  "  state = 'cancelled', current_version = current_version + 1,",
  '  updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP',
  "WHERE workspace_id = $1 AND run_id = $2 AND state = 'pending'",
);

const LOCK_AUTOMATION_ACTION_ENTRY_SQL = sql(
  'SELECT action.deterministic_tags_enabled,',
  '  action.rebuild_associations_enabled, action.state AS action_state,',
  '  action.origin_version, action.result_entry_revision,',
  '  action.result_entry_revision_id::text, action.added_tag_count,',
  '  action.current_version AS action_version, work.state AS work_state,',
  '  claim.entry_id::text, claim.entry_revision,',
  '  claim.entry_revision_id::text, claim.route,',
  '  run.status AS run_status, entry.current_revision,',
  '  entry.current_revision_id::text, entry.is_private',
  'FROM struinfo.processing_entry_automation_action AS action',
  'JOIN struinfo.processing_entry_automation_work_item AS work',
  '  ON work.workspace_id = action.workspace_id',
  '  AND work.run_id = action.run_id',
  '  AND work.claim_ordinal = action.claim_ordinal',
  'JOIN struinfo.processing_entry_automation_claim AS claim',
  '  ON claim.workspace_id = action.workspace_id',
  '  AND claim.run_id = action.run_id',
  '  AND claim.claim_ordinal = action.claim_ordinal',
  'JOIN struinfo.processing_run AS run',
  '  ON run.workspace_id = action.workspace_id AND run.run_id = action.run_id',
  'JOIN struinfo.information_entry AS entry',
  '  ON entry.workspace_id = action.workspace_id',
  '  AND entry.entry_id = claim.entry_id',
  'WHERE action.workspace_id = $1 AND action.run_id = $2',
  '  AND action.claim_ordinal = $3',
  '  AND entry.is_current_structure',
  'FOR UPDATE OF action, entry',
);

const READ_MAXIMUM_ENTRY_KEYWORD_ORDINAL_SQL = sql(
  'SELECT coalesce(max(keyword_ordinal), -1) AS maximum_ordinal',
  'FROM struinfo.information_entry_content_keyword',
  'WHERE workspace_id = $1 AND entry_id = (',
  '  SELECT entry_id FROM struinfo.processing_entry_automation_claim',
  '  WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  ')',
);

const INSERT_AUTOMATION_ENTRY_KEYWORD_SQL = sql(
  'INSERT INTO struinfo.information_entry_content_keyword (',
  '  workspace_id, entry_id, keyword_ordinal, display_value,',
  '  normalized_value, origin, origin_version',
  ") SELECT $1, claim.entry_id, $4, $5, $6, 'rule', action.origin_version",
  'FROM struinfo.processing_entry_automation_claim AS claim',
  'JOIN struinfo.processing_entry_automation_action AS action',
  '  ON action.workspace_id = claim.workspace_id',
  '  AND action.run_id = claim.run_id',
  '  AND action.claim_ordinal = claim.claim_ordinal',
  'WHERE claim.workspace_id = $1 AND claim.run_id = $2',
  '  AND claim.claim_ordinal = $3',
);

const UPDATE_AUTOMATION_ENTRY_REVISION_SQL = sql(
  'UPDATE struinfo.information_entry AS entry SET',
  '  current_revision = $4, current_revision_id = $5,',
  '  updated_at = CURRENT_TIMESTAMP',
  'FROM struinfo.processing_entry_automation_claim AS claim',
  'WHERE claim.workspace_id = $1 AND claim.run_id = $2',
  '  AND claim.claim_ordinal = $3',
  '  AND entry.workspace_id = claim.workspace_id',
  '  AND entry.entry_id = claim.entry_id',
  '  AND entry.current_revision = $6',
  '  AND entry.current_revision_id = $7',
  '  AND entry.is_current_structure',
);

const MARK_AUTOMATION_TAGS_APPLIED_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_action SET',
  "  state = 'tags_applied', result_entry_revision = $5,",
  '  result_entry_revision_id = $6, added_tag_count = $7,',
  '  association_projection_count = NULL,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  "  AND current_version = $4 AND state = 'pending'",
);

const COMPLETE_AUTOMATION_ACTION_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_action SET',
  '  state = $5, association_projection_count = $6,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP,',
  '  completed_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  '  AND current_version = $4',
  "  AND (($5 = 'applied' AND state = 'tags_applied')",
  "    OR ($5 = 'undone' AND state = 'undo_pending'))",
);

const DELETE_AUTOMATION_ENTRY_KEYWORDS_SQL = sql(
  'DELETE FROM struinfo.information_entry_content_keyword AS keyword',
  'USING struinfo.processing_entry_automation_claim AS claim,',
  '  struinfo.processing_entry_automation_action AS action',
  'WHERE claim.workspace_id = $1 AND claim.run_id = $2',
  '  AND claim.claim_ordinal = $3',
  '  AND action.workspace_id = claim.workspace_id',
  '  AND action.run_id = claim.run_id',
  '  AND action.claim_ordinal = claim.claim_ordinal',
  '  AND keyword.workspace_id = claim.workspace_id',
  '  AND keyword.entry_id = claim.entry_id',
  "  AND keyword.origin = 'rule'",
  '  AND keyword.origin_version = action.origin_version',
);

const MARK_AUTOMATION_UNDO_PENDING_SQL = sql(
  'UPDATE struinfo.processing_entry_automation_action SET',
  "  state = 'undo_pending', result_entry_revision = $5,",
  '  result_entry_revision_id = $6, association_projection_count = NULL,',
  '  current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP,',
  '  completed_at = NULL',
  'WHERE workspace_id = $1 AND run_id = $2 AND claim_ordinal = $3',
  "  AND current_version = $4 AND state = 'applied'",
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
    EntryAutomationWorkQueueRepositoryPort,
    EntryAutomationActionRepositoryPort
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
          const actionAuthorities = await readActionAuthorities(
            client,
            initialize.workspaceId,
            canonicalUuid(existing.run_id),
          );
          return sameInitialization(
            existing,
            claims,
            actionAuthorities,
            initialize,
          )
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
          if (
            claim.route === 'advance_candidate' &&
            (advanceActionsOf(initialize).deterministicTags ||
              advanceActionsOf(initialize).rebuildAssociations)
          ) {
            expectOneAffected(
              (
                await client.query<Row>(INSERT_AUTOMATION_ACTION_SQL, [
                  initialize.workspaceId,
                  initialize.runId,
                  claim.ordinal,
                  advanceActionsOf(initialize).deterministicTags,
                  advanceActionsOf(initialize).rebuildAssociations,
                  deterministicEntryTagOriginVersion(
                    initialize.runId,
                    claim.ordinal,
                  ),
                ])
              ).rowCount,
            );
          }
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
          await client.query<Row>(CANCEL_AUTOMATION_ACTIONS_SQL, [
            settle.workspaceId,
            settle.runId,
          ]);
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

  public listRunWorkItems(
    workspaceIdInput: string,
    runIdInput: string,
  ): Promise<readonly Readonly<EntryAutomationWorkItem>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const runId = canonicalUuid(runIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_ENTRY_AUTOMATION_RUN_WORK_ITEMS_SQL,
          [workspaceId, runId],
        );
        return Object.freeze(result.rows.map(mapWorkItem));
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

  public applyAction(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      includePrivate: boolean;
      resultEntryRevisionId: string;
      keywords: readonly Readonly<EntryAutomationActionKeyword>[];
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    const value = decodeActionWrite(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => applyActionTransaction(client, value),
    );
  }

  public completeAction(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      state: 'applied' | 'undone';
      associationProjectionCount?: number;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    const value = decodeActionCompletion(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => completeActionTransaction(client, value),
    );
  }

  public beginUndo(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      includePrivate: boolean;
      resultEntryRevisionId: string;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    const value = decodeActionUndo(input);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => beginUndoTransaction(client, value),
    );
  }
}

interface DecodedActionIdentity {
  readonly workspaceId: string;
  readonly runId: string;
  readonly claimOrdinal: number;
  readonly expectedVersion: number;
}

interface DecodedActionWrite extends DecodedActionIdentity {
  readonly includePrivate: boolean;
  readonly resultEntryRevisionId: string;
  readonly keywords: readonly Readonly<EntryAutomationActionKeyword>[];
}

interface DecodedActionCompletion extends DecodedActionIdentity {
  readonly state: 'applied' | 'undone';
  readonly associationProjectionCount?: number;
}

interface DecodedActionUndo extends DecodedActionIdentity {
  readonly includePrivate: boolean;
  readonly resultEntryRevisionId: string;
}

function decodeActionIdentity(
  value: Readonly<DecodedActionIdentity>,
): DecodedActionIdentity {
  return Object.freeze({
    workspaceId: canonicalUuid(value.workspaceId),
    runId: canonicalUuid(value.runId),
    claimOrdinal: integer(value.claimOrdinal),
    expectedVersion: integer(value.expectedVersion, 1),
  });
}

function decodeActionWrite(
  value: Readonly<DecodedActionWrite>,
): DecodedActionWrite {
  const identity = decodeActionIdentity(value);
  if (typeof value.includePrivate !== 'boolean' || value.keywords.length > 32) {
    throw new PostgresAdapterError();
  }
  const normalizedValues = new Set<string>();
  const keywords = value.keywords.map((keyword) => {
    const displayValue = boundedText(keyword.displayValue, 80);
    const normalizedValue = boundedText(keyword.normalizedValue, 80);
    if (normalizedValues.has(normalizedValue)) throw new PostgresAdapterError();
    normalizedValues.add(normalizedValue);
    return Object.freeze({displayValue, normalizedValue});
  });
  return Object.freeze({
    ...identity,
    includePrivate: value.includePrivate,
    resultEntryRevisionId: canonicalUuid(value.resultEntryRevisionId),
    keywords: Object.freeze(keywords),
  });
}

function decodeActionCompletion(
  value: Readonly<DecodedActionCompletion>,
): DecodedActionCompletion {
  const identity = decodeActionIdentity(value);
  const state = enumValue(value.state, ['applied', 'undone'] as const);
  return Object.freeze({
    ...identity,
    state,
    ...(value.associationProjectionCount === undefined
      ? {}
      : {
          associationProjectionCount: integer(value.associationProjectionCount),
        }),
  });
}

function decodeActionUndo(
  value: Readonly<DecodedActionUndo>,
): DecodedActionUndo {
  const identity = decodeActionIdentity(value);
  if (typeof value.includePrivate !== 'boolean')
    throw new PostgresAdapterError();
  return Object.freeze({
    ...identity,
    includePrivate: value.includePrivate,
    resultEntryRevisionId: canonicalUuid(value.resultEntryRevisionId),
  });
}

async function applyActionTransaction(
  client: PostgresClientBoundary,
  value: Readonly<DecodedActionWrite>,
): Promise<EntryAutomationActionWriteOutcome> {
  await acquireWorkspaceWriteLock(client, value.workspaceId);
  const row = await lockActionEntry(
    client,
    value.workspaceId,
    value.runId,
    value.claimOrdinal,
  );
  if (row === undefined) return 'not_enabled';
  const state = enumValue(row.action_state, ENTRY_AUTOMATION_ACTION_STATES);
  if (integer(row.action_version, 1) !== value.expectedVersion) return 'stale';
  if (state === 'tags_applied' || state === 'applied') return 'unchanged';
  if (state !== 'pending') return 'invalid_state';
  if (
    row.run_status !== 'succeeded' ||
    row.work_state !== 'pending' ||
    row.route !== 'advance_candidate'
  ) {
    return 'invalid_state';
  }
  const isPrivate = booleanValue(row.is_private);
  if (isPrivate && !value.includePrivate) return 'not_found';
  const entryId = canonicalUuid(row.entry_id);
  const currentRevision = integer(row.current_revision, 1);
  const currentRevisionId = canonicalUuid(row.current_revision_id);
  if (
    currentRevision !== integer(row.entry_revision, 1) ||
    currentRevisionId !== canonicalUuid(row.entry_revision_id)
  ) {
    return 'stale';
  }
  if (
    !booleanValue(row.deterministic_tags_enabled) &&
    value.keywords.length > 0
  ) {
    return 'invalid_state';
  }
  const resultRevision =
    currentRevision + (value.keywords.length === 0 ? 0 : 1);
  const expectedRevisionId =
    value.keywords.length === 0
      ? currentRevisionId
      : deriveInformationEntryRevisionId(entryId, resultRevision);
  if (value.resultEntryRevisionId !== expectedRevisionId)
    return 'invalid_state';

  if (value.keywords.length > 0) {
    const maximum = await client.query<Row>(
      READ_MAXIMUM_ENTRY_KEYWORD_ORDINAL_SQL,
      [value.workspaceId, value.runId, value.claimOrdinal],
    );
    if (maximum.rows.length !== 1 || maximum.rows[0] === undefined) {
      throw new PostgresAdapterError();
    }
    const firstOrdinal = integer(maximum.rows[0].maximum_ordinal, -1) + 1;
    expectOneAffected(
      (
        await client.query<Row>(UPDATE_AUTOMATION_ENTRY_REVISION_SQL, [
          value.workspaceId,
          value.runId,
          value.claimOrdinal,
          resultRevision,
          value.resultEntryRevisionId,
          currentRevision,
          currentRevisionId,
        ])
      ).rowCount,
    );
    for (const [offset, keyword] of value.keywords.entries()) {
      expectOneAffected(
        (
          await client.query<Row>(INSERT_AUTOMATION_ENTRY_KEYWORD_SQL, [
            value.workspaceId,
            value.runId,
            value.claimOrdinal,
            firstOrdinal + offset,
            keyword.displayValue,
            keyword.normalizedValue,
          ])
        ).rowCount,
      );
    }
  }
  expectOneAffected(
    (
      await client.query<Row>(MARK_AUTOMATION_TAGS_APPLIED_SQL, [
        value.workspaceId,
        value.runId,
        value.claimOrdinal,
        value.expectedVersion,
        resultRevision,
        value.resultEntryRevisionId,
        value.keywords.length,
      ])
    ).rowCount,
  );
  return 'applied';
}

async function completeActionTransaction(
  client: PostgresClientBoundary,
  value: Readonly<DecodedActionCompletion>,
): Promise<EntryAutomationActionWriteOutcome> {
  await acquireWorkspaceWriteLock(client, value.workspaceId);
  const row = await lockActionEntry(
    client,
    value.workspaceId,
    value.runId,
    value.claimOrdinal,
  );
  if (row === undefined) return 'not_enabled';
  const currentState = enumValue(
    row.action_state,
    ENTRY_AUTOMATION_ACTION_STATES,
  );
  if (integer(row.action_version, 1) !== value.expectedVersion) return 'stale';
  if (currentState === value.state) return 'unchanged';
  if (
    (value.state === 'applied' && currentState !== 'tags_applied') ||
    (value.state === 'undone' && currentState !== 'undo_pending')
  ) {
    return 'invalid_state';
  }
  const rebuildEnabled = booleanValue(row.rebuild_associations_enabled);
  if (rebuildEnabled !== (value.associationProjectionCount !== undefined)) {
    return 'invalid_state';
  }
  expectOneAffected(
    (
      await client.query<Row>(COMPLETE_AUTOMATION_ACTION_SQL, [
        value.workspaceId,
        value.runId,
        value.claimOrdinal,
        value.expectedVersion,
        value.state,
        value.associationProjectionCount ?? null,
      ])
    ).rowCount,
  );
  return 'applied';
}

async function beginUndoTransaction(
  client: PostgresClientBoundary,
  value: Readonly<DecodedActionUndo>,
): Promise<EntryAutomationActionWriteOutcome> {
  await acquireWorkspaceWriteLock(client, value.workspaceId);
  const row = await lockActionEntry(
    client,
    value.workspaceId,
    value.runId,
    value.claimOrdinal,
  );
  if (row === undefined) return 'not_enabled';
  const state = enumValue(row.action_state, ENTRY_AUTOMATION_ACTION_STATES);
  if (integer(row.action_version, 1) !== value.expectedVersion) return 'stale';
  if (state === 'undo_pending' || state === 'undone') return 'unchanged';
  if (state !== 'applied') return 'invalid_state';
  if (booleanValue(row.is_private) && !value.includePrivate) return 'not_found';
  const entryId = canonicalUuid(row.entry_id);
  const currentRevision = integer(row.current_revision, 1);
  const currentRevisionId = canonicalUuid(row.current_revision_id);
  if (
    currentRevision !== integer(row.result_entry_revision, 1) ||
    currentRevisionId !== canonicalUuid(row.result_entry_revision_id)
  ) {
    return 'stale';
  }
  const addedTagCount = integer(row.added_tag_count);
  const resultRevision = currentRevision + (addedTagCount === 0 ? 0 : 1);
  const expectedRevisionId =
    addedTagCount === 0
      ? currentRevisionId
      : deriveInformationEntryRevisionId(entryId, resultRevision);
  if (value.resultEntryRevisionId !== expectedRevisionId)
    return 'invalid_state';
  const deleted = await client.query<Row>(
    DELETE_AUTOMATION_ENTRY_KEYWORDS_SQL,
    [value.workspaceId, value.runId, value.claimOrdinal],
  );
  if (deleted.rowCount !== addedTagCount) throw new PostgresAdapterError();
  if (addedTagCount > 0) {
    expectOneAffected(
      (
        await client.query<Row>(UPDATE_AUTOMATION_ENTRY_REVISION_SQL, [
          value.workspaceId,
          value.runId,
          value.claimOrdinal,
          resultRevision,
          value.resultEntryRevisionId,
          currentRevision,
          currentRevisionId,
        ])
      ).rowCount,
    );
  }
  expectOneAffected(
    (
      await client.query<Row>(MARK_AUTOMATION_UNDO_PENDING_SQL, [
        value.workspaceId,
        value.runId,
        value.claimOrdinal,
        value.expectedVersion,
        resultRevision,
        value.resultEntryRevisionId,
      ])
    ).rowCount,
  );
  return 'applied';
}

async function lockActionEntry(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
  claimOrdinal: number,
): Promise<Row | undefined> {
  const result = await client.query<Row>(LOCK_AUTOMATION_ACTION_ENTRY_SQL, [
    workspaceId,
    runId,
    claimOrdinal,
  ]);
  if (result.rows.length > 1) throw new PostgresAdapterError();
  return result.rows[0];
}

function booleanValue(value: unknown): boolean {
  if (value !== true && value !== false) throw new PostgresAdapterError();
  return value;
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

async function readActionAuthorities(
  client: PostgresClientBoundary,
  workspaceId: string,
  runId: string,
): Promise<readonly Row[]> {
  const result = await client.query<Row>(
    READ_ENTRY_AUTOMATION_ACTION_AUTHORITIES_SQL,
    [workspaceId, runId],
  );
  return Object.freeze([...result.rows]);
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
  const action = mapOptionalAction(row);
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
    ...(action === undefined ? {} : {action}),
  });
}

function mapOptionalAction(
  row: Row,
): Readonly<EntryAutomationAction> | undefined {
  if (
    row.deterministic_tags_enabled === null ||
    row.deterministic_tags_enabled === undefined
  ) {
    return undefined;
  }
  const resultEntryRevision =
    row.result_entry_revision === null
      ? undefined
      : integer(row.result_entry_revision, 1);
  const resultEntryRevisionId =
    row.result_entry_revision_id === null
      ? undefined
      : canonicalUuid(row.result_entry_revision_id);
  const associationProjectionCount =
    row.association_projection_count === null
      ? undefined
      : integer(row.association_projection_count);
  const completedAt = optionalTimestamp(row.action_completed_at);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    runId: canonicalUuid(row.run_id),
    claimOrdinal: integer(row.claim_ordinal),
    deterministicTagsEnabled: booleanValue(row.deterministic_tags_enabled),
    rebuildAssociationsEnabled: booleanValue(row.rebuild_associations_enabled),
    state: enumValue(row.action_state, ENTRY_AUTOMATION_ACTION_STATES),
    originVersion: boundedText(row.origin_version, 300),
    ...(resultEntryRevision === undefined ? {} : {resultEntryRevision}),
    ...(resultEntryRevisionId === undefined ? {} : {resultEntryRevisionId}),
    addedTagCount: integer(row.added_tag_count),
    ...(associationProjectionCount === undefined
      ? {}
      : {associationProjectionCount}),
    version: integer(row.action_version, 1),
    createdAt: timestamp(row.action_created_at),
    updatedAt: timestamp(row.action_updated_at),
    ...(completedAt === undefined ? {} : {completedAt}),
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
  if (
    value.advanceActions !== undefined &&
    (typeof value.advanceActions.deterministicTags !== 'boolean' ||
      typeof value.advanceActions.rebuildAssociations !== 'boolean')
  ) {
    throw new PostgresAdapterError();
  }
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
  actionAuthorities: readonly Row[],
  initialize: Readonly<EntryAutomationExecutionInitialize>,
): boolean {
  const advanceActions = advanceActionsOf(initialize);
  const expectedActionClaims = initialize.claims.filter(
    (claim) =>
      claim.route === 'advance_candidate' &&
      (advanceActions.deterministicTags || advanceActions.rebuildAssociations),
  );
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
    claims.every((claim, index) =>
      sameClaim(claim, initialize.claims[index]),
    ) &&
    actionAuthorities.length === expectedActionClaims.length &&
    actionAuthorities.every((action, index) => {
      const expected = expectedActionClaims[index];
      const expectedOrdinal = expected?.ordinal;
      return (
        expectedOrdinal !== undefined &&
        integer(action.claim_ordinal) === expectedOrdinal &&
        booleanValue(action.deterministic_tags_enabled) ===
          advanceActions.deterministicTags &&
        booleanValue(action.rebuild_associations_enabled) ===
          advanceActions.rebuildAssociations &&
        boundedText(action.origin_version, 300) ===
          deterministicEntryTagOriginVersion(initialize.runId, expectedOrdinal)
      );
    })
  );
}

function advanceActionsOf(
  value: Readonly<EntryAutomationExecutionInitialize>,
): Readonly<{deterministicTags: boolean; rebuildAssociations: boolean}> {
  return (
    value.advanceActions ??
    Object.freeze({deterministicTags: false, rebuildAssociations: false})
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

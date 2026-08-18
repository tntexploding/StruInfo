import {
  EPISTEMIC_ROLES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_REVIEW_STATES,
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
  type KnowledgeChangeEventState,
  type KnowledgeChangeSetInsert,
  type KnowledgeCurrentPointerCas,
  type KnowledgeItemIdentityInsert,
  type KnowledgeRelationIdentityInsert,
  type KnowledgeRelationRevisionInsert,
  type KnowledgeRevisionInsert,
  type KnowledgeRevisionFragmentInputInsert,
  type KnowledgeRevisionItemInputInsert,
  type KnowledgeRevisionRelationInputInsert,
  type LockedManualKnowledgeSnapshotQuery,
  type ManualKnowledgeRepositoryPort,
  type ManualKnowledgeRepositorySnapshot,
  type ManualKnowledgeTransactionPort,
  type RelationRevisionFragmentInputInsert,
  type RelationRevisionItemInputInsert,
  type RelationRevisionRelationInputInsert,
  type StoredKnowledgeChangeOperationState,
} from '../../../modules/knowledge/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  compareText,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

export const READ_KNOWLEDGE_CHANGE_SET_SQL = `SELECT
  workspace_id::text, change_set_id::text, command_idempotency_key,
  request_sha256, authorization_kind, target_id::text, decision_id::text,
  decision_revision, decision_revision_id::text, original_outcome,
  operation_count
FROM struinfo.knowledge_change_set
WHERE workspace_id = $1 AND command_idempotency_key = $2` as const;

const LOCK_ITEMS_SQL = `SELECT item_id::text
FROM struinfo.knowledge_item
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id
FOR UPDATE`;
const LOCK_RELATIONS_SQL = `SELECT relation_id::text
FROM struinfo.knowledge_relation
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id
FOR UPDATE`;
const LOCK_CURATION_TARGET_SQL = `SELECT target_id::text
FROM struinfo.curation_target
WHERE workspace_id = $1 AND target_id = $2
FOR UPDATE`;
const LOCK_INTAKE_DECISION_SQL = `SELECT decision_id::text
FROM struinfo.intake_decision
WHERE workspace_id = $1 AND target_id = $2
ORDER BY decision_id
FOR UPDATE`;

const READ_CHANGE_OPERATIONS_SQL = `SELECT
  workspace_id::text, change_set_id::text, operation_index, operation_kind,
  item_id::text, relation_id::text, operation_outcome,
  resulting_revision, resulting_revision_id::text
FROM struinfo.knowledge_change_operation
WHERE workspace_id = $1 AND change_set_id = $2
ORDER BY operation_index`;
const READ_CHANGE_EVENT_SQL = `SELECT
  workspace_id::text, event_id::text, event_kind, event_schema_version,
  change_set_id::text
FROM struinfo.knowledge_change_event
WHERE workspace_id = $1 AND change_set_id = $2
ORDER BY event_id`;
const READ_ITEMS_SQL = `SELECT
  workspace_id::text, item_id::text, current_revision,
  current_revision_id::text
FROM struinfo.knowledge_item
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id`;
const READ_REVISIONS_SQL = `SELECT
  workspace_id::text, item_id::text, revision_number, revision_id::text,
  previous_revision_id::text, knowledge_kind, epistemic_role, review_state,
  title, body, is_private
FROM struinfo.knowledge_revision
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id, revision_number`;
const READ_RELATIONS_SQL = `SELECT
  workspace_id::text, relation_id::text, subject_item_id::text,
  relation_type_key, object_item_id::text, current_revision,
  current_revision_id::text
FROM struinfo.knowledge_relation
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id`;
const READ_RELATION_REVISIONS_SQL = `SELECT
  workspace_id::text, relation_id::text, revision_number, revision_id::text,
  previous_revision_id::text, subject_item_id::text, relation_type_key,
  object_item_id::text, epistemic_role, review_state, qualifier, is_private
FROM struinfo.knowledge_relation_revision
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id, revision_number`;
const READ_FRAGMENTS_SQL = `SELECT
  f.workspace_id::text, f.resource_id::text, f.snapshot_id::text,
  f.fragment_id::text, f.selected_text_sha256, r.is_private
FROM struinfo.fragment AS f
JOIN struinfo.resource AS r
  ON r.workspace_id = f.workspace_id AND r.resource_id = f.resource_id
WHERE f.workspace_id = $1 AND f.fragment_id = ANY($2::uuid[])
ORDER BY f.fragment_id`;
const READ_CURATION_AUTHORIZATION_SQL = `SELECT
  t.workspace_id::text, t.target_id::text, t.target_kind,
  t.resource_id::text, t.snapshot_id::text, t.fragment_id::text,
  d.decision_id::text, d.current_revision,
  d.current_decision_revision_id::text,
  r.intake_action
FROM struinfo.curation_target AS t
LEFT JOIN struinfo.intake_decision AS d
  ON d.workspace_id = t.workspace_id AND d.target_id = t.target_id
LEFT JOIN struinfo.intake_decision_revision AS r
  ON r.workspace_id = d.workspace_id
 AND r.decision_id = d.decision_id
 AND r.revision_number = d.current_revision
 AND r.decision_revision_id = d.current_decision_revision_id
WHERE t.workspace_id = $1 AND t.target_id = $2`;

const READ_ITEM_FRAGMENT_INPUTS_SQL = `SELECT workspace_id::text, item_id::text,
  revision_number, revision_id::text, input_kind, input_ordinal,
  fragment_id::text
FROM struinfo.knowledge_revision_fragment_input
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id, revision_number, input_kind, input_ordinal`;
const READ_ITEM_ITEM_INPUTS_SQL = `SELECT workspace_id::text, item_id::text,
  revision_number, revision_id::text, input_ordinal, input_item_id::text,
  input_revision_number, input_revision_id::text
FROM struinfo.knowledge_revision_item_input
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id, revision_number, input_ordinal`;
const READ_ITEM_RELATION_INPUTS_SQL = `SELECT workspace_id::text, item_id::text,
  revision_number, revision_id::text, input_ordinal, input_relation_id::text,
  input_revision_number, input_revision_id::text
FROM struinfo.knowledge_revision_relation_input
WHERE workspace_id = $1 AND item_id = ANY($2::uuid[])
ORDER BY item_id, revision_number, input_ordinal`;
const READ_RELATION_FRAGMENT_INPUTS_SQL = `SELECT workspace_id::text,
  relation_id::text, revision_number, revision_id::text, input_kind,
  input_ordinal, fragment_id::text
FROM struinfo.relation_revision_fragment_input
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id, revision_number, input_kind, input_ordinal`;
const READ_RELATION_ITEM_INPUTS_SQL = `SELECT workspace_id::text,
  relation_id::text, revision_number, revision_id::text, input_ordinal,
  input_item_id::text, input_revision_number, input_revision_id::text
FROM struinfo.relation_revision_item_input
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id, revision_number, input_ordinal`;
const READ_RELATION_RELATION_INPUTS_SQL = `SELECT workspace_id::text,
  relation_id::text, revision_number, revision_id::text, input_ordinal,
  input_relation_id::text, input_revision_number, input_revision_id::text
FROM struinfo.relation_revision_relation_input
WHERE workspace_id = $1 AND relation_id = ANY($2::uuid[])
ORDER BY relation_id, revision_number, input_ordinal`;

type Row = Readonly<Record<string, unknown>>;

export class PostgresManualKnowledgeRepository implements ManualKnowledgeRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public runCommandTransaction<Value>(
    work: (transaction: ManualKnowledgeTransactionPort) => Promise<Value>,
  ): Promise<Value> {
    return runPostgresTransaction(this.#pool, 'read_committed', (client) =>
      work(new PostgresManualKnowledgeTransaction(client)),
    );
  }
}

class PostgresManualKnowledgeTransaction implements ManualKnowledgeTransactionPort {
  readonly #client: PostgresClientBoundary;

  public constructor(client: PostgresClientBoundary) {
    this.#client = client;
  }

  public async lockAndLoadManualKnowledgeSnapshot(
    query: LockedManualKnowledgeSnapshotQuery,
  ): Promise<ManualKnowledgeRepositorySnapshot> {
    await acquireWorkspaceWriteLock(this.#client, query.workspaceId);
    const stored = await this.#client.query<Row>(
      READ_KNOWLEDGE_CHANGE_SET_SQL,
      [query.workspaceId, query.commandIdempotencyKey],
    );
    if (stored.rows.length > 1) throw new PostgresAdapterError();
    if (stored.rows[0] !== undefined) {
      return this.#loadStoredCommand(query.workspaceId, stored.rows[0]);
    }

    await this.#lockIds(
      LOCK_ITEMS_SQL,
      query.workspaceId,
      query.primaryItemIds,
    );
    await this.#lockIds(
      LOCK_RELATIONS_SQL,
      query.workspaceId,
      query.primaryRelationIds,
    );
    const primaryItems = new Set(query.primaryItemIds);
    await this.#lockIds(
      LOCK_ITEMS_SQL,
      query.workspaceId,
      query.endpointItemIds.filter((id) => !primaryItems.has(id)),
    );
    if (query.authorization.kind === 'eligible_target') {
      const targetId = await this.#findAuthorizationTarget(query);
      if (targetId !== undefined) {
        await this.#client.query(LOCK_CURATION_TARGET_SQL, [
          query.workspaceId,
          targetId,
        ]);
        await this.#client.query(LOCK_INTAKE_DECISION_SQL, [
          query.workspaceId,
          targetId,
        ]);
      }
    }
    return this.#loadNewCommand(query);
  }

  async #lockIds(sql: string, workspaceId: string, ids: readonly string[]) {
    const uniqueIds = uniqueSorted(ids);
    if (uniqueIds.length > 0)
      await this.#client.query(sql, [workspaceId, uniqueIds]);
  }

  async #findAuthorizationTarget(
    query: LockedManualKnowledgeSnapshotQuery,
  ): Promise<string | undefined> {
    if (query.authorization.kind !== 'eligible_target') return undefined;
    const sql =
      query.authorization.target.kind === 'snapshot'
        ? `SELECT target_id::text FROM struinfo.curation_target
WHERE workspace_id = $1 AND snapshot_id = $2`
        : `SELECT target_id::text FROM struinfo.curation_target
WHERE workspace_id = $1 AND fragment_id = $2`;
    const id =
      query.authorization.target.kind === 'snapshot'
        ? query.authorization.target.snapshotId
        : query.authorization.target.fragmentId;
    const result = await this.#client.query<Row>(sql, [query.workspaceId, id]);
    if (result.rows.length > 1) throw new PostgresAdapterError();
    return result.rows[0] === undefined
      ? undefined
      : canonicalUuid(result.rows[0].target_id);
  }

  async #loadStoredCommand(
    workspaceId: string,
    stored: Row,
  ): Promise<ManualKnowledgeRepositorySnapshot> {
    const changeSet = mapChangeSet(stored);
    const operations = await this.#client.query<Row>(
      READ_CHANGE_OPERATIONS_SQL,
      [workspaceId, changeSet.changeSetId],
    );
    const events = await this.#client.query<Row>(READ_CHANGE_EVENT_SQL, [
      workspaceId,
      changeSet.changeSetId,
    ]);
    return Object.freeze({
      curationTargets: Object.freeze([]),
      intakeDecisions: Object.freeze([]),
      fragments: Object.freeze([]),
      items: Object.freeze([]),
      revisions: Object.freeze([]),
      relations: Object.freeze([]),
      relationRevisions: Object.freeze([]),
      changeSets: Object.freeze([changeSet]),
      changeOperations: Object.freeze(operations.rows.map(mapChangeOperation)),
      changeEvents: Object.freeze(events.rows.map(mapChangeEvent)),
    });
  }

  async #loadNewCommand(
    query: LockedManualKnowledgeSnapshotQuery,
  ): Promise<ManualKnowledgeRepositorySnapshot> {
    const itemIds = uniqueSorted([
      ...query.primaryItemIds,
      ...query.endpointItemIds,
      ...query.historicalItemRevisions.map((row) => row.itemId),
    ]);
    const relationIds = uniqueSorted([
      ...query.primaryRelationIds,
      ...query.historicalRelationRevisions.map((row) => row.relationId),
    ]);
    const fragments = await this.#client.query<Row>(READ_FRAGMENTS_SQL, [
      query.workspaceId,
      query.fragmentIds,
    ]);
    const items = await this.#client.query<Row>(READ_ITEMS_SQL, [
      query.workspaceId,
      itemIds,
    ]);
    const rawRevisions = await this.#client.query<Row>(READ_REVISIONS_SQL, [
      query.workspaceId,
      itemIds,
    ]);
    const relations = await this.#client.query<Row>(READ_RELATIONS_SQL, [
      query.workspaceId,
      relationIds,
    ]);
    const rawRelationRevisions = await this.#client.query<Row>(
      READ_RELATION_REVISIONS_SQL,
      [query.workspaceId, relationIds],
    );
    const itemFragments = await this.#client.query<Row>(
      READ_ITEM_FRAGMENT_INPUTS_SQL,
      [query.workspaceId, itemIds],
    );
    const itemItems = await this.#client.query<Row>(READ_ITEM_ITEM_INPUTS_SQL, [
      query.workspaceId,
      itemIds,
    ]);
    const itemRelations = await this.#client.query<Row>(
      READ_ITEM_RELATION_INPUTS_SQL,
      [query.workspaceId, itemIds],
    );
    const relationFragments = await this.#client.query<Row>(
      READ_RELATION_FRAGMENT_INPUTS_SQL,
      [query.workspaceId, relationIds],
    );
    const relationItems = await this.#client.query<Row>(
      READ_RELATION_ITEM_INPUTS_SQL,
      [query.workspaceId, relationIds],
    );
    const relationRelations = await this.#client.query<Row>(
      READ_RELATION_RELATION_INPUTS_SQL,
      [query.workspaceId, relationIds],
    );
    const mappedItems = items.rows.map(mapItem);
    const mappedRelations = relations.rows.map(mapRelation);
    const itemRevisionKeys = new Set(
      query.historicalItemRevisions.map((row) =>
        revisionKey(row.itemId, row.revision),
      ),
    );
    for (const item of mappedItems)
      itemRevisionKeys.add(revisionKey(item.itemId, item.currentRevision));
    const relationRevisionKeys = new Set(
      query.historicalRelationRevisions.map((row) =>
        revisionKey(row.relationId, row.revision),
      ),
    );
    for (const relation of mappedRelations)
      relationRevisionKeys.add(
        revisionKey(relation.relationId, relation.currentRevision),
      );
    const revisions = rawRevisions.rows
      .filter((row) =>
        itemRevisionKeys.has(
          revisionKey(
            canonicalUuid(row.item_id),
            integer(row.revision_number, 1),
          ),
        ),
      )
      .map((row) =>
        mapItemRevision(
          row,
          itemFragments.rows,
          itemItems.rows,
          itemRelations.rows,
        ),
      );
    const relationRevisions = rawRelationRevisions.rows
      .filter((row) =>
        relationRevisionKeys.has(
          revisionKey(
            canonicalUuid(row.relation_id),
            integer(row.revision_number, 1),
          ),
        ),
      )
      .map((row) =>
        mapRelationRevision(
          row,
          relationFragments.rows,
          relationItems.rows,
          relationRelations.rows,
        ),
      );
    const authorization = await this.#loadAuthorization(query);
    return Object.freeze({
      ...authorization,
      fragments: Object.freeze(fragments.rows.map(mapFragment)),
      items: Object.freeze(mappedItems),
      revisions: Object.freeze(revisions),
      relations: Object.freeze(mappedRelations),
      relationRevisions: Object.freeze(relationRevisions),
      changeSets: Object.freeze([]),
      changeOperations: Object.freeze([]),
      changeEvents: Object.freeze([]),
    });
  }

  async #loadAuthorization(query: LockedManualKnowledgeSnapshotQuery) {
    if (query.authorization.kind === 'manual_edit')
      return {
        curationTargets: Object.freeze([]),
        intakeDecisions: Object.freeze([]),
      };
    const targetId = await this.#findAuthorizationTarget(query);
    if (targetId === undefined)
      return {
        curationTargets: Object.freeze([]),
        intakeDecisions: Object.freeze([]),
      };
    const result = await this.#client.query<Row>(
      READ_CURATION_AUTHORIZATION_SQL,
      [query.workspaceId, targetId],
    );
    if (result.rows.length > 1) throw new PostgresAdapterError();
    const row = result.rows[0];
    if (row === undefined)
      return {
        curationTargets: Object.freeze([]),
        intakeDecisions: Object.freeze([]),
      };
    const kind = enumValue(row.target_kind, ['snapshot', 'fragment'] as const);
    const target =
      kind === 'snapshot'
        ? Object.freeze({
            workspaceId: canonicalUuid(row.workspace_id),
            targetId: canonicalUuid(row.target_id),
            kind,
            resourceId: canonicalUuid(row.resource_id),
            snapshotId: canonicalUuid(row.snapshot_id),
          })
        : Object.freeze({
            workspaceId: canonicalUuid(row.workspace_id),
            targetId: canonicalUuid(row.target_id),
            kind,
            fragmentId: canonicalUuid(row.fragment_id),
          });
    const decisions =
      row.decision_id === null
        ? []
        : [
            Object.freeze({
              workspaceId: canonicalUuid(row.workspace_id),
              targetId: target.targetId,
              decisionId: canonicalUuid(row.decision_id),
              currentRevision: integer(row.current_revision, 1),
              currentRevisionId: canonicalUuid(
                row.current_decision_revision_id,
              ),
              action: enumValue(row.intake_action, [
                'full',
                'split',
                'condense',
                'source_only',
                'ignore',
                'needs_review',
              ] as const),
            }),
          ];
    return {
      curationTargets: Object.freeze([target]),
      intakeDecisions: Object.freeze(decisions),
    };
  }

  public insertKnowledgeChangeSet(
    row: KnowledgeChangeSetInsert,
  ): Promise<void> {
    const auth = row.authorization;
    return this.#insert(
      `INSERT INTO struinfo.knowledge_change_set
(workspace_id, change_set_id, command_idempotency_key, request_sha256, command_kind, authority, operation_origin, authorization_kind, target_id, decision_id, decision_revision, decision_revision_id, original_outcome, operation_count)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        row.workspaceId,
        row.changeSetId,
        row.commandIdempotencyKey,
        row.requestSha256,
        row.commandKind,
        row.authority,
        row.operationOrigin,
        auth.kind,
        auth.kind === 'eligible_target' ? auth.targetId : null,
        auth.kind === 'eligible_target' ? auth.decisionId : null,
        auth.kind === 'eligible_target' ? auth.decisionRevision : null,
        auth.kind === 'eligible_target' ? auth.decisionRevisionId : null,
        row.originalOutcome,
        row.operationCount,
      ],
    );
  }

  public insertKnowledgeChangeOperation(
    row: StoredKnowledgeChangeOperationState,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_change_operation
(workspace_id, change_set_id, operation_index, operation_kind, item_id, relation_id, operation_outcome, resulting_revision, resulting_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.workspaceId,
        row.changeSetId,
        row.operationIndex,
        row.operationKind,
        row.operationKind === 'put_item' ? row.itemId : null,
        row.operationKind === 'put_relation' ? row.relationId : null,
        row.outcome,
        row.resultingRevision,
        row.resultingRevisionId,
      ],
    );
  }

  public insertKnowledgeItem(row: KnowledgeItemIdentityInsert): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_item
(workspace_id, item_id, current_revision, current_revision_id)
VALUES ($1, $2, $3, $4)`,
      [row.workspaceId, row.itemId, row.currentRevision, row.currentRevisionId],
    );
  }

  public insertKnowledgeRevision(row: KnowledgeRevisionInsert): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_revision
(workspace_id, item_id, revision_id, revision_number, knowledge_kind, epistemic_role, review_state, title, body, change_set_id, operation_index, previous_revision_id, is_private)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.workspaceId,
        row.itemId,
        row.revisionId,
        row.revision,
        row.value.knowledgeKind,
        row.value.epistemicRole,
        row.value.reviewState,
        row.value.title,
        row.value.body ?? null,
        row.changeSetId,
        row.operationIndex,
        row.previousRevisionId ?? null,
        row.isPrivate === true,
      ],
    );
  }

  public async compareAndSetKnowledgeItemCurrent(
    change: KnowledgeCurrentPointerCas,
  ): Promise<void> {
    const result = await this.#client.executeSimple(
      `UPDATE struinfo.knowledge_item
SET current_revision = $4, current_revision_id = $5
WHERE workspace_id = $1 AND item_id = $2 AND current_revision = $3`,
      [
        change.workspaceId,
        change.stableId,
        change.expectedRevision,
        change.nextRevision,
        change.nextRevisionId,
      ],
    );
    expectOneAffected(result.rowCount);
  }

  public insertKnowledgeRelation(
    row: KnowledgeRelationIdentityInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_relation
(workspace_id, relation_id, subject_item_id, relation_type_key, object_item_id, current_revision, current_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspaceId,
        row.relationId,
        row.subjectItemId,
        row.relationTypeKey,
        row.objectItemId,
        row.currentRevision,
        row.currentRevisionId,
      ],
    );
  }

  public insertKnowledgeRelationRevision(
    row: KnowledgeRelationRevisionInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_relation_revision
(workspace_id, relation_id, revision_id, revision_number, subject_item_id, relation_type_key, object_item_id, epistemic_role, review_state, qualifier, change_set_id, operation_index, previous_revision_id, is_private)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        row.workspaceId,
        row.relationId,
        row.revisionId,
        row.revision,
        row.value.subjectItemId,
        row.value.relationTypeKey,
        row.value.objectItemId,
        row.value.epistemicRole,
        row.value.reviewState,
        row.value.qualifier ?? null,
        row.changeSetId,
        row.operationIndex,
        row.previousRevisionId ?? null,
        row.isPrivate === true,
      ],
    );
  }

  public async compareAndSetKnowledgeRelationCurrent(
    change: KnowledgeCurrentPointerCas,
  ): Promise<void> {
    const result = await this.#client.executeSimple(
      `UPDATE struinfo.knowledge_relation
SET current_revision = $4, current_revision_id = $5
WHERE workspace_id = $1 AND relation_id = $2 AND current_revision = $3`,
      [
        change.workspaceId,
        change.stableId,
        change.expectedRevision,
        change.nextRevision,
        change.nextRevisionId,
      ],
    );
    expectOneAffected(result.rowCount);
  }

  public insertKnowledgeRevisionFragmentInput(
    row: KnowledgeRevisionFragmentInputInsert,
  ): Promise<void> {
    return this.#insertItemFragment('knowledge_revision_fragment_input', row);
  }
  public insertRelationRevisionFragmentInput(
    row: RelationRevisionFragmentInputInsert,
  ): Promise<void> {
    return this.#insertRelationFragment(
      'relation_revision_fragment_input',
      row,
    );
  }

  public insertKnowledgeRevisionItemInput(
    row: KnowledgeRevisionItemInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_revision_item_input
(workspace_id, item_id, revision_number, revision_id, input_ordinal, input_item_id, input_revision_number, input_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.itemId,
        row.revision,
        row.revisionId,
        row.inputOrdinal,
        row.inputItemId,
        row.inputRevision,
        row.inputRevisionId,
      ],
    );
  }

  public insertKnowledgeRevisionRelationInput(
    row: KnowledgeRevisionRelationInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_revision_relation_input
(workspace_id, item_id, revision_number, revision_id, input_ordinal, input_relation_id, input_revision_number, input_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.itemId,
        row.revision,
        row.revisionId,
        row.inputOrdinal,
        row.inputRelationId,
        row.inputRevision,
        row.inputRevisionId,
      ],
    );
  }

  public insertRelationRevisionItemInput(
    row: RelationRevisionItemInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.relation_revision_item_input
(workspace_id, relation_id, revision_number, revision_id, input_ordinal, input_item_id, input_revision_number, input_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.relationId,
        row.revision,
        row.revisionId,
        row.inputOrdinal,
        row.inputItemId,
        row.inputRevision,
        row.inputRevisionId,
      ],
    );
  }

  public insertRelationRevisionRelationInput(
    row: RelationRevisionRelationInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.relation_revision_relation_input
(workspace_id, relation_id, revision_number, revision_id, input_ordinal, input_relation_id, input_revision_number, input_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.relationId,
        row.revision,
        row.revisionId,
        row.inputOrdinal,
        row.inputRelationId,
        row.inputRevision,
        row.inputRevisionId,
      ],
    );
  }

  public insertKnowledgeChangeEvent(
    row: KnowledgeChangeEventState,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.knowledge_change_event
(workspace_id, event_id, event_kind, event_schema_version, change_set_id)
VALUES ($1, $2, $3, $4, $5)`,
      [
        row.workspaceId,
        row.eventId,
        row.eventKind,
        row.eventSchemaVersion,
        row.changeSetId,
      ],
    );
  }

  #insertItemFragment(
    table: 'knowledge_revision_fragment_input',
    row: KnowledgeRevisionFragmentInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.${table}
(workspace_id, item_id, revision_number, revision_id, input_kind, input_ordinal, fragment_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspaceId,
        row.itemId,
        row.revision,
        row.revisionId,
        row.inputKind,
        row.inputOrdinal,
        row.fragmentId,
      ],
    );
  }

  #insertRelationFragment(
    table: 'relation_revision_fragment_input',
    row: RelationRevisionFragmentInputInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.${table}
(workspace_id, relation_id, revision_number, revision_id, input_kind, input_ordinal, fragment_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspaceId,
        row.relationId,
        row.revision,
        row.revisionId,
        row.inputKind,
        row.inputOrdinal,
        row.fragmentId,
      ],
    );
  }

  async #insert(sql: string, parameters: readonly unknown[]): Promise<void> {
    const result = await this.#client.executeSimple(sql, parameters);
    expectOneAffected(result.rowCount);
  }
}

function mapChangeSet(row: Row) {
  const kind = enumValue(row.authorization_kind, [
    'manual_edit',
    'eligible_target',
  ] as const);
  const authorization =
    kind === 'manual_edit'
      ? Object.freeze({kind})
      : Object.freeze({
          kind,
          targetId: canonicalUuid(row.target_id),
          decisionId: canonicalUuid(row.decision_id),
          decisionRevision: integer(row.decision_revision, 1),
          decisionRevisionId: canonicalUuid(row.decision_revision_id),
        });
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    commandIdempotencyKey: text(row.command_idempotency_key),
    changeSetId: canonicalUuid(row.change_set_id),
    requestSha256: sha256(row.request_sha256),
    authorization,
    originalOutcome: enumValue(row.original_outcome, [
      'applied',
      'unchanged',
    ] as const),
    operationCount: integer(row.operation_count, 1),
  });
}

function mapChangeOperation(row: Row): StoredKnowledgeChangeOperationState {
  const common = {
    workspaceId: canonicalUuid(row.workspace_id),
    changeSetId: canonicalUuid(row.change_set_id),
    operationIndex: integer(
      row.operation_index,
      0,
    ) as StoredKnowledgeChangeOperationState['operationIndex'],
    outcome: enumValue(row.operation_outcome, [
      'applied',
      'unchanged',
    ] as const),
    resultingRevision: integer(row.resulting_revision, 1),
    resultingRevisionId: canonicalUuid(row.resulting_revision_id),
  };
  const kind = enumValue(row.operation_kind, [
    'put_item',
    'put_relation',
  ] as const);
  return kind === 'put_item'
    ? Object.freeze({
        ...common,
        operationKind: kind,
        itemId: canonicalUuid(row.item_id),
      })
    : Object.freeze({
        ...common,
        operationKind: kind,
        relationId: canonicalUuid(row.relation_id),
      });
}

function mapChangeEvent(row: Row): KnowledgeChangeEventState {
  const schema = integer(row.event_schema_version, 1);
  if (schema !== 1) throw new PostgresAdapterError();
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    eventId: canonicalUuid(row.event_id),
    eventKind: enumValue(row.event_kind, [
      'knowledge_change_set_committed',
    ] as const),
    eventSchemaVersion: 1,
    changeSetId: canonicalUuid(row.change_set_id),
  });
}

function mapItem(row: Row) {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    itemId: canonicalUuid(row.item_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
  });
}
function mapRelation(row: Row) {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    relationId: canonicalUuid(row.relation_id),
    subjectItemId: canonicalUuid(row.subject_item_id),
    relationTypeKey: text(row.relation_type_key),
    objectItemId: canonicalUuid(row.object_item_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
  });
}
function mapFragment(row: Row) {
  const isPrivate = postgresBoolean(row.is_private);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    resourceId: canonicalUuid(row.resource_id),
    snapshotId: canonicalUuid(row.snapshot_id),
    fragmentId: canonicalUuid(row.fragment_id),
    selectedTextSha256: sha256(row.selected_text_sha256),
    ...(isPrivate ? {isPrivate: true as const} : {}),
  });
}

function mapItemRevision(
  row: Row,
  fragmentRows: readonly Row[],
  itemRows: readonly Row[],
  relationRows: readonly Row[],
) {
  const workspaceId = canonicalUuid(row.workspace_id);
  const itemId = canonicalUuid(row.item_id);
  const revision = integer(row.revision_number, 1);
  const revisionId = canonicalUuid(row.revision_id);
  const previousRevisionId =
    row.previous_revision_id === null
      ? undefined
      : canonicalUuid(row.previous_revision_id);
  const body = optionalText(row.body);
  const isPrivate = postgresBoolean(row.is_private);
  return Object.freeze({
    workspaceId,
    itemId,
    revision,
    revisionId,
    ...(previousRevisionId === undefined ? {} : {previousRevisionId}),
    value: Object.freeze({
      knowledgeKind: enumValue(row.knowledge_kind, KNOWLEDGE_KINDS),
      epistemicRole: enumValue(row.epistemic_role, EPISTEMIC_ROLES),
      reviewState: enumValue(row.review_state, KNOWLEDGE_REVIEW_STATES),
      title: text(row.title),
      ...(body === undefined ? {} : {body}),
    }),
    provenance: provenanceFor(
      'item',
      workspaceId,
      itemId,
      revision,
      revisionId,
      fragmentRows,
      itemRows,
      relationRows,
    ),
    ...(isPrivate ? {isPrivate: true as const} : {}),
  });
}

function mapRelationRevision(
  row: Row,
  fragmentRows: readonly Row[],
  itemRows: readonly Row[],
  relationRows: readonly Row[],
) {
  const workspaceId = canonicalUuid(row.workspace_id);
  const relationId = canonicalUuid(row.relation_id);
  const revision = integer(row.revision_number, 1);
  const revisionId = canonicalUuid(row.revision_id);
  const previousRevisionId =
    row.previous_revision_id === null
      ? undefined
      : canonicalUuid(row.previous_revision_id);
  const qualifier = optionalText(row.qualifier);
  const isPrivate = postgresBoolean(row.is_private);
  return Object.freeze({
    workspaceId,
    relationId,
    revision,
    revisionId,
    ...(previousRevisionId === undefined ? {} : {previousRevisionId}),
    value: Object.freeze({
      subjectItemId: canonicalUuid(row.subject_item_id),
      relationTypeKey: text(row.relation_type_key),
      objectItemId: canonicalUuid(row.object_item_id),
      epistemicRole: enumValue(row.epistemic_role, [
        'source_claim',
        'summary',
        'inference',
        'user_assertion',
      ] as const),
      reviewState: enumValue(row.review_state, KNOWLEDGE_REVIEW_STATES),
      ...(qualifier === undefined ? {} : {qualifier}),
    }),
    provenance: provenanceFor(
      'relation',
      workspaceId,
      relationId,
      revision,
      revisionId,
      fragmentRows,
      itemRows,
      relationRows,
    ),
    ...(isPrivate ? {isPrivate: true as const} : {}),
  });
}

function postgresBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new PostgresAdapterError();
  return value;
}

function provenanceFor(
  kind: 'item' | 'relation',
  workspaceId: string,
  id: string,
  revision: number,
  revisionId: string,
  fragmentRows: readonly Row[],
  itemRows: readonly Row[],
  relationRows: readonly Row[],
) {
  const idColumn = kind === 'item' ? 'item_id' : 'relation_id';
  const fragments = fragmentRows.filter(
    (row) => row[idColumn] === id && row.revision_number === revision,
  );
  const citations = orderedInputRows(
    fragments.filter((row) => row.input_kind === 'citation'),
    (row) => row,
  );
  const fragmentDerivations = orderedInputRows(
    fragments.filter((row) => row.input_kind === 'derivation'),
    (row) => row,
  );
  if (citations.length + fragmentDerivations.length !== fragments.length) {
    throw new PostgresAdapterError();
  }
  for (const input of [...citations, ...fragmentDerivations]) {
    assertInputOwner(input, workspaceId, idColumn, id, revision, revisionId);
  }
  const citationIds = citations.map((row) => canonicalUuid(row.fragment_id));
  const fragmentDerivationIds = fragmentDerivations.map((row) =>
    canonicalUuid(row.fragment_id),
  );
  const knowledgeDerivations = orderedInputRows(
    [
      ...itemRows
        .filter(
          (row) => row[idColumn] === id && row.revision_number === revision,
        )
        .map((row) => ({row, kind: 'item' as const})),
      ...relationRows
        .filter(
          (row) => row[idColumn] === id && row.revision_number === revision,
        )
        .map((row) => ({row, kind: 'relation' as const})),
    ],
    (entry) => entry.row,
  ).map(({row, kind: inputKind}) =>
    inputKind === 'item'
      ? mapItemDerivation(row, workspaceId, idColumn, id, revision, revisionId)
      : mapRelationDerivation(
          row,
          workspaceId,
          idColumn,
          id,
          revision,
          revisionId,
        ),
  );
  return Object.freeze({
    citations: Object.freeze(citationIds),
    fragmentDerivations: Object.freeze(fragmentDerivationIds),
    knowledgeDerivations: Object.freeze(knowledgeDerivations),
  });
}

function byOrdinal(left: Row, right: Row) {
  return integer(left.input_ordinal, 0) - integer(right.input_ordinal, 0);
}

function orderedInputRows<Value>(
  rows: readonly Value[],
  project: (value: Value) => Row,
): readonly Value[] {
  const ordered = [...rows].sort((left, right) =>
    byOrdinal(project(left), project(right)),
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const value = ordered[index];
    if (
      value === undefined ||
      integer(project(value).input_ordinal, 0) !== index
    ) {
      throw new PostgresAdapterError();
    }
  }
  return ordered;
}

function assertInputOwner(
  row: Row,
  workspaceId: string,
  idColumn: 'item_id' | 'relation_id',
  id: string,
  revision: number,
  revisionId: string,
): void {
  if (
    canonicalUuid(row.workspace_id) !== workspaceId ||
    canonicalUuid(row[idColumn]) !== id ||
    integer(row.revision_number, 1) !== revision ||
    canonicalUuid(row.revision_id) !== revisionId
  ) {
    throw new PostgresAdapterError();
  }
}

function mapItemDerivation(
  row: Row,
  workspaceId: string,
  idColumn: 'item_id' | 'relation_id',
  id: string,
  outputRevision: number,
  revisionId: string,
) {
  assertInputOwner(row, workspaceId, idColumn, id, outputRevision, revisionId);
  const itemId = canonicalUuid(row.input_item_id);
  const revision = integer(row.input_revision_number, 1);
  if (
    canonicalUuid(row.input_revision_id) !==
    deriveKnowledgeItemRevisionId(itemId, revision)
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({kind: 'item' as const, itemId, revision});
}

function mapRelationDerivation(
  row: Row,
  workspaceId: string,
  idColumn: 'item_id' | 'relation_id',
  id: string,
  outputRevision: number,
  revisionId: string,
) {
  assertInputOwner(row, workspaceId, idColumn, id, outputRevision, revisionId);
  const relationId = canonicalUuid(row.input_relation_id);
  const revision = integer(row.input_revision_number, 1);
  if (
    canonicalUuid(row.input_revision_id) !==
    deriveKnowledgeRelationRevisionId(relationId, revision)
  ) {
    throw new PostgresAdapterError();
  }
  return Object.freeze({kind: 'relation' as const, relationId, revision});
}
function revisionKey(id: string, revision: number) {
  return `${id}:${String(revision)}`;
}
function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort(compareText);
}

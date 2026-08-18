import {
  EPISTEMIC_ROLES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_REVIEW_STATES,
  type DeterministicKnowledgeSearchRepositoryPort,
  type DeterministicKnowledgeSearchSnapshot,
  type KnowledgeSearchFragmentInputState,
  type KnowledgeSearchItemState,
  type KnowledgeSearchRelationRevisionState,
  type KnowledgeSearchRelationState,
  type KnowledgeSearchRevisionState,
} from '../../../modules/knowledge/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  integer,
  optionalText,
  text,
} from './postgres_values.js';

export const READ_CURRENT_SEARCH_ITEMS_SQL = `SELECT
  i.workspace_id::text, i.item_id::text, i.current_revision,
  i.current_revision_id::text
FROM struinfo.knowledge_item AS i
JOIN struinfo.knowledge_revision AS r
  ON r.workspace_id = i.workspace_id
 AND r.item_id = i.item_id
 AND r.revision_number = i.current_revision
 AND r.revision_id = i.current_revision_id
WHERE i.workspace_id = $1 AND ($2::boolean OR NOT r.is_private)
ORDER BY i.item_id` as const;

export const READ_CURRENT_SEARCH_REVISIONS_SQL = `SELECT
  i.workspace_id::text, i.item_id::text, r.revision_number,
  r.revision_id::text, r.knowledge_kind, r.epistemic_role,
  r.review_state, r.title, r.body, r.is_private
FROM struinfo.knowledge_item AS i
JOIN struinfo.knowledge_revision AS r
  ON r.workspace_id = i.workspace_id
 AND r.item_id = i.item_id
 AND r.revision_number = i.current_revision
 AND r.revision_id = i.current_revision_id
WHERE i.workspace_id = $1 AND ($2::boolean OR NOT r.is_private)
ORDER BY i.item_id, r.revision_number` as const;

export const READ_CURRENT_SEARCH_FRAGMENT_INPUTS_SQL = `SELECT
  p.workspace_id::text, p.item_id::text, p.revision_number,
  p.revision_id::text, p.input_kind, p.input_ordinal,
  f.resource_id::text, f.snapshot_id::text, f.fragment_id::text
FROM struinfo.knowledge_item AS i
JOIN struinfo.knowledge_revision_fragment_input AS p
  ON p.workspace_id = i.workspace_id
 AND p.item_id = i.item_id
 AND p.revision_number = i.current_revision
 AND p.revision_id = i.current_revision_id
JOIN struinfo.fragment AS f
  ON f.workspace_id = p.workspace_id AND f.fragment_id = p.fragment_id
JOIN struinfo.knowledge_revision AS r
  ON r.workspace_id = i.workspace_id
 AND r.item_id = i.item_id
 AND r.revision_number = i.current_revision
 AND r.revision_id = i.current_revision_id
WHERE i.workspace_id = $1 AND ($2::boolean OR NOT r.is_private)
ORDER BY p.item_id, p.revision_number, p.input_kind, p.input_ordinal` as const;

export const READ_CURRENT_SEARCH_RELATIONS_SQL = `SELECT
  q.workspace_id::text, q.relation_id::text, q.subject_item_id::text,
  q.relation_type_key, q.object_item_id::text, q.current_revision,
  q.current_revision_id::text
FROM struinfo.knowledge_relation AS q
JOIN struinfo.knowledge_relation_revision AS r
  ON r.workspace_id = q.workspace_id
 AND r.relation_id = q.relation_id
 AND r.revision_number = q.current_revision
 AND r.revision_id = q.current_revision_id
JOIN struinfo.knowledge_item AS subject
  ON subject.workspace_id = q.workspace_id AND subject.item_id = q.subject_item_id
JOIN struinfo.knowledge_revision AS subject_revision
  ON subject_revision.workspace_id = subject.workspace_id
 AND subject_revision.item_id = subject.item_id
 AND subject_revision.revision_number = subject.current_revision
 AND subject_revision.revision_id = subject.current_revision_id
JOIN struinfo.knowledge_item AS object_item
  ON object_item.workspace_id = q.workspace_id AND object_item.item_id = q.object_item_id
JOIN struinfo.knowledge_revision AS object_revision
  ON object_revision.workspace_id = object_item.workspace_id
 AND object_revision.item_id = object_item.item_id
 AND object_revision.revision_number = object_item.current_revision
 AND object_revision.revision_id = object_item.current_revision_id
WHERE q.workspace_id = $1
  AND ($2::boolean OR NOT (r.is_private OR subject_revision.is_private OR object_revision.is_private))
ORDER BY q.relation_id` as const;

export const READ_CURRENT_SEARCH_RELATION_REVISIONS_SQL = `SELECT
  q.workspace_id::text, q.relation_id::text, r.revision_number,
  r.revision_id::text, r.subject_item_id::text, r.relation_type_key,
  r.object_item_id::text, r.epistemic_role, r.review_state, r.qualifier,
  (r.is_private OR subject_revision.is_private OR object_revision.is_private) AS is_private
FROM struinfo.knowledge_relation AS q
JOIN struinfo.knowledge_relation_revision AS r
  ON r.workspace_id = q.workspace_id
 AND r.relation_id = q.relation_id
 AND r.revision_number = q.current_revision
 AND r.revision_id = q.current_revision_id
JOIN struinfo.knowledge_item AS subject
  ON subject.workspace_id = q.workspace_id AND subject.item_id = q.subject_item_id
JOIN struinfo.knowledge_revision AS subject_revision
  ON subject_revision.workspace_id = subject.workspace_id
 AND subject_revision.item_id = subject.item_id
 AND subject_revision.revision_number = subject.current_revision
 AND subject_revision.revision_id = subject.current_revision_id
JOIN struinfo.knowledge_item AS object_item
  ON object_item.workspace_id = q.workspace_id AND object_item.item_id = q.object_item_id
JOIN struinfo.knowledge_revision AS object_revision
  ON object_revision.workspace_id = object_item.workspace_id
 AND object_revision.item_id = object_item.item_id
 AND object_revision.revision_number = object_item.current_revision
 AND object_revision.revision_id = object_item.current_revision_id
WHERE q.workspace_id = $1
  AND ($2::boolean OR NOT (r.is_private OR subject_revision.is_private OR object_revision.is_private))
ORDER BY q.relation_id, r.revision_number` as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresDeterministicKnowledgeSearchRepository implements DeterministicKnowledgeSearchRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public loadCurrentKnowledgeSearchSnapshot(
    effectiveWorkspaceId: string,
    options: Readonly<{includePrivate?: boolean}> = {},
  ): Promise<DeterministicKnowledgeSearchSnapshot> {
    const workspaceId = canonicalUuid(effectiveWorkspaceId);
    const parameters = [workspaceId, options.includePrivate === true] as const;
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const items = await client.query<Row>(
          READ_CURRENT_SEARCH_ITEMS_SQL,
          parameters,
        );
        const revisions = await client.query<Row>(
          READ_CURRENT_SEARCH_REVISIONS_SQL,
          parameters,
        );
        const fragmentInputs = await client.query<Row>(
          READ_CURRENT_SEARCH_FRAGMENT_INPUTS_SQL,
          parameters,
        );
        const relations = await client.query<Row>(
          READ_CURRENT_SEARCH_RELATIONS_SQL,
          parameters,
        );
        const relationRevisions = await client.query<Row>(
          READ_CURRENT_SEARCH_RELATION_REVISIONS_SQL,
          parameters,
        );
        return Object.freeze({
          items: Object.freeze(items.rows.map(mapItem)),
          revisions: Object.freeze(revisions.rows.map(mapRevision)),
          fragmentInputs: Object.freeze(
            fragmentInputs.rows.map(mapFragmentInput),
          ),
          relations: Object.freeze(relations.rows.map(mapRelation)),
          relationRevisions: Object.freeze(
            relationRevisions.rows.map(mapRelationRevision),
          ),
        });
      },
    );
  }
}

function mapItem(row: Row): KnowledgeSearchItemState {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    itemId: canonicalUuid(row.item_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
  });
}

function mapRevision(row: Row): KnowledgeSearchRevisionState {
  const body = optionalText(row.body);
  const isPrivate = postgresBoolean(row.is_private);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    itemId: canonicalUuid(row.item_id),
    revision: integer(row.revision_number, 1),
    revisionId: canonicalUuid(row.revision_id),
    value: Object.freeze({
      knowledgeKind: enumValue(row.knowledge_kind, KNOWLEDGE_KINDS),
      epistemicRole: enumValue(row.epistemic_role, EPISTEMIC_ROLES),
      reviewState: enumValue(row.review_state, KNOWLEDGE_REVIEW_STATES),
      title: text(row.title),
      ...(body === undefined ? {} : {body}),
    }),
    ...(isPrivate ? {isPrivate: true as const} : {}),
  });
}

function mapFragmentInput(row: Row): KnowledgeSearchFragmentInputState {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    itemId: canonicalUuid(row.item_id),
    revision: integer(row.revision_number, 1),
    revisionId: canonicalUuid(row.revision_id),
    inputKind: enumValue(row.input_kind, ['citation', 'derivation'] as const),
    inputOrdinal: integer(row.input_ordinal, 0),
    resourceId: canonicalUuid(row.resource_id),
    snapshotId: canonicalUuid(row.snapshot_id),
    fragmentId: canonicalUuid(row.fragment_id),
  });
}

function mapRelation(row: Row): KnowledgeSearchRelationState {
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

function mapRelationRevision(row: Row): KnowledgeSearchRelationRevisionState {
  const qualifier = optionalText(row.qualifier);
  const isPrivate = postgresBoolean(row.is_private);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    relationId: canonicalUuid(row.relation_id),
    revision: integer(row.revision_number, 1),
    revisionId: canonicalUuid(row.revision_id),
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
    ...(isPrivate ? {isPrivate: true as const} : {}),
  });
}

function postgresBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('PostgreSQL privacy projection is invalid.');
  }
  return value;
}

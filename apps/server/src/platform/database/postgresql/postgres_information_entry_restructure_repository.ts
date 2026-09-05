import {
  INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_ORIGINS,
  INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
  INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
  INFORMATION_DOCUMENT_TAG_ORIGINS,
  INFORMATION_DOCUMENT_TAG_REVISION_KINDS,
  type InformationEntryRestructureRepositoryPort,
  type InformationEntryRestructureWrite,
} from '../../../modules/entries/index.js';

import {
  informationEntryAssociationProjectionParameters,
  INSERT_INFORMATION_ENTRY_ASSOCIATION_PROJECTION_SQL,
} from './postgres_information_entry_association_repository.js';
import {
  informationEntryValueParameters,
  insertNewEntry,
  replaceEntryChildren,
} from './postgres_information_entry_repository.js';
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

const LOCK_SNAPSHOT_STRUCTURE_SQL = sql(
  'SELECT entry_id::text, current_revision, current_revision_id::text',
  'FROM struinfo.information_entry',
  'WHERE workspace_id = $1 AND snapshot_id = $2 AND is_current_structure',
  'ORDER BY entry_id',
  'FOR UPDATE',
);

const LOCK_WORKSPACE_OVERRIDES_SQL = sql(
  'SELECT entry_low_id::text, entry_high_id::text, current_revision,',
  '  current_revision_id::text, action, manual_adjustment, is_blocked,',
  '  graph_origin, graph_label, graph_direction, graph_semantic_kind,',
  '  graph_verification_status, graph_note',
  'FROM struinfo.information_entry_association_override',
  'WHERE workspace_id = $1',
  'ORDER BY entry_low_id, entry_high_id',
  'FOR UPDATE',
);

const RETIRE_ENTRY_SQL = sql(
  'UPDATE struinfo.information_entry SET',
  '  is_current_structure = false, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND entry_id = $2',
  '  AND current_revision = $3 AND is_current_structure',
);

const ACTIVATE_SUCCESSOR_SQL = sql(
  'UPDATE struinfo.information_entry SET',
  '  current_revision = $3, current_revision_id = $4,',
  '  document_order = $5, title_path = $6, body = $7, body_sha256 = $8,',
  '  chunk_mode = $9, split_rule_version = $10, is_private = $11,',
  '  type_keyword = $12, type_custom_name = $13,',
  '  usefulness_score = $14, interest_score = $15,',
  '  is_current_structure = true, updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND entry_id = $2',
  '  AND current_revision = $16 AND NOT is_current_structure',
);

const INSERT_LINEAGE_SQL = sql(
  'INSERT INTO struinfo.information_entry_lineage (',
  '  workspace_id, successor_entry_id, predecessor_entry_id, lineage_kind',
  ') VALUES ($1, $2, $3, $4)',
  'ON CONFLICT (workspace_id, successor_entry_id, predecessor_entry_id)',
  'DO NOTHING',
);

// A replacement Entry pair has not been reviewed. Keep status/note but leave
// the reviewed revision columns null instead of transferring source-check authority.
const INSERT_OVERRIDE_SQL = sql(
  'INSERT INTO struinfo.information_entry_association_override (',
  '  workspace_id, entry_low_id, entry_high_id, current_revision,',
  '  current_revision_id, action, manual_adjustment, is_blocked,',
  '  graph_origin, graph_label, graph_direction, graph_semantic_kind,',
  '  graph_verification_status, graph_note',
  ') VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
);

const DELETE_WORKSPACE_PROJECTIONS_SQL = sql(
  'DELETE FROM struinfo.information_entry_association_projection AS projection',
  'USING struinfo.information_entry AS low_entry,',
  '      struinfo.information_entry AS high_entry',
  'WHERE projection.workspace_id = $1',
  '  AND low_entry.workspace_id = projection.workspace_id',
  '  AND low_entry.entry_id = projection.entry_low_id',
  '  AND high_entry.workspace_id = projection.workspace_id',
  '  AND high_entry.entry_id = projection.entry_high_id',
  '  AND ($2::boolean OR (NOT low_entry.is_private AND NOT high_entry.is_private))',
);

const LOCK_DOCUMENT_TAG_SET_SQL = sql(
  'SELECT resource_id::text, current_revision',
  'FROM struinfo.information_document_tag_set',
  'WHERE workspace_id = $1 AND snapshot_id = $2',
  'FOR UPDATE',
);

const UPDATE_DOCUMENT_TAG_SET_SQL = sql(
  'UPDATE struinfo.information_document_tag_set SET',
  '  current_revision = $3, current_revision_id = $4, revision_kind = $5,',
  '  rule_version = $6, is_private = $7, entry_count = $8,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND snapshot_id = $2 AND current_revision = $9',
);

const DELETE_DOCUMENT_TAG_VALUES_SQL =
  'DELETE FROM struinfo.information_document_tag_value WHERE workspace_id = $1 AND snapshot_id = $2';

const INSERT_DOCUMENT_TAG_VALUE_SQL = sql(
  'INSERT INTO struinfo.information_document_tag_value (',
  '  workspace_id, snapshot_id, tag_ordinal, display_value, normalized_value,',
  '  origin, full_text_occurrences, entry_coverage_count',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
);

type Row = Readonly<Record<string, unknown>>;

export class PostgresInformationEntryRestructureRepository implements InformationEntryRestructureRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public applyEntryRestructure(
    write: Readonly<InformationEntryRestructureWrite>,
  ): Promise<'applied' | 'unchanged' | 'stale'> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const snapshotId = canonicalUuid(write.snapshotId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const lockedEntries = await client.query<Row>(
          LOCK_SNAPSHOT_STRUCTURE_SQL,
          [workspaceId, snapshotId],
        );
        if (!sameExpectedEntries(lockedEntries.rows, write.expectedEntries)) {
          return 'stale';
        }
        const currentIds = new Set(
          write.expectedEntries.map((entry) => entry.entryId),
        );
        const lockedOverrides = await client.query<Row>(
          LOCK_WORKSPACE_OVERRIDES_SQL,
          [workspaceId],
        );
        const touchingOverrides = lockedOverrides.rows.filter(
          (row) =>
            currentIds.has(canonicalUuid(row.entry_low_id)) ||
            currentIds.has(canonicalUuid(row.entry_high_id)),
        );
        if (
          !sameExpectedOverrides(touchingOverrides, write.expectedOverrides)
        ) {
          return 'stale';
        }
        if (
          !(await documentTagsAreCurrent(
            client,
            workspaceId,
            snapshotId,
            write,
          ))
        ) {
          return 'stale';
        }
        const hasChanges =
          write.retiredEntryIds.length > 0 ||
          write.successors.some(
            (successor) => successor.operation !== 'unchanged',
          ) ||
          write.overrideTransfers.length > 0;
        if (!hasChanges) return 'unchanged';

        for (const expected of write.expectedEntries) {
          const retired = await client.query<Row>(RETIRE_ENTRY_SQL, [
            workspaceId,
            canonicalUuid(expected.entryId),
            expected.revision,
          ]);
          expectOneAffected(retired.rowCount);
        }
        for (const successor of write.successors) {
          if (
            canonicalUuid(successor.row.workspaceId) !== workspaceId ||
            canonicalUuid(successor.row.snapshotId) !== snapshotId
          ) {
            throw new PostgresAdapterError();
          }
          if (successor.operation === 'insert') {
            await insertNewEntry(client, successor.row);
            continue;
          }
          const expectedRevision = successor.expectedRevision;
          if (expectedRevision === undefined) throw new PostgresAdapterError();
          const nextRevision =
            expectedRevision + (successor.operation === 'revise' ? 1 : 0);
          const activated = await client.query<Row>(ACTIVATE_SUCCESSOR_SQL, [
            workspaceId,
            canonicalUuid(successor.row.entryId),
            nextRevision,
            canonicalUuid(successor.row.revisionId),
            ...informationEntryValueParameters(successor.row.value),
            expectedRevision,
          ]);
          expectOneAffected(activated.rowCount);
          if (successor.operation === 'revise') {
            await replaceEntryChildren(
              client,
              workspaceId,
              successor.row.entryId,
              successor.row.value,
            );
          }
        }
        for (const lineage of write.lineage) {
          await client.query<Row>(INSERT_LINEAGE_SQL, [
            workspaceId,
            canonicalUuid(lineage.successorEntryId),
            canonicalUuid(lineage.predecessorEntryId),
            lineage.kind,
          ]);
        }
        const overrideByPair = new Map(
          lockedOverrides.rows.map((row) => [pairKey(row), row]),
        );
        for (const transfer of write.overrideTransfers) {
          const destinationKey = `${transfer.destinationEntryLowId}:${transfer.destinationEntryHighId}`;
          const existing = overrideByPair.get(destinationKey);
          if (existing !== undefined) {
            if (!sameOverride(existing, transfer.value)) {
              throw new PostgresAdapterError();
            }
            continue;
          }
          const inserted = await client.query<Row>(INSERT_OVERRIDE_SQL, [
            workspaceId,
            canonicalUuid(transfer.destinationEntryLowId),
            canonicalUuid(transfer.destinationEntryHighId),
            canonicalUuid(transfer.revisionId),
            enumValue(
              transfer.value.action,
              INFORMATION_ENTRY_ASSOCIATION_ACTIONS,
            ),
            integer(transfer.value.manualAdjustment, -10_000),
            transfer.value.isBlocked,
            transfer.value.graph?.origin ?? null,
            transfer.value.graph?.label ?? null,
            transfer.value.graph?.direction ?? null,
            transfer.value.graph?.semanticKind ?? null,
            transfer.value.graph?.verificationStatus ?? null,
            transfer.value.graph?.note ?? null,
          ]);
          expectOneAffected(inserted.rowCount);
        }
        const documentTagsOutcome = await replaceDocumentTags(
          client,
          workspaceId,
          snapshotId,
          write,
        );
        if (documentTagsOutcome === 'stale') return 'stale';
        await replaceProjections(client, workspaceId, write);
        return 'applied';
      },
    );
  }
}

async function replaceDocumentTags(
  client: PostgresClientBoundary,
  workspaceId: string,
  snapshotId: string,
  write: Readonly<InformationEntryRestructureWrite>,
): Promise<'applied' | 'unchanged' | 'stale'> {
  const documentTags = write.documentTags;
  if (documentTags === undefined) return 'unchanged';
  const locked = await client.query<Row>(LOCK_DOCUMENT_TAG_SET_SQL, [
    workspaceId,
    snapshotId,
  ]);
  if (locked.rows.length !== 1 || locked.rows[0] === undefined) return 'stale';
  const row = locked.rows[0];
  if (
    canonicalUuid(row.resource_id) !== canonicalUuid(documentTags.resourceId) ||
    integer(row.current_revision, 1) !== documentTags.expectedRevision
  ) {
    return 'stale';
  }
  const nextRevision = documentTags.expectedRevision + 1;
  const value = documentTags.value;
  const updated = await client.query<Row>(UPDATE_DOCUMENT_TAG_SET_SQL, [
    workspaceId,
    snapshotId,
    nextRevision,
    canonicalUuid(documentTags.revisionId),
    enumValue(value.revisionKind, INFORMATION_DOCUMENT_TAG_REVISION_KINDS),
    value.ruleVersion,
    value.isPrivate,
    value.entryCount,
    documentTags.expectedRevision,
  ]);
  expectOneAffected(updated.rowCount);
  await client.query<Row>(DELETE_DOCUMENT_TAG_VALUES_SQL, [
    workspaceId,
    snapshotId,
  ]);
  for (const [index, tag] of value.tags.entries()) {
    const inserted = await client.query<Row>(INSERT_DOCUMENT_TAG_VALUE_SQL, [
      workspaceId,
      snapshotId,
      index,
      tag.displayValue,
      tag.normalizedValue,
      enumValue(tag.origin, INFORMATION_DOCUMENT_TAG_ORIGINS),
      tag.fullTextOccurrences,
      tag.entryCoverageCount,
    ]);
    expectOneAffected(inserted.rowCount);
  }
  return 'applied';
}

async function documentTagsAreCurrent(
  client: PostgresClientBoundary,
  workspaceId: string,
  snapshotId: string,
  write: Readonly<InformationEntryRestructureWrite>,
): Promise<boolean> {
  const documentTags = write.documentTags;
  if (documentTags === undefined) return true;
  const locked = await client.query<Row>(LOCK_DOCUMENT_TAG_SET_SQL, [
    workspaceId,
    snapshotId,
  ]);
  const row = locked.rows[0];
  return (
    locked.rows.length === 1 &&
    row !== undefined &&
    canonicalUuid(row.resource_id) === canonicalUuid(documentTags.resourceId) &&
    integer(row.current_revision, 1) === documentTags.expectedRevision
  );
}

async function replaceProjections(
  client: PostgresClientBoundary,
  workspaceId: string,
  write: Readonly<InformationEntryRestructureWrite>,
): Promise<void> {
  await client.query<Row>(DELETE_WORKSPACE_PROJECTIONS_SQL, [
    workspaceId,
    write.includePrivate,
  ]);
  for (const projection of write.projections) {
    if (canonicalUuid(projection.workspaceId) !== workspaceId) {
      throw new PostgresAdapterError();
    }
    const inserted = await client.query<Row>(
      INSERT_INFORMATION_ENTRY_ASSOCIATION_PROJECTION_SQL,
      informationEntryAssociationProjectionParameters(projection),
    );
    expectOneAffected(inserted.rowCount);
  }
}

function sameExpectedEntries(
  rows: readonly Row[],
  expected: Readonly<InformationEntryRestructureWrite>['expectedEntries'],
): boolean {
  if (rows.length !== expected.length) return false;
  return rows.every((row, index) => {
    const value = expected[index];
    if (value === undefined) return false;
    return (
      canonicalUuid(row.entry_id) === value.entryId &&
      integer(row.current_revision, 1) === value.revision &&
      canonicalUuid(row.current_revision_id) === value.revisionId
    );
  });
}

function sameExpectedOverrides(
  rows: readonly Row[],
  expected: Readonly<InformationEntryRestructureWrite>['expectedOverrides'],
): boolean {
  if (rows.length !== expected.length) return false;
  return rows.every((row, index) => {
    const value = expected[index];
    if (value === undefined) return false;
    return (
      canonicalUuid(row.entry_low_id) === value.entryLowId &&
      canonicalUuid(row.entry_high_id) === value.entryHighId &&
      integer(row.current_revision, 1) === value.revision &&
      canonicalUuid(row.current_revision_id) === value.revisionId
    );
  });
}

function pairKey(row: Row): string {
  return `${canonicalUuid(row.entry_low_id)}:${canonicalUuid(row.entry_high_id)}`;
}

function sameOverride(
  row: Row,
  expected: Readonly<InformationEntryRestructureWrite>['overrideTransfers'][number]['value'],
): boolean {
  if (typeof row.is_blocked !== 'boolean') throw new PostgresAdapterError();
  const graphOrigin =
    row.graph_origin === null
      ? undefined
      : enumValue(row.graph_origin, INFORMATION_ENTRY_GRAPH_ORIGINS);
  const graphDirection =
    row.graph_direction === null
      ? undefined
      : enumValue(row.graph_direction, INFORMATION_ENTRY_GRAPH_DIRECTIONS);
  const graphLabel =
    row.graph_label === null ? undefined : text(row.graph_label);
  const graphSemanticKind =
    row.graph_semantic_kind === null
      ? undefined
      : enumValue(
          row.graph_semantic_kind,
          INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
        );
  const graphVerificationStatus =
    row.graph_verification_status === null
      ? undefined
      : enumValue(
          row.graph_verification_status,
          INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
        );
  const graphNote = row.graph_note === null ? undefined : text(row.graph_note);
  return (
    enumValue(row.action, INFORMATION_ENTRY_ASSOCIATION_ACTIONS) ===
      expected.action &&
    integer(row.manual_adjustment, -10_000) === expected.manualAdjustment &&
    row.is_blocked === expected.isBlocked &&
    graphOrigin === expected.graph?.origin &&
    graphDirection === expected.graph?.direction &&
    graphLabel === expected.graph?.label &&
    graphSemanticKind === expected.graph?.semanticKind &&
    graphVerificationStatus === expected.graph?.verificationStatus &&
    graphNote === expected.graph?.note
  );
}

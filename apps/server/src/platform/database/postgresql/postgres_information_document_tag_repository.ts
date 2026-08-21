import {
  INFORMATION_DOCUMENT_TAG_ORIGINS,
  INFORMATION_DOCUMENT_TAG_REVISION_KINDS,
  type CurrentInformationDocumentTags,
  type InformationDocumentTag,
  type InformationDocumentTagRepositoryPort,
  type InformationDocumentTagRevisionValue,
  type InformationDocumentTagWrite,
  type InformationDocumentTagWriteOutcome,
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
  PostgresAdapterError,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

export const READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL = `SELECT
  tag_set.workspace_id::text, tag_set.resource_id::text,
  tag_set.snapshot_id::text, tag_set.current_revision,
  tag_set.current_revision_id::text, revision.revision_kind,
  revision.rule_version, revision.is_private, revision.entry_count
FROM struinfo.information_document_tag_set AS tag_set
JOIN struinfo.information_document_tag_revision AS revision
  ON revision.workspace_id = tag_set.workspace_id
 AND revision.snapshot_id = tag_set.snapshot_id
 AND revision.revision_number = tag_set.current_revision
 AND revision.revision_id = tag_set.current_revision_id
WHERE tag_set.workspace_id = $1 AND ($2::boolean OR NOT revision.is_private)
ORDER BY tag_set.snapshot_id` as const;

export const READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL = `SELECT
  value.snapshot_id::text, value.revision_number, value.tag_ordinal,
  value.display_value, value.normalized_value, value.origin,
  value.full_text_occurrences, value.entry_coverage_count
FROM struinfo.information_document_tag_value AS value
JOIN struinfo.information_document_tag_set AS tag_set
  ON tag_set.workspace_id = value.workspace_id
 AND tag_set.snapshot_id = value.snapshot_id
 AND tag_set.current_revision = value.revision_number
 AND tag_set.current_revision_id = value.revision_id
JOIN struinfo.information_document_tag_revision AS revision
  ON revision.workspace_id = tag_set.workspace_id
 AND revision.snapshot_id = tag_set.snapshot_id
 AND revision.revision_number = tag_set.current_revision
 AND revision.revision_id = tag_set.current_revision_id
WHERE value.workspace_id = $1 AND ($2::boolean OR NOT revision.is_private)
ORDER BY value.snapshot_id, value.tag_ordinal` as const;

const LOCK_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL =
  READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL.replace(
    'WHERE tag_set.workspace_id = $1 AND ($2::boolean OR NOT revision.is_private)',
    'WHERE tag_set.workspace_id = $1 AND tag_set.snapshot_id = $2',
  ).replace('ORDER BY tag_set.snapshot_id', 'FOR UPDATE OF tag_set');

const READ_INFORMATION_DOCUMENT_TAG_VALUES_SQL = `SELECT
  tag_ordinal, display_value, normalized_value, origin,
  full_text_occurrences, entry_coverage_count
FROM struinfo.information_document_tag_value
WHERE workspace_id = $1 AND snapshot_id = $2 AND revision_number = $3
ORDER BY tag_ordinal` as const;

const INSERT_INFORMATION_DOCUMENT_TAG_SET_SQL =
  `INSERT INTO struinfo.information_document_tag_set (
  workspace_id, resource_id, snapshot_id, current_revision, current_revision_id
) VALUES ($1, $2, $3, 1, $4)` as const;

const INSERT_INFORMATION_DOCUMENT_TAG_REVISION_SQL =
  `INSERT INTO struinfo.information_document_tag_revision (
  workspace_id, snapshot_id, revision_number, revision_id,
  previous_revision_id, revision_kind, rule_version, is_private, entry_count
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)` as const;

const INSERT_INFORMATION_DOCUMENT_TAG_VALUE_SQL =
  `INSERT INTO struinfo.information_document_tag_value (
  workspace_id, snapshot_id, revision_number, revision_id, tag_ordinal,
  display_value, normalized_value, origin, full_text_occurrences,
  entry_coverage_count
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)` as const;

const UPDATE_INFORMATION_DOCUMENT_TAG_POINTER_SQL =
  `UPDATE struinfo.information_document_tag_set
SET current_revision = $3, current_revision_id = $4
WHERE workspace_id = $1 AND snapshot_id = $2 AND current_revision = $5` as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresInformationDocumentTagRepository implements InformationDocumentTagRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public writeDocumentTags(
    write: Readonly<InformationDocumentTagWrite>,
  ): Promise<InformationDocumentTagWriteOutcome> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const resourceId = canonicalUuid(write.resourceId);
    const snapshotId = canonicalUuid(write.snapshotId);
    const revisionId = canonicalUuid(write.revisionId);
    if (
      !Number.isSafeInteger(write.expectedRevision) ||
      write.expectedRevision < 0
    ) {
      throw new PostgresAdapterError();
    }
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(
          LOCK_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL,
          [workspaceId, snapshotId],
        );
        if (locked.rows.length > 1) throw new PostgresAdapterError();
        const row = locked.rows[0];
        if (row === undefined) {
          if (write.expectedRevision !== 0) return 'stale';
          const inserted = await client.query<Row>(
            INSERT_INFORMATION_DOCUMENT_TAG_SET_SQL,
            [workspaceId, resourceId, snapshotId, revisionId],
          );
          expectOneAffected(inserted.rowCount);
          await insertDocumentTagRevision(
            client,
            workspaceId,
            snapshotId,
            1,
            revisionId,
            undefined,
            write.value,
          );
          return 'applied';
        }
        if (canonicalUuid(row.resource_id) !== resourceId) {
          throw new PostgresAdapterError();
        }
        const currentRevision = integer(row.current_revision, 1);
        if (currentRevision !== write.expectedRevision) return 'stale';
        const values = await client.query<Row>(
          READ_INFORMATION_DOCUMENT_TAG_VALUES_SQL,
          [workspaceId, snapshotId, currentRevision],
        );
        const currentValue = mapDocumentTagValue(row, values.rows);
        if (sameDocumentTagValue(currentValue, write.value)) {
          return 'unchanged';
        }
        const nextRevision = currentRevision + 1;
        if (nextRevision > 2_147_483_647) throw new PostgresAdapterError();
        await insertDocumentTagRevision(
          client,
          workspaceId,
          snapshotId,
          nextRevision,
          revisionId,
          canonicalUuid(row.current_revision_id),
          write.value,
        );
        const updated = await client.query<Row>(
          UPDATE_INFORMATION_DOCUMENT_TAG_POINTER_SQL,
          [workspaceId, snapshotId, nextRevision, revisionId, currentRevision],
        );
        expectOneAffected(updated.rowCount);
        return 'applied';
      },
    );
  }

  public loadCurrentDocumentTags(
    workspaceIdInput: string,
    includePrivate: boolean,
  ): Promise<readonly Readonly<CurrentInformationDocumentTags>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const [core, values] = await Promise.all([
          client.query<Row>(READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL, [
            workspaceId,
            includePrivate,
          ]),
          client.query<Row>(READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL, [
            workspaceId,
            includePrivate,
          ]),
        ]);
        return Object.freeze(
          core.rows.map((row) => {
            const snapshotId = canonicalUuid(row.snapshot_id);
            const revision = integer(row.current_revision, 1);
            return Object.freeze({
              workspaceId: canonicalUuid(row.workspace_id),
              resourceId: canonicalUuid(row.resource_id),
              snapshotId,
              revision,
              revisionId: canonicalUuid(row.current_revision_id),
              value: mapDocumentTagValue(
                row,
                values.rows.filter(
                  (candidate) =>
                    candidate.snapshot_id === snapshotId &&
                    candidate.revision_number === revision,
                ),
              ),
            });
          }),
        );
      },
    );
  }
}

async function insertDocumentTagRevision(
  client: PostgresClientBoundary,
  workspaceId: string,
  snapshotId: string,
  revision: number,
  revisionId: string,
  previousRevisionId: string | undefined,
  value: Readonly<InformationDocumentTagRevisionValue>,
): Promise<void> {
  const inserted = await client.query<Row>(
    INSERT_INFORMATION_DOCUMENT_TAG_REVISION_SQL,
    [
      workspaceId,
      snapshotId,
      revision,
      revisionId,
      previousRevisionId ?? null,
      value.revisionKind,
      value.ruleVersion,
      value.isPrivate,
      value.entryCount,
    ],
  );
  expectOneAffected(inserted.rowCount);
  for (const [index, tag] of value.tags.entries()) {
    const result = await client.query<Row>(
      INSERT_INFORMATION_DOCUMENT_TAG_VALUE_SQL,
      [
        workspaceId,
        snapshotId,
        revision,
        revisionId,
        index,
        tag.displayValue,
        tag.normalizedValue,
        tag.origin,
        tag.fullTextOccurrences,
        tag.entryCoverageCount,
      ],
    );
    expectOneAffected(result.rowCount);
  }
}

function mapDocumentTagValue(
  row: Row,
  valueRows: readonly Row[],
): Readonly<InformationDocumentTagRevisionValue> {
  if (
    typeof row.is_private !== 'boolean' ||
    valueRows.some(
      (candidate, index) => integer(candidate.tag_ordinal) !== index,
    )
  ) {
    throw new PostgresAdapterError();
  }
  const entryCount = integer(row.entry_count);
  const tags = valueRows.map((candidate): InformationDocumentTag => {
    const entryCoverageCount = integer(candidate.entry_coverage_count);
    if (entryCoverageCount > entryCount) throw new PostgresAdapterError();
    return Object.freeze({
      displayValue: text(candidate.display_value),
      normalizedValue: text(candidate.normalized_value),
      origin: enumValue(candidate.origin, INFORMATION_DOCUMENT_TAG_ORIGINS),
      fullTextOccurrences: integer(candidate.full_text_occurrences),
      entryCoverageCount,
    });
  });
  return Object.freeze({
    revisionKind: enumValue(
      row.revision_kind,
      INFORMATION_DOCUMENT_TAG_REVISION_KINDS,
    ),
    ruleVersion: text(row.rule_version),
    isPrivate: row.is_private,
    entryCount,
    tags: Object.freeze(tags),
  });
}

function sameDocumentTagValue(
  left: Readonly<InformationDocumentTagRevisionValue>,
  right: Readonly<InformationDocumentTagRevisionValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

function sql(...lines: readonly string[]): string {
  return lines.join(String.fromCharCode(10));
}

export const READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL = sql(
  'SELECT workspace_id::text, resource_id::text, snapshot_id::text,',
  '  current_revision, current_revision_id::text, revision_kind,',
  '  rule_version, is_private, entry_count',
  'FROM struinfo.information_document_tag_set',
  'WHERE workspace_id = $1 AND ($2::boolean OR NOT is_private)',
  'ORDER BY snapshot_id',
);

export const READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL = sql(
  'SELECT value.snapshot_id::text, value.tag_ordinal, value.display_value,',
  '  value.normalized_value, value.origin, value.full_text_occurrences,',
  '  value.entry_coverage_count',
  'FROM struinfo.information_document_tag_value AS value',
  'JOIN struinfo.information_document_tag_set AS tag_set',
  '  ON tag_set.workspace_id = value.workspace_id',
  ' AND tag_set.snapshot_id = value.snapshot_id',
  'WHERE value.workspace_id = $1 AND ($2::boolean OR NOT tag_set.is_private)',
  'ORDER BY value.snapshot_id, value.tag_ordinal',
);

const LOCK_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL = sql(
  'SELECT workspace_id::text, resource_id::text, snapshot_id::text,',
  '  current_revision, current_revision_id::text, revision_kind,',
  '  rule_version, is_private, entry_count',
  'FROM struinfo.information_document_tag_set',
  'WHERE workspace_id = $1 AND snapshot_id = $2',
  'FOR UPDATE',
);

const READ_INFORMATION_DOCUMENT_TAG_VALUES_SQL = sql(
  'SELECT tag_ordinal, display_value, normalized_value, origin,',
  '  full_text_occurrences, entry_coverage_count',
  'FROM struinfo.information_document_tag_value',
  'WHERE workspace_id = $1 AND snapshot_id = $2',
  'ORDER BY tag_ordinal',
);

const INSERT_INFORMATION_DOCUMENT_TAG_SET_SQL = sql(
  'INSERT INTO struinfo.information_document_tag_set (',
  '  workspace_id, resource_id, snapshot_id, current_revision,',
  '  current_revision_id, revision_kind, rule_version, is_private, entry_count',
  ') VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)',
);

const UPDATE_INFORMATION_DOCUMENT_TAG_SET_SQL = sql(
  'UPDATE struinfo.information_document_tag_set SET',
  '  current_revision = $3, current_revision_id = $4, revision_kind = $5,',
  '  rule_version = $6, is_private = $7, entry_count = $8,',
  '  updated_at = CURRENT_TIMESTAMP',
  'WHERE workspace_id = $1 AND snapshot_id = $2 AND current_revision = $9',
);

const DELETE_INFORMATION_DOCUMENT_TAG_VALUES_SQL =
  'DELETE FROM struinfo.information_document_tag_value WHERE workspace_id = $1 AND snapshot_id = $2';

const INSERT_INFORMATION_DOCUMENT_TAG_VALUE_SQL = sql(
  'INSERT INTO struinfo.information_document_tag_value (',
  '  workspace_id, snapshot_id, tag_ordinal, display_value, normalized_value,',
  '  origin, full_text_occurrences, entry_coverage_count',
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
);

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
            [
              workspaceId,
              resourceId,
              snapshotId,
              revisionId,
              ...valueParameters(write.value),
            ],
          );
          expectOneAffected(inserted.rowCount);
          await insertDocumentTagValues(
            client,
            workspaceId,
            snapshotId,
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
          [workspaceId, snapshotId],
        );
        if (
          sameDocumentTagValue(
            mapDocumentTagValue(row, values.rows),
            write.value,
          )
        ) {
          return 'unchanged';
        }
        const nextRevision = currentRevision + 1;
        if (nextRevision > 2_147_483_647) throw new PostgresAdapterError();
        const updated = await client.query<Row>(
          UPDATE_INFORMATION_DOCUMENT_TAG_SET_SQL,
          [
            workspaceId,
            snapshotId,
            nextRevision,
            revisionId,
            ...valueParameters(write.value),
            currentRevision,
          ],
        );
        expectOneAffected(updated.rowCount);
        await client.query<Row>(DELETE_INFORMATION_DOCUMENT_TAG_VALUES_SQL, [
          workspaceId,
          snapshotId,
        ]);
        await insertDocumentTagValues(
          client,
          workspaceId,
          snapshotId,
          write.value,
        );
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
        const core = await client.query<Row>(
          READ_CURRENT_INFORMATION_DOCUMENT_TAGS_SQL,
          [workspaceId, includePrivate],
        );
        const values = await client.query<Row>(
          READ_CURRENT_INFORMATION_DOCUMENT_TAG_VALUES_SQL,
          [workspaceId, includePrivate],
        );
        return Object.freeze(
          core.rows.map((row) => {
            const snapshotId = canonicalUuid(row.snapshot_id);
            return Object.freeze({
              workspaceId: canonicalUuid(row.workspace_id),
              resourceId: canonicalUuid(row.resource_id),
              snapshotId,
              revision: integer(row.current_revision, 1),
              revisionId: canonicalUuid(row.current_revision_id),
              value: mapDocumentTagValue(
                row,
                values.rows.filter(
                  (candidate) => candidate.snapshot_id === snapshotId,
                ),
              ),
            });
          }),
        );
      },
    );
  }
}

function valueParameters(
  value: Readonly<InformationDocumentTagRevisionValue>,
): readonly unknown[] {
  return [
    value.revisionKind,
    value.ruleVersion,
    value.isPrivate,
    value.entryCount,
  ];
}

async function insertDocumentTagValues(
  client: PostgresClientBoundary,
  workspaceId: string,
  snapshotId: string,
  value: Readonly<InformationDocumentTagRevisionValue>,
): Promise<void> {
  for (const [index, tag] of value.tags.entries()) {
    const result = await client.query<Row>(
      INSERT_INFORMATION_DOCUMENT_TAG_VALUE_SQL,
      [
        workspaceId,
        snapshotId,
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

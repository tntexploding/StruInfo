import type {
  InformationDocumentWorkingCopy,
  InformationDocumentWorkingCopyCommit,
  InformationDocumentWorkingCopyCommitResult,
  InformationDocumentWorkingCopyRepositoryPort,
  InformationDocumentWorkingCopyRestoreResult,
  InformationDocumentWorkingCopySave,
  InformationDocumentWorkingCopySummary,
  InformationDocumentWorkingCopyWriteResult,
} from '../../../modules/entries/index.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

const WORKING_COPY_STATES = ['editing', 'committed'] as const;

export const READ_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `SELECT source_snapshot_id::text, revision, state, draft_body, body_sha256,
  derived_resource_id::text, derived_snapshot_id::text
FROM struinfo.information_document_working_copy
WHERE workspace_id = $1 AND source_snapshot_id = $2` as const;

export const LIST_INFORMATION_DOCUMENT_WORKING_COPIES_SQL =
  `SELECT source_snapshot_id::text, revision, state, NULL::text AS draft_body,
  body_sha256, derived_resource_id::text, derived_snapshot_id::text
FROM struinfo.information_document_working_copy
WHERE workspace_id = $1
ORDER BY source_snapshot_id` as const;

const LOCK_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `${READ_INFORMATION_DOCUMENT_WORKING_COPY_SQL}
FOR UPDATE` as const;

const READ_CURRENT_SOURCE_ENTRIES_SQL = `SELECT 1 AS present
FROM struinfo.information_entry
WHERE workspace_id = $1
  AND snapshot_id = $2
  AND is_current_structure
LIMIT 1` as const;

const INSERT_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `INSERT INTO struinfo.information_document_working_copy (
  workspace_id, source_snapshot_id, revision, state, draft_body, body_sha256
)
VALUES ($1, $2, 1, 'editing', $3, $4)` as const;

const UPDATE_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `UPDATE struinfo.information_document_working_copy
SET revision = $3,
  draft_body = $4,
  body_sha256 = $5,
  updated_at = CURRENT_TIMESTAMP
WHERE workspace_id = $1
  AND source_snapshot_id = $2
  AND revision = $6
  AND state = 'editing'` as const;

const DELETE_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `DELETE FROM struinfo.information_document_working_copy
WHERE workspace_id = $1
  AND source_snapshot_id = $2
  AND revision = $3
  AND state = 'editing'` as const;

const COMMIT_INFORMATION_DOCUMENT_WORKING_COPY_SQL =
  `UPDATE struinfo.information_document_working_copy
SET state = 'committed',
  draft_body = NULL,
  derived_resource_id = $3,
  derived_snapshot_id = $4,
  updated_at = CURRENT_TIMESTAMP,
  committed_at = CURRENT_TIMESTAMP
WHERE workspace_id = $1
  AND source_snapshot_id = $2
  AND revision = $5
  AND state = 'editing'` as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresInformationDocumentWorkingCopyRepository implements InformationDocumentWorkingCopyRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public load(
    workspaceIdInput: string,
    sourceSnapshotIdInput: string,
  ): Promise<Readonly<InformationDocumentWorkingCopy> | undefined> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const sourceSnapshotId = canonicalUuid(sourceSnapshotIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          READ_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
          [workspaceId, sourceSnapshotId],
        );
        if (result.rows.length > 1)
          throw new Error('Working copy identity failed.');
        return result.rows[0] === undefined
          ? undefined
          : mapWorkingCopy(workspaceId, result.rows[0]);
      },
    );
  }

  public list(
    workspaceIdInput: string,
  ): Promise<readonly Readonly<InformationDocumentWorkingCopySummary>[]> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Row>(
          LIST_INFORMATION_DOCUMENT_WORKING_COPIES_SQL,
          [workspaceId],
        );
        return Object.freeze(
          result.rows.map((row) => {
            const value = mapWorkingCopy(workspaceId, row);
            return Object.freeze({
              workspaceId: value.workspaceId,
              sourceSnapshotId: value.sourceSnapshotId,
              revision: value.revision,
              state: value.state,
              bodySha256: value.bodySha256,
              ...(value.derivedResourceId === undefined
                ? {}
                : {derivedResourceId: value.derivedResourceId}),
              ...(value.derivedSnapshotId === undefined
                ? {}
                : {derivedSnapshotId: value.derivedSnapshotId}),
            });
          }),
        );
      },
    );
  }

  public save(
    write: Readonly<InformationDocumentWorkingCopySave>,
  ): Promise<InformationDocumentWorkingCopyWriteResult> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const sourceSnapshotId = canonicalUuid(write.sourceSnapshotId);
    const expectedRevision = integer(write.expectedRevision);
    const draftBody = text(write.draftBody);
    const bodySha256 = sha256(write.bodySha256);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(
          LOCK_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
          [workspaceId, sourceSnapshotId],
        );
        if (locked.rows.length > 1)
          throw new Error('Working copy identity failed.');
        const row = locked.rows[0];
        if (row === undefined) {
          if (expectedRevision !== 0) return Object.freeze({outcome: 'stale'});
          if (await sourceHasEntries(client, workspaceId, sourceSnapshotId)) {
            return Object.freeze({outcome: 'source_materialized'});
          }
          expectOneAffected(
            (
              await client.query<Row>(
                INSERT_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
                [workspaceId, sourceSnapshotId, draftBody, bodySha256],
              )
            ).rowCount,
          );
          return Object.freeze({
            outcome: 'applied' as const,
            value: editingValue(
              workspaceId,
              sourceSnapshotId,
              1,
              draftBody,
              bodySha256,
            ),
          });
        }
        const current = mapWorkingCopy(workspaceId, row);
        if (current.state === 'committed') {
          return Object.freeze({outcome: 'committed', value: current});
        }
        if (current.revision !== expectedRevision) {
          return Object.freeze({outcome: 'stale', value: current});
        }
        if (
          current.bodySha256 === bodySha256 &&
          current.draftBody === draftBody
        ) {
          return Object.freeze({outcome: 'unchanged', value: current});
        }
        if (await sourceHasEntries(client, workspaceId, sourceSnapshotId)) {
          return Object.freeze({outcome: 'source_materialized'});
        }
        const nextRevision = current.revision + 1;
        integer(nextRevision, 1);
        expectOneAffected(
          (
            await client.query<Row>(
              UPDATE_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
              [
                workspaceId,
                sourceSnapshotId,
                nextRevision,
                draftBody,
                bodySha256,
                current.revision,
              ],
            )
          ).rowCount,
        );
        return Object.freeze({
          outcome: 'applied' as const,
          value: editingValue(
            workspaceId,
            sourceSnapshotId,
            nextRevision,
            draftBody,
            bodySha256,
          ),
        });
      },
    );
  }

  public restore(
    workspaceIdInput: string,
    sourceSnapshotIdInput: string,
    expectedRevisionInput: number,
  ): Promise<InformationDocumentWorkingCopyRestoreResult> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const sourceSnapshotId = canonicalUuid(sourceSnapshotIdInput);
    const expectedRevision = integer(expectedRevisionInput, 1);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(
          LOCK_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
          [workspaceId, sourceSnapshotId],
        );
        if (locked.rows.length > 1)
          throw new Error('Working copy identity failed.');
        const row = locked.rows[0];
        if (row === undefined) return 'not_found';
        const current = mapWorkingCopy(workspaceId, row);
        if (current.state === 'committed') return 'committed';
        if (current.revision !== expectedRevision) return 'stale';
        expectOneAffected(
          (
            await client.query<Row>(
              DELETE_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
              [workspaceId, sourceSnapshotId, expectedRevision],
            )
          ).rowCount,
        );
        return 'restored';
      },
    );
  }

  public commit(
    write: Readonly<InformationDocumentWorkingCopyCommit>,
  ): Promise<InformationDocumentWorkingCopyCommitResult> {
    const workspaceId = canonicalUuid(write.workspaceId);
    const sourceSnapshotId = canonicalUuid(write.sourceSnapshotId);
    const expectedRevision = integer(write.expectedRevision, 1);
    const bodySha256 = sha256(write.bodySha256);
    const derivedResourceId = canonicalUuid(write.derivedResourceId);
    const derivedSnapshotId = canonicalUuid(write.derivedSnapshotId);
    return runPostgresTransaction(
      this.#pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, workspaceId);
        const locked = await client.query<Row>(
          LOCK_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
          [workspaceId, sourceSnapshotId],
        );
        if (locked.rows.length > 1)
          throw new Error('Working copy identity failed.');
        const row = locked.rows[0];
        if (row === undefined) return Object.freeze({outcome: 'not_found'});
        const current = mapWorkingCopy(workspaceId, row);
        if (current.state === 'committed') {
          return current.bodySha256 === bodySha256 &&
            current.derivedResourceId === derivedResourceId &&
            current.derivedSnapshotId === derivedSnapshotId
            ? Object.freeze({outcome: 'existing', value: current})
            : Object.freeze({outcome: 'stale', value: current});
        }
        if (
          current.revision !== expectedRevision ||
          current.bodySha256 !== bodySha256
        ) {
          return Object.freeze({outcome: 'stale', value: current});
        }
        if (await sourceHasEntries(client, workspaceId, sourceSnapshotId)) {
          return Object.freeze({outcome: 'source_materialized'});
        }
        expectOneAffected(
          (
            await client.query<Row>(
              COMMIT_INFORMATION_DOCUMENT_WORKING_COPY_SQL,
              [
                workspaceId,
                sourceSnapshotId,
                derivedResourceId,
                derivedSnapshotId,
                expectedRevision,
              ],
            )
          ).rowCount,
        );
        return Object.freeze({
          outcome: 'committed' as const,
          value: Object.freeze({
            workspaceId,
            sourceSnapshotId,
            revision: expectedRevision,
            state: 'committed' as const,
            bodySha256,
            derivedResourceId,
            derivedSnapshotId,
          }),
        });
      },
    );
  }
}

async function sourceHasEntries(
  client: Readonly<{
    query(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<Readonly<{rows: readonly Row[]}>>;
  }>,
  workspaceId: string,
  sourceSnapshotId: string,
): Promise<boolean> {
  const result = await client.query(READ_CURRENT_SOURCE_ENTRIES_SQL, [
    workspaceId,
    sourceSnapshotId,
  ]);
  if (result.rows.length > 1) throw new Error('Source Entry probe failed.');
  return result.rows.length === 1;
}

function editingValue(
  workspaceId: string,
  sourceSnapshotId: string,
  revision: number,
  draftBody: string,
  bodySha256: string,
): Readonly<InformationDocumentWorkingCopy> {
  return Object.freeze({
    workspaceId,
    sourceSnapshotId,
    revision,
    state: 'editing' as const,
    draftBody,
    bodySha256,
  });
}

function mapWorkingCopy(
  workspaceId: string,
  row: Row,
): Readonly<InformationDocumentWorkingCopy> {
  const sourceSnapshotId = canonicalUuid(row.source_snapshot_id);
  const revision = integer(row.revision, 1);
  const state = enumValue(row.state, WORKING_COPY_STATES);
  const bodySha256 = sha256(row.body_sha256);
  const draftBody = optionalText(row.draft_body);
  const derivedResourceId = optionalUuid(row.derived_resource_id);
  const derivedSnapshotId = optionalUuid(row.derived_snapshot_id);
  if (
    (state === 'editing' &&
      (draftBody === undefined ||
        derivedResourceId !== undefined ||
        derivedSnapshotId !== undefined)) ||
    (state === 'committed' &&
      (draftBody !== undefined ||
        derivedResourceId === undefined ||
        derivedSnapshotId === undefined))
  ) {
    throw new Error('Working copy shape failed.');
  }
  return Object.freeze({
    workspaceId,
    sourceSnapshotId,
    revision,
    state,
    bodySha256,
    ...(draftBody === undefined ? {} : {draftBody}),
    ...(derivedResourceId === undefined ? {} : {derivedResourceId}),
    ...(derivedSnapshotId === undefined ? {} : {derivedSnapshotId}),
  });
}

function optionalUuid(value: unknown): string | undefined {
  return value === null ? undefined : canonicalUuid(value);
}

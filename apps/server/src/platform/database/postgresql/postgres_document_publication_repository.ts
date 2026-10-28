import {randomUUID} from 'node:crypto';
import {
  publicationContentSchema,
  organizationStatusSchema,
  type DocumentPublicationRepository,
  type PublicationCommit,
  type PublicationStatus,
} from '../../../application/document_publication_contract.js';
import {intakeRecordValueSchema} from '../../../application/document_intake_contract.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';
import {loadCurrentInformationEntriesByIds} from './postgres_information_entry_repository.js';
import {PostgresAdapterError, optionalText} from './postgres_values.js';

type Row = Readonly<Record<string, unknown>>;
const publicationFrom = `FROM struinfo.document_publication_pointer p
  JOIN struinfo.document_publication_version v USING (workspace_id, document_id, publication_id)
  JOIN struinfo.document_organization_work w USING (workspace_id, publication_id)`;
const selectPublication = `SELECT v.*, w.status, w.current_version, w.error_code ${publicationFrom}`;

/** One transaction freezes reading, advances the pointer and records deferred work. */
export class PostgresDocumentPublicationRepository implements DocumentPublicationRepository {
  public constructor(
    private readonly pool: PostgresPoolBoundary,
    private readonly workspaceId: string,
  ) {}

  public async commit(input: PublicationCommit) {
    const intake = intakeRecordValueSchema.parse(input.intake);
    const confirmation = intake.publication;
    if (!confirmation || confirmation.draft) return {status: 'stale' as const};
    return runPostgresTransaction(
      this.pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, this.workspaceId);
        const current = (
          await client.query(
            `SELECT current_version, state_text FROM struinfo.processing_document_intake
        WHERE workspace_id=$1 AND snapshot_id=$2 FOR UPDATE`,
            [this.workspaceId, input.documentId],
          )
        ).rows[0];
        if (
          Number(current?.current_version ?? 0) !== input.expectedIntakeVersion
        )
          return {status: 'stale' as const};
        const previous = current
          ? intakeRecordValueSchema.parse(
              JSON.parse(String(current.state_text)),
            )
          : undefined;
        if (
          previous &&
          (previous.decision !== 'admitted' ||
            (previous.receipt && previous.receipt !== 'accepted'))
        )
          return {status: 'not_admitted' as const};
        const selectedSnapshot =
          previous?.bodySource === 'received'
            ? input.documentId
            : (previous?.preparedSnapshotId ?? input.documentId);
        if (selectedSnapshot !== input.snapshotId)
          return {status: 'stale' as const};
        const privateSources = await client.query(
          `SELECT s.snapshot_id FROM struinfo.snapshot s
        JOIN struinfo.resource r USING (workspace_id,resource_id)
        WHERE s.workspace_id=$1 AND s.snapshot_id=ANY($2::uuid[]) AND r.is_private`,
          [this.workspaceId, [input.documentId, input.snapshotId]],
        );
        if (privateSources.rows.length)
          return {status: 'not_admitted' as const};
        const ids = (
          await client.query(
            `SELECT e.entry_id::text FROM struinfo.information_entry e
        JOIN struinfo.resource r USING (workspace_id,resource_id)
        WHERE e.workspace_id=$1 AND e.snapshot_id=$2 AND e.is_current_structure
          AND NOT e.is_private AND NOT r.is_private ORDER BY e.document_order,e.entry_id`,
            [this.workspaceId, input.snapshotId],
          )
        ).rows.map((r) => String(r.entry_id));
        const entries = await loadCurrentInformationEntriesByIds(
          client,
          this.workspaceId,
          false,
          ids,
        );
        if (
          !entries.length ||
          entries.length !== input.expectedEntries.length ||
          new Set(input.expectedEntries.map((e) => e.entryId)).size !==
            entries.length ||
          entries.some(
            (e) =>
              !input.expectedEntries.some(
                (v) => v.entryId === e.entryId && v.revision === e.revision,
              ),
          )
        )
          return {status: 'stale' as const};
        const first = entries[0];
        if (!first) return {status: 'stale' as const};
        const content = publicationContentSchema.parse({
          schemaVersion: 1,
          documentId: input.documentId,
          snapshotId: input.snapshotId,
          source: {
            resourceId: first.resourceId,
            sourceKey: first.sourceKey,
            ...(first.canonicalUri ? {canonicalUri: first.canonicalUri} : {}),
          },
          times: {
            receivedAt: first.capturedAt,
            sourcePublishedAt: first.publishedAt ?? null,
            eventAt: null,
            lastVerifiedAt: null,
          },
          entries,
        });
        const old = (
          await client.query(
            `${selectPublication} WHERE p.workspace_id=$1 AND p.document_id=$2`,
            [this.workspaceId, input.documentId],
          )
        ).rows[0];
        // Reconfirming identical content never creates another background job.
        const same =
          old &&
          JSON.stringify(
            publicationContentSchema.parse(
              JSON.parse(String(old.content_text)),
            ),
          ) === JSON.stringify(content);
        const publicationId = same ? String(old.publication_id) : randomUUID();
        const confirmedAt = same
          ? iso(old.confirmed_at)
          : confirmation.confirmedAt;
        const state = {
          ...intake,
          ...(previous?.inboxSummary
            ? {inboxSummary: previous.inboxSummary}
            : {}),
          publication: {...confirmation, confirmedAt},
        };
        if (!current) {
          await client.query(
            `INSERT INTO struinfo.processing_document_intake
          (workspace_id,snapshot_id,prepared_snapshot_id,state_text) VALUES ($1,$2,$3,$4)`,
            [
              this.workspaceId,
              input.documentId,
              state.preparedSnapshotId ?? null,
              JSON.stringify(state),
            ],
          );
        } else {
          await client.query(
            `UPDATE struinfo.processing_document_intake SET state_text=$3, current_version=current_version+1,
          updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND snapshot_id=$2`,
            [this.workspaceId, input.documentId, JSON.stringify(state)],
          );
        }
        if (!same) {
          await client.query(
            `INSERT INTO struinfo.document_publication_version
          (workspace_id,publication_id,document_id,snapshot_id,content_text,confirmed_at,origin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              this.workspaceId,
              publicationId,
              input.documentId,
              input.snapshotId,
              JSON.stringify(content),
              confirmedAt,
              confirmation.origin,
            ],
          );
          await client.query(
            `INSERT INTO struinfo.document_organization_work (workspace_id,publication_id) VALUES ($1,$2)`,
            [this.workspaceId, publicationId],
          );
          if (old)
            await client.query(
              `UPDATE struinfo.document_organization_work
          SET status='superseded',current_version=current_version+1,updated_at=CURRENT_TIMESTAMP
          WHERE workspace_id=$1 AND publication_id=$2 AND status IN ('pending','running','paused','failed')`,
              [this.workspaceId, old.publication_id],
            );
          await client.query(
            `INSERT INTO struinfo.document_publication_pointer (workspace_id,document_id,publication_id) VALUES ($1,$2,$3)
          ON CONFLICT (workspace_id,document_id) DO UPDATE SET publication_id=EXCLUDED.publication_id`,
            [this.workspaceId, input.documentId, publicationId],
          );
        }
        const row = (
          await client.query(
            `${selectPublication} WHERE p.workspace_id=$1 AND p.document_id=$2`,
            [this.workspaceId, input.documentId],
          )
        ).rows[0];
        if (!row) throw new PostgresAdapterError();
        return {status: 'published' as const, publication: decodeStatus(row)};
      },
    );
  }

  public async read(documentId: string) {
    const row = (
      await this.pool.query(
        `${selectPublication} WHERE p.workspace_id=$1 AND p.document_id=$2`,
        [this.workspaceId, documentId],
      )
    ).rows[0];
    return row ? decodeStatus(row) : undefined;
  }

  public async confirmationTimes(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.pool.query(
      `SELECT v.snapshot_id,v.confirmed_at ${publicationFrom} WHERE p.workspace_id=$1`,
      [this.workspaceId],
    );
    return new Map(
      rows.rows.map((r) => [String(r.snapshot_id), iso(r.confirmed_at)]),
    );
  }
  public async forSnapshot(snapshotId: string) {
    const row = (
      await this.pool.query(
        `${selectPublication} WHERE p.workspace_id=$1 AND v.snapshot_id=$2`,
        [this.workspaceId, snapshotId],
      )
    ).rows[0];
    return row ? decodeStatus(row) : undefined;
  }

  public async loadPublished(workspaceId: string, includePrivate: boolean) {
    if (workspaceId !== this.workspaceId)
      return {managedSnapshotIds: new Set<string>(), entries: []};
    return runPostgresTransaction(
      this.pool,
      'repeatable_read_only',
      async (client) => {
        const all = await client.query(
          `SELECT DISTINCT document_id::text,snapshot_id::text FROM struinfo.document_publication_version WHERE workspace_id=$1`,
          [workspaceId],
        );
        const rows = await client.query(
          `SELECT v.content_text, (r.is_private OR original_source.is_private) AS source_private,
            ARRAY(SELECT e.entry_id::text FROM struinfo.information_entry e
              WHERE e.workspace_id=v.workspace_id AND e.snapshot_id=v.snapshot_id AND e.is_private) AS private_entry_ids
        ${publicationFrom}
        JOIN struinfo.processing_document_intake i ON i.workspace_id=p.workspace_id AND i.snapshot_id=p.document_id
        JOIN struinfo.snapshot s ON s.workspace_id=v.workspace_id AND s.snapshot_id=v.snapshot_id
        JOIN struinfo.resource r ON r.workspace_id=s.workspace_id AND r.resource_id=s.resource_id
        JOIN struinfo.snapshot original ON original.workspace_id=p.workspace_id AND original.snapshot_id=p.document_id
        JOIN struinfo.resource original_source ON original_source.workspace_id=original.workspace_id AND original_source.resource_id=original.resource_id
        WHERE p.workspace_id=$1 AND i.state_text::jsonb->>'decision'='admitted'
          AND COALESCE(i.state_text::jsonb->>'receipt','accepted')='accepted'
          AND ($2::boolean OR (NOT r.is_private AND NOT original_source.is_private AND NOT EXISTS (
            SELECT 1 FROM struinfo.information_entry e
            WHERE e.workspace_id=v.workspace_id AND e.snapshot_id=v.snapshot_id AND e.is_private)))`,
          [workspaceId, includePrivate],
        );
        return {
          managedSnapshotIds: new Set(
            all.rows.flatMap((r) => [
              String(r.document_id),
              String(r.snapshot_id),
            ]),
          ),
          entries: rows.rows
            .flatMap((r) =>
              publicationContentSchema
                .parse(JSON.parse(String(r.content_text)))
                .entries.map((e) =>
                  r.source_private === true ||
                  (r.private_entry_ids as string[]).includes(e.entryId)
                    ? {...e, value: {...e.value, isPrivate: true}}
                    : e,
                ),
            )
            .filter((e) => includePrivate || !e.value.isPrivate),
        };
      },
    );
  }

  public async transitionOrganization(
    input: Parameters<
      DocumentPublicationRepository['transitionOrganization']
    >[0],
  ) {
    const allowed: Readonly<Record<string, readonly string[]>> = {
      pending: ['running', 'paused'],
      running: ['succeeded', 'failed', 'paused'],
      paused: ['pending'],
      failed: ['pending'],
    };
    if (
      !allowed[input.from]?.includes(input.to) ||
      (input.to === 'failed' && !input.errorCode)
    )
      return false;
    if (input.errorCode && !/^[a-z0-9_]{1,160}$/u.test(input.errorCode))
      return false;
    const result = await this.pool.query(
      `UPDATE struinfo.document_organization_work w
      SET status=$4, error_code=$5,current_version=w.current_version+1,updated_at=CURRENT_TIMESTAMP
      FROM struinfo.document_publication_pointer p, struinfo.processing_document_intake i
      WHERE w.workspace_id=$1 AND w.publication_id=$2 AND w.current_version=$3 AND w.status=$6
        AND p.workspace_id=w.workspace_id AND p.publication_id=w.publication_id
        AND i.workspace_id=p.workspace_id AND i.snapshot_id=p.document_id
        AND i.state_text::jsonb->>'decision'='admitted'
        AND COALESCE(i.state_text::jsonb->>'receipt','accepted')='accepted'
        AND NOT EXISTS (
          SELECT 1 FROM struinfo.document_publication_version v
          JOIN struinfo.snapshot s ON s.workspace_id=v.workspace_id AND s.snapshot_id IN (v.snapshot_id,v.document_id)
          JOIN struinfo.resource r ON r.workspace_id=s.workspace_id AND r.resource_id=s.resource_id
          WHERE v.workspace_id=w.workspace_id AND v.publication_id=w.publication_id AND r.is_private)
        AND NOT EXISTS (
          SELECT 1 FROM struinfo.document_publication_version v
          JOIN struinfo.information_entry e ON e.workspace_id=v.workspace_id AND e.snapshot_id=v.snapshot_id
          WHERE v.workspace_id=w.workspace_id AND v.publication_id=w.publication_id AND e.is_private)`,
      [
        this.workspaceId,
        input.publicationId,
        input.expectedVersion,
        input.to,
        input.errorCode ?? null,
        input.from,
      ],
    );
    return result.rowCount === 1;
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
function decodeStatus(row: Row): PublicationStatus {
  const content = publicationContentSchema.parse(
    JSON.parse(String(row.content_text)),
  );
  return {
    publicationId: String(row.publication_id),
    documentId: content.documentId,
    snapshotId: content.snapshotId,
    confirmedAt: iso(row.confirmed_at),
    times: content.times,
    entries: content.entries.map((e) => ({
      entryId: e.entryId,
      revision: e.revision,
    })),
    organization: {
      status: organizationStatusSchema.parse(row.status),
      version: Number(row.current_version),
      errorCode: optionalText(row.error_code) ?? null,
    },
  };
}

import {
  assertM1cDomainWorkspace,
  M1C_DOMAIN_BUNDLE_SCHEMA,
  M1C_DOMAIN_TABLES,
  normalizeM1cDomainSnapshot,
} from '../../../workspace_transfer/m1c_domain_bundle.js';
import {
  assertM1dAssociationWorkspace,
  M1D_ASSOCIATION_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_TABLES,
  normalizeM1dAssociationSnapshot,
} from '../../../workspace_transfer/m1d_association_bundle.js';
import {
  assertM1dEntryWorkspace,
  M1D_ENTRY_BUNDLE_SCHEMA,
  M1D_ENTRY_TABLES,
  normalizeM1dEntrySnapshot,
} from '../../../workspace_transfer/m1d_entry_bundle.js';
import {
  type M1cDomainTransferRepositoryPort,
  M1cDomainTransferRepositoryError,
  type M1cWorkspaceTransferSnapshot,
} from '../../../workspace_transfer/m1c_workspace_transfer.js';
import {
  assertM1eProcessingWorkspace,
  M1E_PROCESSING_BUNDLE_SCHEMA,
  M1E_PROCESSING_TABLES,
  normalizeM1eProcessingSnapshot,
} from '../../../workspace_transfer/m1e_processing_bundle.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {canonicalUuid} from './postgres_values.js';
import {deriveWorkspaceWriteLockKey} from './workspace_write_lock.js';

export const ACQUIRE_WORKSPACE_TRANSFER_LOCK_SQL =
  'SELECT pg_advisory_xact_lock($1::bigint)' as const;
export const READ_WORKSPACE_FOR_TRANSFER_SQL =
  'SELECT workspace_id::text FROM struinfo.workspace WHERE workspace_id = $1' as const;
export const DEFER_WORKSPACE_RESTORE_CONSTRAINTS_SQL =
  'SET CONSTRAINTS ALL DEFERRED' as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresM1cDomainTransferRepository implements M1cDomainTransferRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public async exportWorkspace(
    effectiveWorkspaceId: string,
  ): Promise<Readonly<M1cWorkspaceTransferSnapshot>> {
    const workspaceId = canonicalUuid(effectiveWorkspaceId);
    let rawSnapshot: Readonly<{
      domainTables: readonly RawTableSnapshot[];
      entryTables: readonly RawTableSnapshot[];
      associationTables: readonly RawTableSnapshot[];
      processingTables: readonly RawTableSnapshot[];
    }>;
    try {
      rawSnapshot = await runPostgresTransaction(
        this.#pool,
        'repeatable_read_only',
        async (client) => {
          const domainTables = await readTables(
            client,
            workspaceId,
            M1C_DOMAIN_TABLES,
          );
          const entryTables = await readTables(
            client,
            workspaceId,
            M1D_ENTRY_TABLES,
          );
          const associationTables = await readTables(
            client,
            workspaceId,
            M1D_ASSOCIATION_TABLES,
          );
          const processingTables = await readTables(
            client,
            workspaceId,
            M1E_PROCESSING_TABLES,
          );
          return Object.freeze({
            domainTables,
            entryTables,
            associationTables,
            processingTables,
          });
        },
      );
    } catch {
      throw new M1cDomainTransferRepositoryError('repository_failed');
    }
    if (rawSnapshot.domainTables[0]?.rows.length !== 1) {
      throw new M1cDomainTransferRepositoryError('workspace_not_found');
    }
    try {
      const domain = normalizeM1cDomainSnapshot({
        schemaVersion: M1C_DOMAIN_BUNDLE_SCHEMA,
        tables: rawSnapshot.domainTables,
      });
      const entries = normalizeM1dEntrySnapshot({
        schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
        tables: rawSnapshot.entryTables,
      });
      const associations = normalizeM1dAssociationSnapshot({
        schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
        tables: rawSnapshot.associationTables,
      });
      const processing = normalizeM1eProcessingSnapshot({
        schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
        tables: rawSnapshot.processingTables,
      });
      assertM1cDomainWorkspace(domain, workspaceId);
      assertM1dEntryWorkspace(entries, workspaceId);
      assertM1dAssociationWorkspace(associations, workspaceId);
      assertM1eProcessingWorkspace(processing, workspaceId);
      return Object.freeze({domain, entries, associations, processing});
    } catch {
      throw new M1cDomainTransferRepositoryError('repository_failed');
    }
  }

  public async restoreEmptyWorkspace(
    effectiveWorkspaceId: string,
    snapshotInput: Readonly<M1cWorkspaceTransferSnapshot>,
  ): Promise<void> {
    const workspaceId = canonicalUuid(effectiveWorkspaceId);
    let snapshot: Readonly<M1cWorkspaceTransferSnapshot>;
    try {
      const domain = normalizeM1cDomainSnapshot(snapshotInput.domain);
      const entries = normalizeM1dEntrySnapshot(snapshotInput.entries);
      const associations = normalizeM1dAssociationSnapshot(
        snapshotInput.associations,
      );
      const processing = normalizeM1eProcessingSnapshot(
        snapshotInput.processing,
      );
      assertM1cDomainWorkspace(domain, workspaceId);
      assertM1dEntryWorkspace(entries, workspaceId);
      assertM1dAssociationWorkspace(associations, workspaceId);
      assertM1eProcessingWorkspace(processing, workspaceId);
      snapshot = Object.freeze({domain, entries, associations, processing});
    } catch {
      throw new M1cDomainTransferRepositoryError('repository_failed');
    }

    let restored: boolean;
    try {
      restored = await runPostgresTransaction(
        this.#pool,
        'read_committed',
        async (client) => restoreInTransaction(client, workspaceId, snapshot),
      );
    } catch {
      throw new M1cDomainTransferRepositoryError('repository_failed');
    }
    if (!restored) {
      throw new M1cDomainTransferRepositoryError('workspace_not_empty');
    }
  }
}

async function restoreInTransaction(
  client: PostgresClientBoundary,
  workspaceId: string,
  snapshot: Readonly<M1cWorkspaceTransferSnapshot>,
): Promise<boolean> {
  await client.query(ACQUIRE_WORKSPACE_TRANSFER_LOCK_SQL, [
    deriveWorkspaceWriteLockKey(workspaceId),
  ]);
  const existing = await client.query<Readonly<{workspace_id: unknown}>>(
    READ_WORKSPACE_FOR_TRANSFER_SQL,
    [workspaceId],
  );
  if (existing.rows.length !== 0) return false;
  await client.query(DEFER_WORKSPACE_RESTORE_CONSTRAINTS_SQL);
  for (const tableSnapshot of [
    ...snapshot.domain.tables,
    ...snapshot.entries.tables,
    ...snapshot.associations.tables,
    ...snapshot.processing.tables,
  ]) {
    if (tableSnapshot.rows.length === 0) continue;
    await client.query<Row>(insertTableSql(tableSnapshot.name), [
      JSON.stringify(tableSnapshot.rows),
    ]);
  }
  return true;
}

interface RawTableSnapshot {
  readonly name: string;
  readonly rows: readonly unknown[];
}

async function readTables(
  client: PostgresClientBoundary,
  workspaceId: string,
  descriptors: readonly Readonly<{name: string}>[],
): Promise<readonly Readonly<RawTableSnapshot>[]> {
  const tables: Readonly<RawTableSnapshot>[] = [];
  for (const descriptor of descriptors) {
    const result = await client.query<Readonly<{row_payload: unknown}>>(
      selectTableSql(descriptor.name),
      [workspaceId],
    );
    tables.push(
      Object.freeze({
        name: descriptor.name,
        rows: Object.freeze(result.rows.map((row) => row.row_payload)),
      }),
    );
  }
  return Object.freeze(tables);
}

function selectTableSql(tableName: string): string {
  return `SELECT to_jsonb(t) AS row_payload FROM struinfo.${tableName} AS t WHERE workspace_id = $1`;
}

function insertTableSql(tableName: string): string {
  return `INSERT INTO struinfo.${tableName} SELECT * FROM jsonb_populate_recordset(NULL::struinfo.${tableName}, $1::jsonb)`;
}

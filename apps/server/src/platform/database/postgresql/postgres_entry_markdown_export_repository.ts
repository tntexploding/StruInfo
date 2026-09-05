import {
  decodeEntryMarkdownExportRequest,
  type EntryMarkdownExportRead,
  type EntryMarkdownExportRepositoryPort,
  type EntryMarkdownExportRequest,
} from '../../../modules/entries/information_entry_markdown_export.js';
import type {EvidenceSnapshotReadState} from '../../../modules/evidence/evidence_read_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {canonicalUuid, PostgresAdapterError} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';
import {loadCurrentInformationEntriesByIds} from './postgres_information_entry_repository.js';
import {loadEvidenceSnapshot} from './postgres_evidence_read_repository.js';
import {
  READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
  READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL,
  mapProjection,
  mapOverride,
} from './postgres_information_entry_association_repository.js';

function betweenSelected(query: string, alias: string): string {
  return query.replace(
    'ORDER BY',
    'AND ' +
      alias +
      '.entry_low_id = ANY($3::uuid[]) AND ' +
      alias +
      '.entry_high_id = ANY($3::uuid[]) ORDER BY',
  );
}
export const READ_EXPORT_PROJECTIONS_SQL = betweenSelected(
  READ_INFORMATION_ENTRY_ASSOCIATION_PROJECTIONS_SQL,
  'projection',
);
export const READ_EXPORT_OVERRIDES_SQL = betweenSelected(
  READ_INFORMATION_ENTRY_ASSOCIATION_OVERRIDES_SQL,
  'override',
);

/** Read-only domain state, serialized with current-state writers through file creation. */
export class PostgresEntryMarkdownExportRepository implements EntryMarkdownExportRepositoryPort {
  public constructor(private readonly pool: PostgresPoolBoundary) {}
  public withSelection<Result>(
    workspaceIdInput: string,
    input: Readonly<EntryMarkdownExportRequest>,
    work: (selection: Readonly<EntryMarkdownExportRead>) => Promise<Result>,
  ): Promise<Result> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    const request = decodeEntryMarkdownExportRequest(
      input,
      input.expectedSha256 !== undefined,
    );
    if (request === undefined) throw new PostgresAdapterError();
    return runPostgresTransaction(
      this.pool,
      'read_committed',
      async (client) => {
        // READ COMMITTED obtains current state after a possibly waiting lock.
        await acquireWorkspaceWriteLock(client, workspaceId);
        const ids = request.entries.map((entry) => entry.entryId);
        const includePrivate = request.privacyScope !== 'public';
        const entries = (
          await loadCurrentInformationEntriesByIds(
            client,
            workspaceId,
            includePrivate,
            ids,
          )
        ).filter(
          (entry) =>
            request.privacyScope !== 'private_only' || entry.value.isPrivate,
        );
        const snapshots: EvidenceSnapshotReadState[] = [];
        for (const snapshotId of new Set(
          entries.map((entry) => entry.snapshotId),
        )) {
          const snapshot = await loadEvidenceSnapshot(
            client,
            workspaceId,
            snapshotId,
          );
          if (snapshot !== undefined) snapshots.push(snapshot);
        }
        const parameters = [
          workspaceId,
          includePrivate,
          entries.map((entry) => entry.entryId),
        ];
        const projections = await client.query<Record<string, unknown>>(
          READ_EXPORT_PROJECTIONS_SQL,
          parameters,
        );
        const overrides = await client.query<Record<string, unknown>>(
          READ_EXPORT_OVERRIDES_SQL,
          parameters,
        );
        return work(
          Object.freeze({
            entries: Object.freeze(entries),
            snapshots: Object.freeze(snapshots),
            associations: Object.freeze({
              projections: Object.freeze(projections.rows.map(mapProjection)),
              overrides: Object.freeze(overrides.rows.map(mapOverride)),
            }),
          }),
        );
      },
    );
  }
}

import {deepStrictEqual, ok, strictEqual} from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {BlobStore} from '../apps/server/src/storage/blob_store.js';
import type {EntryMarkdownExportRequest} from '../apps/server/src/modules/entries/information_entry_markdown_export.js';
import {EntryMarkdownExportService} from '../apps/server/src/modules/entries/information_entry_markdown_export_service.js';
import {LocalEntryMarkdownFileStore} from '../apps/server/src/platform/storage/local_entry_markdown_file_store.js';
import {PostgresEntryMarkdownExportRepository} from '../apps/server/src/platform/database/postgresql/postgres_entry_markdown_export_repository.js';
import {READ_CURRENT_INFORMATION_ENTRIES_BY_ID_SQL} from '../apps/server/src/platform/database/postgresql/postgres_information_entry_repository.js';
import {
  createPostgresRepositories,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {
  ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
  deriveWorkspaceWriteLockKey,
} from '../apps/server/src/platform/database/postgresql/workspace_write_lock.js';

/** Only the owned disposable synthetic database and its temporary external exports. */
export async function verifyMarkdownExportCandidate(
  pool: PostgresPoolBoundary,
  workspaceId: string,
  blobStore: BlobStore,
  exportsRoot: string,
) {
  const identity = await pool.query<{database_name: string; role_name: string}>(
    'SELECT current_database() AS database_name, current_user AS role_name',
  );
  strictEqual(identity.rows[0]?.database_name, 'struinfo_m2_p0d');
  strictEqual(identity.rows[0].role_name, 'struinfo_tm2_runtime');
  const repositories = createPostgresRepositories(pool);
  const initial = await repositories.informationEntries.loadCurrentEntries(
    workspaceId,
    true,
  );
  ok(
    initial.length >= 8 &&
      initial.every((entry) => entry.sourceKey.startsWith('synthetic:m2-p0d:')),
  );
  const selected = initial
    .filter((entry) => !entry.value.isPrivate)
    .slice(0, 2);
  ok(selected.length === 2);
  const [first] = selected;
  ok(first !== undefined);
  let maximumHydratedEntries = 0;
  let fileWrites = 0;
  let blobReads = 0;
  const statements: string[] = [];
  const measuredPool: PostgresPoolBoundary = {
    query: pool.query.bind(pool),
    end: () => Promise.resolve(),
    async connect() {
      const client = await pool.connect();
      return {
        release: client.release.bind(client),
        executeSimple: client.executeSimple.bind(client),
        async query<Row extends Readonly<Record<string, unknown>>>(
          sql: string,
          parameters?: readonly unknown[],
        ) {
          statements.push(sql);
          const result = await client.query<Row>(sql, parameters);
          if (sql === READ_CURRENT_INFORMATION_ENTRIES_BY_ID_SQL)
            maximumHydratedEntries = Math.max(
              maximumHydratedEntries,
              result.rows.length,
            );
          return result;
        },
      };
    },
  };
  const files = new LocalEntryMarkdownFileStore(exportsRoot);
  const service = new EntryMarkdownExportService({
    workspaceId,
    repository: new PostgresEntryMarkdownExportRepository(measuredPool),
    blobStore: {
      put: () => Promise.reject(new Error('No export Blob writes')),
      read: (identity) => {
        blobReads += 1;
        return blobStore.read(identity);
      },
    },
    files: {
      write: (id, bytes) => {
        fileWrites += 1;
        return files.write(id, bytes);
      },
    },
  });
  const request: EntryMarkdownExportRequest = {
    title: 'Synthetic cited list',
    privacyScope: 'public',
    entries: selected.map(({entryId, revision, revisionId}) => ({
      entryId,
      revision,
      revisionId,
    })),
  };
  const before =
    await repositories.workspaceTransfer.exportWorkspace(workspaceId);
  const preview = await service.preview(request);
  ok(
    preview.status === 'ready',
    'Synthetic Markdown preview must materialize exact evidence.',
  );
  strictEqual(fileWrites, 0);
  const generated = await service.generate({
    ...request,
    expectedSha256: preview.preview.sha256,
  });
  ok(generated.status === 'exported');
  strictEqual(
    await readFile(join(exportsRoot, generated.file.fileName), 'utf8'),
    preview.preview.markdown,
  );
  deepStrictEqual(
    await repositories.workspaceTransfer.exportWorkspace(workspaceId),
    before,
  );
  ok(
    statements.every(
      (sql) => !/^(INSERT|UPDATE|DELETE|ALTER|CREATE)/u.test(sql),
    ),
  );
  ok(maximumHydratedEntries <= 2);

  // A change committed while export waits on the same lock invalidates the selection.
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL, [
      deriveWorkspaceWriteLockKey(workspaceId),
    ]);
    const pending = service.generate({
      ...request,
      expectedSha256: preview.preview.sha256,
    });
    await blocker.query(
      'UPDATE struinfo.information_entry SET current_revision = current_revision + 1, current_revision_id = $3 WHERE workspace_id = $1 AND entry_id = $2',
      [workspaceId, first.entryId, randomUUID()],
    );
    await blocker.query('COMMIT');
    deepStrictEqual(await pending, {
      status: 'rejected',
      issue: {code: 'selection_stale'},
    });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  strictEqual(fileWrites, 1);
  const privateEntry = initial.find((entry) => entry.value.isPrivate);
  ok(privateEntry !== undefined);
  const privateRequest: EntryMarkdownExportRequest = {
    ...request,
    entries: [
      {
        entryId: privateEntry.entryId,
        revision: privateEntry.revision,
        revisionId: privateEntry.revisionId,
      },
    ],
  };
  const readsBeforePrivate = blobReads;
  deepStrictEqual(await service.preview(privateRequest), {
    status: 'rejected',
    issue: {code: 'selection_unavailable'},
  });
  strictEqual(blobReads, readsBeforePrivate);
  const privatePreview = await service.preview({
    ...privateRequest,
    privacyScope: 'private_only',
  });
  ok(
    privatePreview.status === 'ready' &&
      privatePreview.preview.entries[0]?.isPrivate === true,
  );
  const retired = await pool.query<{
    entry_id: string;
    current_revision: number;
    current_revision_id: string;
  }>(
    'SELECT entry_id::text, current_revision, current_revision_id::text FROM struinfo.information_entry WHERE workspace_id = $1 AND NOT is_current_structure LIMIT 1',
    [workspaceId],
  );
  const old = retired.rows[0];
  ok(old !== undefined);
  deepStrictEqual(
    await service.preview({
      ...request,
      entries: [
        {
          entryId: old.entry_id,
          revision: old.current_revision,
          revisionId: old.current_revision_id,
        },
      ],
    }),
    {status: 'rejected', issue: {code: 'selection_unavailable'}},
  );
  return Object.freeze({
    selectedEntryCount: selected.length,
    maximumHydratedEntries,
    exactFileBytes: true,
    domainStateUnchanged: true,
    waitedEntryRevisionRejected: true,
    privacyBeforeBlob: true,
    privateOptInPassed: true,
    retiredEntryRejected: true,
  });
}

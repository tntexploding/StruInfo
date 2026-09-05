import {createHash, randomUUID} from 'node:crypto';
import {
  lstat,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';

import {DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_BYTES} from '../../workspace_transfer/workspace_bundle.js';
import {
  WorkspaceBundleFileStoreError,
  type StoredWorkspaceBundleFile,
  type WorkspaceBundleFileStore,
} from '../../workspace_transfer/workspace_bundle_file_store.js';

const FILE_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(?:personal-data|workspace-bundle)\.json$/u;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CURRENT_BACKUP_FILE_NAME_PATTERN =
  /^(?<workspaceId>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?<stamp>[0-9]{17})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.personal-data\.json$/u;

export interface LocalWorkspaceBackupCatalogEntry {
  readonly fileName: string;
  readonly exportedAt: string;
  readonly byteLength: number;
}

export interface LocalWorkspaceBackupCatalog {
  readonly totalCount: number;
  readonly entries: readonly Readonly<LocalWorkspaceBackupCatalogEntry>[];
}

export interface LocalWorkspaceBackupRetentionPreview {
  readonly keepLatest: number;
  readonly totalCount: number;
  readonly retainedCount: number;
  readonly removalCandidateCount: number;
  readonly removalCandidates: readonly string[];
  readonly truncated: boolean;
}

const MAXIMUM_CATALOG_RESULT_COUNT = 100;
const MAXIMUM_RETENTION_COUNT = 10_000;

/** External, direct-child-only personal-data files under the configured exports area. */
export class LocalWorkspaceBundleFileStore implements WorkspaceBundleFileStore {
  readonly #exportsRoot: string;

  public constructor(exportsRoot: string) {
    this.#exportsRoot = exportsRoot;
  }

  public async write(
    workspaceId: string,
    exportedAt: string,
    bytes: Uint8Array,
  ): Promise<Readonly<StoredWorkspaceBundleFile>> {
    if (
      !CANONICAL_UUID.test(workspaceId) ||
      !isCanonicalTimestamp(exportedAt) ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_BYTES
    ) {
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
    const owned = Uint8Array.from(bytes);
    const digest = createHash('sha256').update(owned).digest('hex');
    const stamp = exportedAt.replaceAll(/[^0-9]/gu, '');
    const fileName = `${workspaceId}-${stamp}-${randomUUID()}.personal-data.json`;
    const targetPath = join(this.#exportsRoot, fileName);
    const temporaryPath = join(this.#exportsRoot, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, owned, {flag: 'wx', mode: 0o600});
      const handle = await open(temporaryPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, targetPath);
      return Object.freeze({
        fileName,
        byteLength: owned.byteLength,
        sha256: digest,
      });
    } catch {
      await removeIfPresent(temporaryPath);
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
  }

  public async read(fileName: string): Promise<Uint8Array> {
    if (!FILE_NAME_PATTERN.test(fileName)) {
      throw new WorkspaceBundleFileStoreError('file_name_invalid');
    }
    const targetPath = join(this.#exportsRoot, fileName);
    let status;
    try {
      status = await lstat(targetPath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new WorkspaceBundleFileStoreError('file_not_found');
      }
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
    if (status.size > DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_BYTES) {
      throw new WorkspaceBundleFileStoreError('file_too_large');
    }
    try {
      const bytes = Uint8Array.from(await readFile(targetPath));
      if (bytes.byteLength !== status.size) {
        throw new WorkspaceBundleFileStoreError('storage_unavailable');
      }
      return bytes;
    } catch (error) {
      if (error instanceof WorkspaceBundleFileStoreError) throw error;
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
  }

  /** Lists only current-format backups for one workspace, newest first. */
  public async list(
    workspaceId: string,
    limit: number,
  ): Promise<Readonly<LocalWorkspaceBackupCatalog>> {
    if (
      !CANONICAL_UUID.test(workspaceId) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAXIMUM_CATALOG_RESULT_COUNT
    ) {
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
    const entries = await this.#readCatalog(workspaceId);
    return Object.freeze({
      totalCount: entries.length,
      entries: Object.freeze(entries.slice(0, limit)),
    });
  }

  /** Produces a bounded removal preview. It never changes backup files. */
  public async previewRetention(
    workspaceId: string,
    keepLatest: number,
  ): Promise<Readonly<LocalWorkspaceBackupRetentionPreview>> {
    if (
      !CANONICAL_UUID.test(workspaceId) ||
      !Number.isSafeInteger(keepLatest) ||
      keepLatest < 1 ||
      keepLatest > MAXIMUM_RETENTION_COUNT
    ) {
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
    const entries = await this.#readCatalog(workspaceId);
    const candidates = entries.slice(keepLatest);
    const visibleCandidates = candidates.slice(0, MAXIMUM_CATALOG_RESULT_COUNT);
    return Object.freeze({
      keepLatest,
      totalCount: entries.length,
      retainedCount: Math.min(entries.length, keepLatest),
      removalCandidateCount: candidates.length,
      removalCandidates: Object.freeze(
        visibleCandidates.map((entry) => entry.fileName),
      ),
      truncated: visibleCandidates.length !== candidates.length,
    });
  }

  async #readCatalog(
    workspaceId: string,
  ): Promise<readonly Readonly<LocalWorkspaceBackupCatalogEntry>[]> {
    try {
      const directoryEntries = await readdir(this.#exportsRoot, {
        withFileTypes: true,
      });
      const catalog: Readonly<LocalWorkspaceBackupCatalogEntry>[] = [];
      for (const directoryEntry of directoryEntries) {
        if (!directoryEntry.isFile()) continue;
        const parsed = parseCurrentBackupFileName(directoryEntry.name);
        if (parsed?.workspaceId !== workspaceId) continue;
        const status = await lstat(
          join(this.#exportsRoot, directoryEntry.name),
        );
        if (status.isSymbolicLink() || !status.isFile()) continue;
        catalog.push(
          Object.freeze({
            fileName: directoryEntry.name,
            exportedAt: parsed.exportedAt,
            byteLength: status.size,
          }),
        );
      }
      return Object.freeze(
        catalog.sort(
          (left, right) =>
            right.exportedAt.localeCompare(left.exportedAt) ||
            right.fileName.localeCompare(left.fileName),
        ),
      );
    } catch {
      throw new WorkspaceBundleFileStoreError('storage_unavailable');
    }
  }
}

function parseCurrentBackupFileName(
  fileName: string,
): Readonly<{workspaceId: string; exportedAt: string}> | undefined {
  const match = CURRENT_BACKUP_FILE_NAME_PATTERN.exec(fileName);
  const workspaceId = match?.groups?.workspaceId;
  const stamp = match?.groups?.stamp;
  if (workspaceId === undefined || stamp === undefined) return undefined;
  const exportedAt = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(
    6,
    8,
  )}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(
    12,
    14,
  )}.${stamp.slice(14, 17)}Z`;
  return isCanonicalTimestamp(exportedAt)
    ? Object.freeze({workspaceId, exportedAt})
    : undefined;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      // The caller already reports the bounded storage failure.
    }
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}

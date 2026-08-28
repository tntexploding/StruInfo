import {createHash, randomUUID} from 'node:crypto';
import {
  lstat,
  open,
  readFile,
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

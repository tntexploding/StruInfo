import {createHash, randomUUID} from 'node:crypto';
import {lstat, link, open, readFile, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  copyOwnedByteView,
  OwnedByteViewError,
} from '../../serialization/owned_byte_view.js';
import {
  BLOB_DIGEST_ALGORITHM,
  BlobStoreError,
  type BlobIdentity,
  type BlobStore,
} from '../../storage/blob_store.js';
import {
  ensurePrivateSubdirectory,
  findPrivateSubdirectory,
  LocalDataRootError,
} from './local_data_root.js';

export const DEFAULT_MAXIMUM_BLOB_BYTES = 64 * 1024 * 1024;

const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export interface LocalFilesystemBlobStoreOptions {
  readonly maximumBlobBytes?: number;
}

export class LocalFilesystemBlobStore implements BlobStore {
  readonly #algorithmRoot: string;
  readonly #maximumBlobBytes: number;

  private constructor(algorithmRoot: string, maximumBlobBytes: number) {
    this.#algorithmRoot = algorithmRoot;
    this.#maximumBlobBytes = maximumBlobBytes;
  }

  public static async open(
    blobAreaRoot: string,
    options: Readonly<LocalFilesystemBlobStoreOptions> = {},
  ): Promise<LocalFilesystemBlobStore> {
    const maximumBlobBytes = parseMaximumBlobBytes(
      options.maximumBlobBytes ?? DEFAULT_MAXIMUM_BLOB_BYTES,
    );
    const algorithmRoot = await ensurePrivateSubdirectory(
      blobAreaRoot,
      BLOB_DIGEST_ALGORITHM,
    );
    return new LocalFilesystemBlobStore(algorithmRoot, maximumBlobBytes);
  }

  public async put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>> {
    const ownedBytes = copyBlobBytes(bytes, this.#maximumBlobBytes);
    const identity = createBlobIdentity(ownedBytes);
    try {
      const targetDirectory = await this.ensureDigestDirectory(identity.digest);
      const targetPath = join(targetDirectory, identity.digest);
      const existing = await readVerifiedBlobIfPresent(
        targetPath,
        identity,
        this.#maximumBlobBytes,
      );
      if (existing !== undefined) {
        return identity;
      }

      await persistBlobAtomically(
        targetDirectory,
        targetPath,
        identity,
        ownedBytes,
      );
      return identity;
    } catch (error) {
      throw normalizeBlobStoreError(error);
    }
  }

  public async read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    validateBlobIdentity(identity, this.#maximumBlobBytes);
    try {
      const targetDirectory = await this.findDigestDirectory(identity.digest);
      if (targetDirectory === undefined) {
        throw blobNotFound();
      }
      const targetPath = join(targetDirectory, identity.digest);
      const bytes = await readVerifiedBlobIfPresent(
        targetPath,
        identity,
        this.#maximumBlobBytes,
      );
      if (bytes === undefined) {
        throw blobNotFound();
      }
      return bytes;
    } catch (error) {
      throw normalizeBlobStoreError(error);
    }
  }

  private async ensureDigestDirectory(digest: string): Promise<string> {
    const firstShard = await ensurePrivateSubdirectory(
      this.#algorithmRoot,
      digest.slice(0, 2),
    );
    return ensurePrivateSubdirectory(firstShard, digest.slice(2, 4));
  }

  private async findDigestDirectory(
    digest: string,
  ): Promise<string | undefined> {
    const firstShard = await findPrivateSubdirectory(
      this.#algorithmRoot,
      digest.slice(0, 2),
    );
    if (firstShard === undefined) {
      return undefined;
    }
    return findPrivateSubdirectory(firstShard, digest.slice(2, 4));
  }
}

function copyBlobBytes(
  input: Uint8Array,
  maximumBlobBytes: number,
): Uint8Array {
  try {
    return copyOwnedByteView(input, maximumBlobBytes);
  } catch (error) {
    if (
      error instanceof OwnedByteViewError &&
      error.code === 'input_too_large'
    ) {
      throw new BlobStoreError(
        'input_too_large',
        'Blob input exceeds the configured byte limit.',
      );
    }
    throw new BlobStoreError(
      'input_invalid',
      'Blob input must be an ordinary, non-shared Uint8Array byte view.',
    );
  }
}

function createBlobIdentity(bytes: Uint8Array): Readonly<BlobIdentity> {
  return Object.freeze({
    algorithm: BLOB_DIGEST_ALGORITHM,
    digest: digestBytes(bytes),
    byteLength: bytes.byteLength,
  });
}

function validateBlobIdentity(
  identity: Readonly<BlobIdentity>,
  maximumBlobBytes: number,
): void {
  const candidate = identity as unknown as Readonly<Record<string, unknown>>;
  if (
    candidate.algorithm !== BLOB_DIGEST_ALGORITHM ||
    typeof candidate.digest !== 'string' ||
    !SHA256_DIGEST_PATTERN.test(candidate.digest) ||
    typeof candidate.byteLength !== 'number' ||
    !Number.isSafeInteger(candidate.byteLength) ||
    candidate.byteLength < 0 ||
    candidate.byteLength > maximumBlobBytes
  ) {
    throw new BlobStoreError(
      'identity_invalid',
      'Blob identity is invalid for this store.',
    );
  }
}

async function readVerifiedBlobIfPresent(
  targetPath: string,
  identity: Readonly<BlobIdentity>,
  maximumBlobBytes: number,
): Promise<Uint8Array | undefined> {
  let status: Awaited<ReturnType<typeof lstat>>;
  try {
    status = await lstat(targetPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw storageUnavailable();
  }
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size !== identity.byteLength ||
    status.size > maximumBlobBytes
  ) {
    throw integrityFailure();
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(await readFile(targetPath));
  } catch {
    throw storageUnavailable();
  }
  if (
    bytes.byteLength !== identity.byteLength ||
    digestBytes(bytes) !== identity.digest
  ) {
    throw integrityFailure();
  }
  return bytes;
}

async function persistBlobAtomically(
  targetDirectory: string,
  targetPath: string,
  identity: Readonly<BlobIdentity>,
  bytes: Uint8Array,
): Promise<void> {
  const temporaryPath = join(
    targetDirectory,
    `.${identity.digest}.${randomUUID()}.tmp`,
  );
  let operationFailure: Error | undefined;
  try {
    await writeFile(temporaryPath, bytes, {flag: 'wx', mode: 0o600});
    const handle = await open(temporaryPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporaryPath, targetPath);
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw storageUnavailable();
      }
      const existing = await readVerifiedBlobIfPresent(
        targetPath,
        identity,
        bytes.byteLength,
      );
      if (existing === undefined) {
        throw storageUnavailable();
      }
    }
  } catch (error) {
    operationFailure = normalizeBlobStoreError(error);
  }

  const cleanupFailure = await removeTemporaryFile(temporaryPath);
  if (operationFailure !== undefined && cleanupFailure !== undefined) {
    throw new BlobStoreError(
      'storage_unavailable',
      'Blob persistence failed and temporary cleanup could not complete.',
    );
  }
  if (operationFailure !== undefined) {
    throw operationFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

async function removeTemporaryFile(path: string): Promise<Error | undefined> {
  try {
    await unlink(path);
    return undefined;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    return new BlobStoreError(
      'storage_unavailable',
      'Temporary Blob cleanup could not complete.',
    );
  }
}

function parseMaximumBlobBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BlobStoreError(
      'input_invalid',
      'The Blob byte limit must be a non-negative safe integer.',
    );
  }
  return value;
}

function digestBytes(bytes: Uint8Array): string {
  return createHash(BLOB_DIGEST_ALGORITHM).update(bytes).digest('hex');
}

function normalizeBlobStoreError(error: unknown): BlobStoreError {
  if (error instanceof BlobStoreError) {
    return error;
  }
  if (error instanceof LocalDataRootError && error.code === 'area_unsafe') {
    return integrityFailure();
  }
  return storageUnavailable();
}

function blobNotFound(): BlobStoreError {
  return new BlobStoreError(
    'blob_not_found',
    'The requested Blob was not found.',
  );
}

function storageUnavailable(): BlobStoreError {
  return new BlobStoreError(
    'storage_unavailable',
    'The local Blob store is unavailable.',
  );
}

function integrityFailure(): BlobStoreError {
  return new BlobStoreError(
    'integrity_failed',
    'Stored Blob bytes do not match their immutable identity.',
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

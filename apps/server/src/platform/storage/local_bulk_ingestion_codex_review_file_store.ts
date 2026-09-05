import {createHash} from 'node:crypto';
import {lstat, open, readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';

import {
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
  BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
  type BulkIngestionCodexReviewFileStorePort,
  type BulkIngestionCodexReviewStoredPackage,
} from '../../modules/processing/index.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type LocalBulkIngestionCodexReviewFileStoreErrorCode =
  | 'input_invalid'
  | 'file_not_found'
  | 'file_too_large'
  | 'packet_conflict'
  | 'storage_unavailable';

export class LocalBulkIngestionCodexReviewFileStoreError extends Error {
  public readonly code: LocalBulkIngestionCodexReviewFileStoreErrorCode;

  public constructor(code: LocalBulkIngestionCodexReviewFileStoreErrorCode) {
    super('The external Codex review work area is unavailable.');
    this.name = 'LocalBulkIngestionCodexReviewFileStoreError';
    this.code = code;
  }
}

export class LocalBulkIngestionCodexReviewFileStore implements BulkIngestionCodexReviewFileStorePort {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = root;
  }

  public async writePackage(
    input: Readonly<{
      packetId: string;
      packetBytes: Uint8Array;
      resultTemplateBytes: Uint8Array;
    }>,
  ): Promise<Readonly<BulkIngestionCodexReviewStoredPackage>> {
    validateWrite(input);
    const packetFileName = `${input.packetId}.codex-review.json`;
    const resultFileName = `${input.packetId}.codex-result.json`;
    const packetBytes = Uint8Array.from(input.packetBytes);
    const packetPath = join(this.#root, packetFileName);
    const packetOutcome = await writeOrCompare(packetPath, packetBytes);
    if (packetOutcome === 'conflict') {
      throw new LocalBulkIngestionCodexReviewFileStoreError('packet_conflict');
    }
    const resultPath = join(this.#root, resultFileName);
    if (!(await ordinaryFileExists(resultPath))) {
      try {
        await writeNew(resultPath, Uint8Array.from(input.resultTemplateBytes));
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) throw error;
      }
    }
    return Object.freeze({
      outcome: packetOutcome,
      packetFileName,
      resultFileName,
      packetByteLength: packetBytes.byteLength,
      packetFileSha256: createHash('sha256').update(packetBytes).digest('hex'),
    });
  }

  public readPacket(packetId: string): Promise<Uint8Array> {
    return this.#read(
      packetId,
      'codex-review',
      BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
    );
  }

  public readResult(packetId: string): Promise<Uint8Array> {
    return this.#read(
      packetId,
      'codex-result',
      BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
    );
  }

  async #read(
    packetId: string,
    kind: 'codex-review' | 'codex-result',
    maximumBytes: number,
  ): Promise<Uint8Array> {
    if (!CANONICAL_UUID.test(packetId)) {
      throw new LocalBulkIngestionCodexReviewFileStoreError('input_invalid');
    }
    const path = join(this.#root, `${packetId}.${kind}.json`);
    let status;
    try {
      status = await lstat(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new LocalBulkIngestionCodexReviewFileStoreError('file_not_found');
      }
      throw new LocalBulkIngestionCodexReviewFileStoreError(
        'storage_unavailable',
      );
    }
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new LocalBulkIngestionCodexReviewFileStoreError(
        'storage_unavailable',
      );
    }
    if (status.size > maximumBytes) {
      throw new LocalBulkIngestionCodexReviewFileStoreError('file_too_large');
    }
    try {
      const bytes = Uint8Array.from(await readFile(path));
      if (bytes.byteLength !== status.size) {
        throw new LocalBulkIngestionCodexReviewFileStoreError(
          'storage_unavailable',
        );
      }
      return bytes;
    } catch (error) {
      if (error instanceof LocalBulkIngestionCodexReviewFileStoreError) {
        throw error;
      }
      throw new LocalBulkIngestionCodexReviewFileStoreError(
        'storage_unavailable',
      );
    }
  }
}

function validateWrite(
  input: Readonly<{
    packetId: string;
    packetBytes: Uint8Array;
    resultTemplateBytes: Uint8Array;
  }>,
): void {
  if (
    !CANONICAL_UUID.test(input.packetId) ||
    !(input.packetBytes instanceof Uint8Array) ||
    input.packetBytes.byteLength < 1 ||
    input.packetBytes.byteLength > BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES ||
    !(input.resultTemplateBytes instanceof Uint8Array) ||
    input.resultTemplateBytes.byteLength < 1 ||
    input.resultTemplateBytes.byteLength >
      BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES
  ) {
    throw new LocalBulkIngestionCodexReviewFileStoreError('input_invalid');
  }
}

async function writeOrCompare(
  path: string,
  bytes: Uint8Array,
): Promise<'created' | 'existing' | 'conflict'> {
  try {
    await writeNew(path, bytes);
    return 'created';
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
  }
  const status = await lstat(path);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size !== bytes.byteLength
  ) {
    return 'conflict';
  }
  const existing = await readFile(path);
  return Buffer.from(existing).equals(Buffer.from(bytes))
    ? 'existing'
    : 'conflict';
}

async function writeNew(path: string, bytes: Uint8Array): Promise<void> {
  let opened = false;
  try {
    const handle = await open(path, 'wx', 0o600);
    opened = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (opened) await removeIfPresent(path);
    throw error;
  }
}

async function ordinaryFileExists(path: string): Promise<boolean> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new LocalBulkIngestionCodexReviewFileStoreError(
        'storage_unavailable',
      );
    }
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // The caller reports the bounded storage failure.
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}

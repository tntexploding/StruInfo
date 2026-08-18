import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import type {BlobIdentity, BlobStore} from '../storage/blob_store.js';
import {
  M1C_DOMAIN_BUNDLE_SCHEMA,
  M1C_DOMAIN_TABLES,
  m1cDomainBlobReferences,
  normalizeM1cDomainSnapshot,
  type M1cDomainSnapshot,
} from './m1c_domain_bundle.js';
import {
  M1cDomainTransferRepositoryError,
  M1cWorkspaceTransfer,
} from './m1c_workspace_transfer.js';
import type {
  StoredWorkspaceBundleFile,
  WorkspaceBundleFileStore,
} from './workspace_bundle_file_store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2040-01-02T03:04:05.000Z';
const BLOB_BYTES = new TextEncoder().encode('synthetic external Blob bytes');
const BLOB_IDENTITY = Object.freeze({
  algorithm: 'sha256' as const,
  digest: createHash('sha256').update(BLOB_BYTES).digest('hex'),
  byteLength: BLOB_BYTES.byteLength,
});

describe('M1C workspace transfer', () => {
  it('exports a closed domain snapshot and restores it through Blob references', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
    const restoreEmptyWorkspace = vi.fn(() => Promise.resolve());
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore,
      fileStore,
      now: () => CREATED_AT,
    });

    const exported = await transfer.exportWorkspace(WORKSPACE_ID);
    const storedBytes = await fileStore.read(exported.fileName);
    const restored = await transfer.restoreWorkspace(
      WORKSPACE_ID,
      exported.fileName,
    );

    expect(exported).toMatchObject({
      blobCount: 1,
      tableCounts: {workspace: 1, evidence_blob: 1},
    });
    expect(new TextDecoder().decode(storedBytes)).not.toContain(
      'synthetic external Blob bytes',
    );
    expect(restored).toMatchObject({
      fileName: exported.fileName,
      blobCount: 1,
      tableCounts: {workspace: 1, evidence_blob: 1},
    });
    expect(restoreEmptyWorkspace).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      snapshot,
    );
  });

  it('rejects cross-workspace restore before repository writes', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const restoreEmptyWorkspace = vi.fn(() => Promise.resolve());
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      now: () => CREATED_AT,
    });
    const exported = await transfer.exportWorkspace(WORKSPACE_ID);

    await expect(
      transfer.restoreWorkspace(OTHER_WORKSPACE_ID, exported.fileName),
    ).rejects.toMatchObject({code: 'workspace_mismatch'});
    expect(restoreEmptyWorkspace).not.toHaveBeenCalled();
  });

  it('keeps missing Blobs and non-empty targets as visible failures', async () => {
    const snapshot = syntheticSnapshot();
    const missingBlobTransfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore: {
        put: () => Promise.reject(new Error('unexpected')),
        read: () => Promise.reject(new Error('missing')),
      },
      fileStore: new MemoryBundleFileStore(),
      now: () => CREATED_AT,
    });
    await expect(
      missingBlobTransfer.exportWorkspace(WORKSPACE_ID),
    ).rejects.toEqual(expect.objectContaining({code: 'blob_unavailable'}));

    const fileStore = new MemoryBundleFileStore();
    const nonEmptyTransfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () =>
          Promise.reject(
            new M1cDomainTransferRepositoryError('workspace_not_empty'),
          ),
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      now: () => CREATED_AT,
    });
    const exported = await nonEmptyTransfer.exportWorkspace(WORKSPACE_ID);
    await expect(
      nonEmptyTransfer.restoreWorkspace(WORKSPACE_ID, exported.fileName),
    ).rejects.toEqual(expect.objectContaining({code: 'workspace_not_empty'}));
  });

  it('rejects table drift and derives the exact Blob manifest', () => {
    const snapshot = syntheticSnapshot();
    expect(m1cDomainBlobReferences(snapshot)).toEqual([BLOB_IDENTITY]);
    const raw = JSON.parse(JSON.stringify(snapshot)) as {
      tables: {name: string; rows: Record<string, unknown>[]}[];
    };
    const firstTable = raw.tables[0];
    const firstRow = firstTable?.rows[0];
    if (firstRow === undefined) {
      throw new Error('The synthetic M1C snapshot must include one row.');
    }
    firstRow.unexpected = true;
    expect(() => normalizeM1cDomainSnapshot(raw)).toThrow();
  });
});

function syntheticSnapshot(): M1cDomainSnapshot {
  return normalizeM1cDomainSnapshot({
    schemaVersion: M1C_DOMAIN_BUNDLE_SCHEMA,
    tables: M1C_DOMAIN_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'workspace'
          ? [{workspace_id: WORKSPACE_ID, created_at: CREATED_AT}]
          : descriptor.name === 'evidence_blob'
            ? [
                {
                  workspace_id: WORKSPACE_ID,
                  blob_id: '33333333-3333-4333-8333-333333333333',
                  digest_algorithm: 'sha256',
                  digest: BLOB_IDENTITY.digest,
                  byte_length: BLOB_IDENTITY.byteLength,
                  media_type: 'text/markdown',
                  read_revoked_at: null,
                  delete_after: null,
                  created_at: CREATED_AT,
                },
              ]
            : [],
    })),
  });
}

class MemoryBlobStore implements BlobStore {
  readonly #identity: Readonly<BlobIdentity>;
  readonly #bytes: Uint8Array;

  public constructor(identity: Readonly<BlobIdentity>, bytes: Uint8Array) {
    this.#identity = identity;
    this.#bytes = Uint8Array.from(bytes);
  }

  public put(): Promise<Readonly<BlobIdentity>> {
    return Promise.reject(new Error('unexpected Blob write'));
  }

  public read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    return identity.digest === this.#identity.digest
      ? Promise.resolve(Uint8Array.from(this.#bytes))
      : Promise.reject(new Error('missing Blob'));
  }
}

class MemoryBundleFileStore implements WorkspaceBundleFileStore {
  readonly #files = new Map<string, Uint8Array>();

  public write(
    workspaceId: string,
    _exportedAt: string,
    bytes: Uint8Array,
  ): Promise<Readonly<StoredWorkspaceBundleFile>> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = `${workspaceId}-${sha256.slice(0, 12)}.workspace-bundle.json`;
    this.#files.set(fileName, Uint8Array.from(bytes));
    return Promise.resolve(
      Object.freeze({fileName, byteLength: bytes.byteLength, sha256}),
    );
  }

  public read(fileName: string): Promise<Uint8Array> {
    const bytes = this.#files.get(fileName);
    return bytes === undefined
      ? Promise.reject(new Error('missing Bundle'))
      : Promise.resolve(Uint8Array.from(bytes));
  }
}

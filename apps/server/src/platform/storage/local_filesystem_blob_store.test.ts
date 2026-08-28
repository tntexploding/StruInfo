import {createHash} from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  BLOB_DIGEST_ALGORITHM,
  type BlobIdentity,
} from '../../storage/blob_store.js';
import {initializeLocalDataRoot} from './local_data_root.js';
import {LocalFilesystemBlobStore} from './local_filesystem_blob_store.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('LocalFilesystemBlobStore', () => {
  it('stores and reads immutable content by a SHA-256 identity', async () => {
    const fixture = await createBlobStore();
    const source = new TextEncoder().encode('合成 Blob evidence 🧪');
    const expectedDigest = digest(source);

    const identity = await fixture.store.put(source);
    const firstRead = await fixture.store.read(identity);
    firstRead.fill(0);
    const secondRead = await fixture.store.read(identity);

    expect(identity).toEqual({
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: expectedDigest,
      byteLength: source.byteLength,
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(secondRead).toEqual(source);
    expect(
      readdirSync(
        join(
          fixture.blobAreaRoot,
          BLOB_DIGEST_ALGORITHM,
          expectedDigest.slice(0, 2),
          expectedDigest.slice(2, 4),
        ),
      ),
    ).toEqual([expectedDigest]);
  });

  it('copies only the exact visible byte range before the caller can mutate it', async () => {
    const fixture = await createBlobStore();
    const backingBytes = Uint8Array.from([90, 1, 2, 3, 91]);
    const visibleBytes = backingBytes.subarray(1, 4);
    const expectedBytes = Uint8Array.from([1, 2, 3]);

    const pendingIdentity = fixture.store.put(visibleBytes);
    visibleBytes.fill(8);
    const identity = await pendingIdentity;

    expect(identity.digest).toBe(digest(expectedBytes));
    await expect(fixture.store.read(identity)).resolves.toEqual(expectedBytes);
  });

  it('rejects Proxy and shared-memory byte views', async () => {
    const fixture = await createBlobStore();
    const proxiedBytes = new Proxy(Uint8Array.from([1, 2, 3]), {});
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(3));

    await expect(fixture.store.put(proxiedBytes)).rejects.toMatchObject({
      code: 'input_invalid',
    });
    await expect(fixture.store.put(sharedBytes)).rejects.toMatchObject({
      code: 'input_invalid',
    });
  });

  it('enforces the complete owned-byte limit at the inclusive boundary', async () => {
    const fixture = await createBlobStore(3);

    await expect(
      fixture.store.put(Uint8Array.from([1, 2, 3])),
    ).resolves.toMatchObject({byteLength: 3});
    await expect(
      fixture.store.put(Uint8Array.from([1, 2, 3, 4])),
    ).rejects.toMatchObject({code: 'input_too_large'});
  });

  it('deduplicates sequential and concurrent equal writes without temporary files', async () => {
    const fixture = await createBlobStore();
    const bytes = new TextEncoder().encode('same synthetic content');

    const identities = await Promise.all([
      fixture.store.put(bytes),
      fixture.store.put(bytes),
      fixture.store.put(bytes),
    ]);
    const replayed = await fixture.store.put(bytes);
    const identity = identities[0];
    const targetDirectory = join(
      fixture.blobAreaRoot,
      BLOB_DIGEST_ALGORITHM,
      identity.digest.slice(0, 2),
      identity.digest.slice(2, 4),
    );

    expect(identities).toEqual([identity, identity, identity]);
    expect(replayed).toEqual(identity);
    expect(readdirSync(targetDirectory)).toEqual([identity.digest]);
  });

  it('detects changed bytes on both reads and idempotent writes', async () => {
    const fixture = await createBlobStore();
    const source = Uint8Array.from([1, 2, 3, 4]);
    const identity = await fixture.store.put(source);
    const targetPath = blobPath(fixture.blobAreaRoot, identity);
    writeFileSync(targetPath, Uint8Array.from([4, 3, 2, 1]));

    await expect(fixture.store.read(identity)).rejects.toMatchObject({
      code: 'integrity_failed',
    });
    await expect(fixture.store.put(source)).rejects.toMatchObject({
      code: 'integrity_failed',
    });
  });

  it('does not follow a linked hash-shard directory during reads', async () => {
    const fixture = await createBlobStore();
    const bytes = Uint8Array.from([7, 8, 9]);
    const identity: BlobIdentity = {
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: digest(bytes),
      byteLength: bytes.byteLength,
    };
    const linkedTarget = join(dirname(fixture.blobAreaRoot), 'linked-shard');
    mkdirSync(linkedTarget);
    symlinkSync(
      linkedTarget,
      join(
        fixture.blobAreaRoot,
        BLOB_DIGEST_ALGORITHM,
        identity.digest.slice(0, 2),
      ),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(fixture.store.read(identity)).rejects.toMatchObject({
      code: 'integrity_failed',
    });
  });

  it('rejects malformed identities before deriving a path', async () => {
    const fixture = await createBlobStore();
    const malformedIdentity: BlobIdentity = {
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: '../not-a-digest',
      byteLength: 1,
    };

    await expect(fixture.store.read(malformedIdentity)).rejects.toMatchObject({
      code: 'identity_invalid',
    });
  });

  it('reports a valid but absent identity as not found', async () => {
    const fixture = await createBlobStore();
    const missingIdentity: BlobIdentity = {
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: '0'.repeat(64),
      byteLength: 0,
    };

    await expect(fixture.store.read(missingIdentity)).rejects.toMatchObject({
      code: 'blob_not_found',
    });
  });

  it('rejects an invalid store budget', async () => {
    const root = createTemporaryRoot();
    const layout = await initializeLocalDataRoot(root);

    await expect(
      LocalFilesystemBlobStore.open(layout.areaRoots.blobs, {
        maximumBlobBytes: -1,
      }),
    ).rejects.toMatchObject({code: 'input_invalid'});
  });
});

interface BlobStoreFixture {
  readonly blobAreaRoot: string;
  readonly store: LocalFilesystemBlobStore;
}

async function createBlobStore(
  maximumBlobBytes?: number,
): Promise<BlobStoreFixture> {
  const root = createTemporaryRoot();
  const layout = await initializeLocalDataRoot(root);
  const store = await LocalFilesystemBlobStore.open(
    layout.areaRoots.blobs,
    maximumBlobBytes === undefined ? {} : {maximumBlobBytes},
  );
  return {blobAreaRoot: layout.areaRoots.blobs, store};
}

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-blob-store-'));
  temporaryRoots.push(root);
  return root;
}

function blobPath(blobAreaRoot: string, identity: BlobIdentity): string {
  return join(
    blobAreaRoot,
    BLOB_DIGEST_ALGORITHM,
    identity.digest.slice(0, 2),
    identity.digest.slice(2, 4),
    identity.digest,
  );
}

function digest(bytes: Uint8Array): string {
  return createHash(BLOB_DIGEST_ALGORITHM).update(bytes).digest('hex');
}

import {createHash} from 'node:crypto';

import {describe, expect, it} from 'vitest';

import type {
  EvidenceCaptureRepositoryRequest,
  EvidenceCaptureRepositoryResult,
  EvidenceRepositoryPort,
} from '../evidence_repository.js';
import {
  BLOB_DIGEST_ALGORITHM,
  BlobStoreError,
  type BlobIdentity,
  type BlobStore,
} from '../../../storage/blob_store.js';
import {importMarkdownEvidence} from './markdown_import.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';

class MemoryBlobStore implements BlobStore {
  public readonly writes: BlobIdentity[] = [];
  readonly #values = new Map<string, Uint8Array>();

  public put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>> {
    const identity = Object.freeze({
      algorithm: BLOB_DIGEST_ALGORITHM,
      digest: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    });
    this.#values.set(identity.digest, Uint8Array.from(bytes));
    this.writes.push(identity);
    return Promise.resolve(identity);
  }

  public read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    const bytes = this.#values.get(identity.digest);
    if (bytes === undefined) {
      return Promise.reject(
        new BlobStoreError('blob_not_found', 'Synthetic Blob is absent.'),
      );
    }
    return Promise.resolve(Uint8Array.from(bytes));
  }
}

class MemoryEvidenceRepository implements EvidenceRepositoryPort {
  public readonly requests: EvidenceCaptureRepositoryRequest[] = [];
  readonly #commands = new Map<string, string>();

  public saveCapture(
    request: Readonly<EvidenceCaptureRepositoryRequest>,
  ): Promise<EvidenceCaptureRepositoryResult> {
    this.requests.push(request);
    const key = `${request.capture.workspaceId}\u0000${request.capture.commandIdempotencyKey}`;
    const previous = this.#commands.get(key);
    if (previous === undefined) {
      this.#commands.set(key, request.requestSha256);
      return Promise.resolve(Object.freeze({status: 'created' as const}));
    }
    return Promise.resolve(
      Object.freeze({
        status:
          previous === request.requestSha256
            ? ('existing' as const)
            : ('conflict' as const),
      }),
    );
  }
}

describe('Markdown evidence import', () => {
  it('persists raw and normalized bytes before one evidence command', async () => {
    const blobs = new MemoryBlobStore();
    const repository = new MemoryEvidenceRepository();
    const input = importInput(
      '# Synthetic weekly\r\n\r\n## 工具\r\n\r\n' +
        '1、Synthetic entry\r\n\r\n' +
        'Body.\r\n\r\n![Diagram](https://example.invalid/image.png)\r\n',
    );

    const result = await importMarkdownEvidence(
      {blobStore: blobs, evidenceRepository: repository},
      input,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('Unexpected result.');
    expect(result.fragmentIds.length).toBeGreaterThan(0);
    expect(result.mediaAssetIds).toHaveLength(1);
    expect(blobs.writes).toHaveLength(2);
    expect(repository.requests).toHaveLength(1);
    expect(repository.requests[0]?.capture.blobs).toHaveLength(2);
  });

  it('returns existing on equal replay and conflict on changed same-key input', async () => {
    const blobs = new MemoryBlobStore();
    const repository = new MemoryEvidenceRepository();
    const dependencies = {blobStore: blobs, evidenceRepository: repository};
    const first = importInput('# Synthetic\n\n## 工具\n\n1、Entry\n\nBody.\n');

    await expect(
      importMarkdownEvidence(dependencies, first),
    ).resolves.toMatchObject({status: 'created'});
    await expect(
      importMarkdownEvidence(dependencies, first),
    ).resolves.toMatchObject({status: 'existing'});
    await expect(
      importMarkdownEvidence(
        dependencies,
        importInput('# Synthetic\n\n## 工具\n\n1、Entry\n\nChanged body.\n'),
      ),
    ).resolves.toMatchObject({
      status: 'conflict',
      code: 'immutable_content_conflict',
    });
  });

  it('leaves a harmless raw Blob orphan when parsing rejects the document', async () => {
    const blobs = new MemoryBlobStore();
    const repository = new MemoryEvidenceRepository();

    await expect(
      importMarkdownEvidence(
        {blobStore: blobs, evidenceRepository: repository},
        importInput('   \n'),
      ),
    ).resolves.toMatchObject({
      status: 'validation_failed',
      code: 'empty_document',
    });
    expect(blobs.writes).toHaveLength(1);
    expect(repository.requests).toHaveLength(0);
  });

  it('reports Blob-store failure without attempting database persistence', async () => {
    const repository = new MemoryEvidenceRepository();
    const unavailable: BlobStore = {
      put: () =>
        Promise.reject(
          new BlobStoreError('storage_unavailable', 'Synthetic failure.'),
        ),
      read: () => Promise.reject(new Error('Not used.')),
    };

    await expect(
      importMarkdownEvidence(
        {blobStore: unavailable, evidenceRepository: repository},
        importInput('# Synthetic'),
      ),
    ).resolves.toEqual({status: 'persistence_failed', code: 'unavailable'});
    expect(repository.requests).toHaveLength(0);
  });
});

function importInput(source: string) {
  return {
    workspaceId: WORKSPACE_ID,
    commandIdempotencyKey: 'synthetic-markdown-import',
    resource: {
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      resourceKind: 'git_file' as const,
      sourceKey: 'git:synthetic/weekly/issue.md',
      canonicalUri: 'https://example.invalid/synthetic/issue.md',
    },
    gitResource: {
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      canonicalRepositoryUri: 'https://example.invalid/synthetic/repository',
      repositoryRelativePath: 'docs/issue.md',
    },
    snapshot: {
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      capturedAt: '2040-01-02T03:04:05Z',
      mediaType: 'text/markdown',
    },
    gitObservations: [
      {
        workspaceId: WORKSPACE_ID,
        observationId: '00000000-0000-4000-8000-000000000004',
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        repositoryRef: 'refs/heads/main',
        commit: {algorithm: 'sha1' as const, digest: 'a'.repeat(40)},
        observedAt: '2040-01-02T03:04:05Z',
      },
    ],
    profile: 'ruanyf-weekly-v1' as const,
    sourceUtf8: new TextEncoder().encode(source),
    documentBaseUri: 'https://example.invalid/synthetic/issue.md',
  };
}

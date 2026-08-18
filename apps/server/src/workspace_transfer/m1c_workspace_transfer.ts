import type {BlobStore} from '../storage/blob_store.js';
import {
  assertM1cDomainWorkspace,
  M1C_DOMAIN_BUNDLE_CODEC,
  M1C_DOMAIN_BUNDLE_SCHEMA,
  M1C_DOMAIN_BUNDLE_SECTION_TYPE,
  M1C_DOMAIN_BUNDLE_SECTION_VERSION,
  M1C_DOMAIN_TABLES,
  m1cDomainBlobReferences,
  m1cDomainTableCounts,
  normalizeM1cDomainSnapshot,
  type M1cDomainSnapshot,
} from './m1c_domain_bundle.js';
import {
  readWorkspaceBundle,
  WorkspaceBundleError,
  writeWorkspaceBundle,
} from './workspace_bundle.js';
import {
  WorkspaceBundleFileStoreError,
  type WorkspaceBundleFileStore,
} from './workspace_bundle_file_store.js';

export interface M1cDomainTransferRepositoryPort {
  exportWorkspace(workspaceId: string): Promise<Readonly<M1cDomainSnapshot>>;
  restoreEmptyWorkspace(
    workspaceId: string,
    snapshot: Readonly<M1cDomainSnapshot>,
  ): Promise<void>;
}

export type M1cDomainTransferRepositoryErrorCode =
  'workspace_not_found' | 'workspace_not_empty' | 'repository_failed';

export class M1cDomainTransferRepositoryError extends Error {
  public readonly code: M1cDomainTransferRepositoryErrorCode;

  public constructor(code: M1cDomainTransferRepositoryErrorCode) {
    super('The workspace transfer repository operation failed.');
    this.name = 'M1cDomainTransferRepositoryError';
    this.code = code;
  }
}

export type M1cWorkspaceTransferErrorCode =
  | 'bundle_invalid'
  | 'bundle_not_found'
  | 'blob_unavailable'
  | 'repository_failed'
  | 'storage_failed'
  | 'workspace_mismatch'
  | 'workspace_not_empty'
  | 'workspace_not_found';

export class M1cWorkspaceTransferError extends Error {
  public readonly code: M1cWorkspaceTransferErrorCode;

  public constructor(code: M1cWorkspaceTransferErrorCode) {
    super('The M1C workspace transfer operation failed.');
    this.name = 'M1cWorkspaceTransferError';
    this.code = code;
  }
}

export interface M1cWorkspaceTransferSummary {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256?: string;
  readonly blobCount: number;
  readonly tableCounts: Readonly<Record<string, number>>;
}

export interface M1cWorkspaceTransferPort {
  exportWorkspace(
    workspaceId: string,
  ): Promise<Readonly<M1cWorkspaceTransferSummary>>;
  restoreWorkspace(
    workspaceId: string,
    fileName: string,
  ): Promise<Readonly<M1cWorkspaceTransferSummary>>;
}

export interface M1cWorkspaceTransferDependencies {
  readonly repository: M1cDomainTransferRepositoryPort;
  readonly blobStore: BlobStore;
  readonly fileStore: WorkspaceBundleFileStore;
  readonly now?: () => string;
}

export class M1cWorkspaceTransfer implements M1cWorkspaceTransferPort {
  readonly #dependencies: Readonly<M1cWorkspaceTransferDependencies>;

  public constructor(dependencies: Readonly<M1cWorkspaceTransferDependencies>) {
    this.#dependencies = dependencies;
  }

  public async exportWorkspace(
    workspaceId: string,
  ): Promise<Readonly<M1cWorkspaceTransferSummary>> {
    let snapshot: Readonly<M1cDomainSnapshot>;
    try {
      snapshot = normalizeM1cDomainSnapshot(
        await this.#dependencies.repository.exportWorkspace(workspaceId),
      );
      assertM1cDomainWorkspace(snapshot, workspaceId);
    } catch (error) {
      throw mapRepositoryError(error);
    }
    const references = m1cDomainBlobReferences(snapshot);
    await verifyBlobReferences(this.#dependencies.blobStore, references);
    const exportedAt = (this.#dependencies.now ?? defaultNow)();
    let bytes: Uint8Array;
    try {
      bytes = writeWorkspaceBundle(
        {
          workspaceId,
          exportedAt,
          sections: [
            {
              type: M1C_DOMAIN_BUNDLE_SECTION_TYPE,
              version: M1C_DOMAIN_BUNDLE_SECTION_VERSION,
              value: snapshot,
            },
          ],
          blobReferences: references,
        },
        [M1C_DOMAIN_BUNDLE_CODEC],
      );
    } catch {
      throw new M1cWorkspaceTransferError('bundle_invalid');
    }
    try {
      const stored = await this.#dependencies.fileStore.write(
        workspaceId,
        exportedAt,
        bytes,
      );
      return Object.freeze({
        fileName: stored.fileName,
        byteLength: stored.byteLength,
        sha256: stored.sha256,
        blobCount: references.length,
        tableCounts: m1cDomainTableCounts(snapshot),
      });
    } catch {
      throw new M1cWorkspaceTransferError('storage_failed');
    }
  }

  public async restoreWorkspace(
    workspaceId: string,
    fileName: string,
  ): Promise<Readonly<M1cWorkspaceTransferSummary>> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#dependencies.fileStore.read(fileName);
    } catch (error) {
      if (
        error instanceof WorkspaceBundleFileStoreError &&
        error.code === 'file_not_found'
      ) {
        throw new M1cWorkspaceTransferError('bundle_not_found');
      }
      throw new M1cWorkspaceTransferError('storage_failed');
    }

    let snapshot: Readonly<M1cDomainSnapshot>;
    let references;
    try {
      const bundle = readWorkspaceBundle(bytes, [M1C_DOMAIN_BUNDLE_CODEC]);
      if (bundle.workspaceId !== workspaceId) {
        throw new M1cWorkspaceTransferError('workspace_mismatch');
      }
      const section = bundle.sections[0];
      if (
        bundle.sections.length !== 1 ||
        section?.type !== M1C_DOMAIN_BUNDLE_SECTION_TYPE ||
        section.version !== M1C_DOMAIN_BUNDLE_SECTION_VERSION
      ) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
      snapshot = normalizeM1cDomainSnapshot(section.value);
      assertM1cDomainWorkspace(snapshot, workspaceId);
      references = m1cDomainBlobReferences(snapshot);
      if (!sameBlobReferences(references, bundle.blobReferences)) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
    } catch (error) {
      if (error instanceof M1cWorkspaceTransferError) throw error;
      if (error instanceof WorkspaceBundleError) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
      throw new M1cWorkspaceTransferError('bundle_invalid');
    }

    await verifyBlobReferences(this.#dependencies.blobStore, references);
    try {
      await this.#dependencies.repository.restoreEmptyWorkspace(
        workspaceId,
        snapshot,
      );
    } catch (error) {
      throw mapRepositoryError(error);
    }
    return Object.freeze({
      fileName,
      byteLength: bytes.byteLength,
      blobCount: references.length,
      tableCounts: m1cDomainTableCounts(snapshot),
    });
  }
}

function sameBlobReferences(
  expected: readonly Readonly<{
    algorithm: string;
    digest: string;
    byteLength: number;
  }>[],
  actual: readonly Readonly<{
    algorithm: string;
    digest: string;
    byteLength: number;
  }>[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((reference, index) => {
      const candidate = actual[index];
      return (
        candidate?.algorithm === reference.algorithm &&
        candidate.digest === reference.digest &&
        candidate.byteLength === reference.byteLength
      );
    })
  );
}

async function verifyBlobReferences(
  blobStore: BlobStore,
  references: readonly Readonly<{
    algorithm: 'sha256';
    digest: string;
    byteLength: number;
  }>[],
): Promise<void> {
  try {
    for (const reference of references) {
      await blobStore.read(reference);
    }
  } catch {
    throw new M1cWorkspaceTransferError('blob_unavailable');
  }
}

function mapRepositoryError(error: unknown): M1cWorkspaceTransferError {
  if (error instanceof M1cWorkspaceTransferError) return error;
  if (error instanceof M1cDomainTransferRepositoryError) {
    if (error.code === 'workspace_not_found') {
      return new M1cWorkspaceTransferError('workspace_not_found');
    }
    if (error.code === 'workspace_not_empty') {
      return new M1cWorkspaceTransferError('workspace_not_empty');
    }
  }
  return new M1cWorkspaceTransferError('repository_failed');
}

function defaultNow(): string {
  return new Date().toISOString();
}

export function createEmptyM1cDomainSnapshot(
  workspaceId: string,
  createdAt: string,
): M1cDomainSnapshot {
  return normalizeM1cDomainSnapshot({
    schemaVersion: M1C_DOMAIN_BUNDLE_SCHEMA,
    tables: M1C_DOMAIN_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'workspace'
          ? [{workspace_id: workspaceId, created_at: createdAt}]
          : [],
    })),
  });
}

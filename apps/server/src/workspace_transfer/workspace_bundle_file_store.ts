export interface StoredWorkspaceBundleFile {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface WorkspaceBundleFileStore {
  write(
    workspaceId: string,
    exportedAt: string,
    bytes: Uint8Array,
  ): Promise<Readonly<StoredWorkspaceBundleFile>>;

  read(fileName: string): Promise<Uint8Array>;
}

export type WorkspaceBundleFileStoreErrorCode =
  | 'file_name_invalid'
  | 'file_not_found'
  | 'file_too_large'
  | 'storage_unavailable';

export class WorkspaceBundleFileStoreError extends Error {
  public readonly code: WorkspaceBundleFileStoreErrorCode;

  public constructor(code: WorkspaceBundleFileStoreErrorCode) {
    super('The external workspace Bundle file operation failed.');
    this.name = 'WorkspaceBundleFileStoreError';
    this.code = code;
  }
}

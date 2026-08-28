export const BLOB_DIGEST_ALGORITHM = 'sha256';

export interface BlobIdentity {
  readonly algorithm: typeof BLOB_DIGEST_ALGORITHM;
  readonly digest: string;
  readonly byteLength: number;
}

export interface BlobStore {
  put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>>;
  read(identity: Readonly<BlobIdentity>): Promise<Uint8Array>;
}

export type BlobStoreErrorCode =
  | 'input_invalid'
  | 'input_too_large'
  | 'identity_invalid'
  | 'blob_not_found'
  | 'integrity_failed'
  | 'storage_unavailable';

export class BlobStoreError extends Error {
  public readonly code: BlobStoreErrorCode;

  public constructor(code: BlobStoreErrorCode, message: string) {
    super(message);
    this.name = 'BlobStoreError';
    this.code = code;
  }
}

import type {BlobStore} from './blob_store.js';

export interface StorageServices {
  readonly blobStore: BlobStore;
}

export type StorageServicesFactory = (
  dataRoot: string,
) => Promise<Readonly<StorageServices>>;

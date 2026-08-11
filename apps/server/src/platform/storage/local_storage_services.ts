import type {StorageServices} from '../../storage/storage_services.js';
import {initializeLocalDataRoot} from './local_data_root.js';
import {LocalFilesystemBlobStore} from './local_filesystem_blob_store.js';

export async function createLocalStorageServices(
  dataRoot: string,
): Promise<Readonly<StorageServices>> {
  const layout = await initializeLocalDataRoot(dataRoot);
  const blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
  return Object.freeze({blobStore});
}

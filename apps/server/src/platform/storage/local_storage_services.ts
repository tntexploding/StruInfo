import type {StorageServices} from '../../storage/storage_services.js';
import {initializeLocalDataRoot} from './local_data_root.js';
import {LocalFilesystemBlobStore} from './local_filesystem_blob_store.js';
import {LocalReviewPreferencesStore} from './local_review_preferences_store.js';
import {LocalWorkspaceBundleFileStore} from './local_workspace_bundle_file_store.js';

export async function createLocalStorageServices(
  dataRoot: string,
): Promise<Readonly<StorageServices>> {
  const layout = await initializeLocalDataRoot(dataRoot);
  const blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
  const reviewPreferences = new LocalReviewPreferencesStore(
    layout.areaRoots.preferences,
  );
  const workspaceBundleFiles = new LocalWorkspaceBundleFileStore(
    layout.areaRoots.exports,
  );
  return Object.freeze({blobStore, reviewPreferences, workspaceBundleFiles});
}

import type {BlobStore} from './blob_store.js';
import type {ReviewPreferencesStore} from './review_preferences_store.js';
import type {WorkspaceBundleFileStore} from '../workspace_transfer/workspace_bundle_file_store.js';

import type {EntryMarkdownFileStore} from '../modules/entries/information_entry_markdown_export.js';

export interface StorageServices {
  readonly entryMarkdownFiles: EntryMarkdownFileStore;
  readonly blobStore: BlobStore;
  readonly reviewPreferences: ReviewPreferencesStore;
  readonly workspaceBundleFiles: WorkspaceBundleFileStore;
}

export type StorageServicesFactory = (
  dataRoot: string,
) => Promise<Readonly<StorageServices>>;

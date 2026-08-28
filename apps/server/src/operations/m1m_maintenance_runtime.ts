import type {RuntimeConfig} from '../config/runtime_config.js';
import {createRuntimeDatabase} from '../database/database_readiness.js';
import {NodeTimerScheduler, SystemDeadline} from '../lifecycle/deadline.js';
import {createPostgresRepositories} from '../platform/database/postgresql/postgres_repository_factory.js';
import {LocalFilesystemBlobStore} from '../platform/storage/local_filesystem_blob_store.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {LocalWorkspaceBundleFileStore} from '../platform/storage/local_workspace_bundle_file_store.js';
import {initializeLocalDataRoot} from '../platform/storage/local_data_root.js';
import {M1cWorkspaceTransfer} from '../workspace_transfer/m1c_workspace_transfer.js';
import type {M1mMaintenanceRuntimePort} from './m1m_maintenance.js';

export async function createM1mMaintenanceRuntime(
  config: Readonly<RuntimeConfig>,
): Promise<M1mMaintenanceRuntimePort> {
  const layout = await initializeLocalDataRoot(config.dataRoot);
  const blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
  const reviewPreferences = new LocalReviewPreferencesStore(
    layout.areaRoots.preferences,
  );
  const backupFiles = new LocalWorkspaceBundleFileStore(
    layout.areaRoots.backups,
  );
  const database = createRuntimeDatabase(
    config,
    new SystemDeadline(new NodeTimerScheduler()),
  );
  const repositories = createPostgresRepositories(database.pool);
  const transfer = new M1cWorkspaceTransfer({
    repository: repositories.workspaceTransfer,
    blobStore,
    reviewPreferences,
    fileStore: backupFiles,
  });
  return Object.freeze({
    checkReadiness: () => database.readiness.check(),
    backup: () => transfer.exportWorkspace(config.workspaceId),
    restore: (fileName: string) =>
      transfer.restoreWorkspace(config.workspaceId, fileName),
    close: () => database.close(),
  });
}

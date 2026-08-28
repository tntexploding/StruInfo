import type {BlobStore} from '../storage/blob_store.js';
import type {
  ReviewPreferences,
  ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
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
  assertM1dAssociationWorkspace,
  createEmptyM1dAssociationSnapshot,
  M1D_ASSOCIATION_BUNDLE_CODEC,
  M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
  M1D_ASSOCIATION_BUNDLE_SECTION_VERSION,
  M1D_ASSOCIATION_LEGACY_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_TWO_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_THREE_BUNDLE_CODEC,
  m1dAssociationTableCounts,
  normalizeM1dAssociationSnapshot,
  type M1dAssociationSnapshot,
} from './m1d_association_bundle.js';
import {
  assertM1dEntryWorkspace,
  createEmptyM1dEntrySnapshot,
  M1D_ENTRY_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_FOUR_BUNDLE_CODEC,
  M1D_ENTRY_BUNDLE_SECTION_TYPE,
  M1D_ENTRY_BUNDLE_SECTION_VERSION,
  M1D_ENTRY_LEGACY_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_THREE_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_TWO_BUNDLE_CODEC,
  m1dEntryTableCounts,
  normalizeM1dEntrySnapshot,
  type M1dEntrySnapshot,
} from './m1d_entry_bundle.js';
import {
  PERSONAL_DATA_BUNDLE_CODEC,
  PERSONAL_DATA_BUNDLE_SCHEMA,
  PERSONAL_DATA_BUNDLE_SECTION_TYPE,
  PERSONAL_DATA_BUNDLE_SECTION_VERSION,
  normalizePersonalDataBundleSection,
  type PersonalDataBundleSection,
} from './personal_data_bundle.js';
import {
  assertM1eProcessingWorkspace,
  createEmptyM1eProcessingSnapshot,
  M1E_PROCESSING_BUNDLE_CODEC,
  M1E_PROCESSING_LEGACY_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FOUR_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FIVE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_SIX_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_THREE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_TWO_BUNDLE_CODEC,
  M1E_PROCESSING_BUNDLE_SECTION_TYPE,
  M1E_PROCESSING_BUNDLE_SECTION_VERSION,
  m1eProcessingTableCounts,
  normalizeM1eProcessingSnapshot,
  type M1eProcessingSnapshot,
} from './m1e_processing_bundle.js';
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
  exportWorkspace(
    workspaceId: string,
  ): Promise<Readonly<M1cWorkspaceTransferSnapshot>>;
  restoreEmptyWorkspace(
    workspaceId: string,
    snapshot: Readonly<M1cWorkspaceTransferSnapshot>,
  ): Promise<void>;
}

export interface M1cWorkspaceTransferSnapshot {
  readonly domain: Readonly<M1cDomainSnapshot>;
  readonly entries: Readonly<M1dEntrySnapshot>;
  readonly associations: Readonly<M1dAssociationSnapshot>;
  readonly processing: Readonly<M1eProcessingSnapshot>;
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
  | 'preferences_failed'
  | 'repository_failed'
  | 'storage_failed'
  | 'workspace_mismatch'
  | 'workspace_not_empty'
  | 'workspace_not_found';

export class M1cWorkspaceTransferError extends Error {
  public readonly code: M1cWorkspaceTransferErrorCode;

  public constructor(code: M1cWorkspaceTransferErrorCode) {
    super('The personal workspace transfer operation failed.');
    this.name = 'M1cWorkspaceTransferError';
    this.code = code;
  }
}

export interface M1cWorkspaceTransferSummary {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256?: string;
  readonly blobCount: number;
  readonly personalDataIncluded: boolean;
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
  readonly reviewPreferences: ReviewPreferencesStore;
  readonly fileStore: WorkspaceBundleFileStore;
  readonly now?: () => string;
}

const BUNDLE_CODECS = Object.freeze([
  M1C_DOMAIN_BUNDLE_CODEC,
  M1D_ENTRY_LEGACY_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_TWO_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_THREE_BUNDLE_CODEC,
  M1D_ENTRY_VERSION_FOUR_BUNDLE_CODEC,
  M1D_ENTRY_BUNDLE_CODEC,
  M1D_ASSOCIATION_LEGACY_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_TWO_BUNDLE_CODEC,
  M1D_ASSOCIATION_VERSION_THREE_BUNDLE_CODEC,
  M1D_ASSOCIATION_BUNDLE_CODEC,
  M1E_PROCESSING_LEGACY_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_TWO_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_THREE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FOUR_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_FIVE_BUNDLE_CODEC,
  M1E_PROCESSING_VERSION_SIX_BUNDLE_CODEC,
  M1E_PROCESSING_BUNDLE_CODEC,
  PERSONAL_DATA_BUNDLE_CODEC,
]);

export class M1cWorkspaceTransfer implements M1cWorkspaceTransferPort {
  readonly #dependencies: Readonly<M1cWorkspaceTransferDependencies>;

  public constructor(dependencies: Readonly<M1cWorkspaceTransferDependencies>) {
    this.#dependencies = dependencies;
  }

  public async exportWorkspace(
    workspaceId: string,
  ): Promise<Readonly<M1cWorkspaceTransferSummary>> {
    let snapshot: Readonly<M1cWorkspaceTransferSnapshot>;
    try {
      snapshot = normalizeTransferSnapshot(
        await this.#dependencies.repository.exportWorkspace(workspaceId),
        workspaceId,
      );
    } catch (error) {
      throw mapRepositoryError(error);
    }
    const references = m1cDomainBlobReferences(snapshot.domain);
    let blobs: PersonalDataBundleSection['blobs'];
    try {
      blobs = await Promise.all(
        references.map(async (identity) =>
          Object.freeze({
            identity,
            bytes: await this.#dependencies.blobStore.read(identity),
          }),
        ),
      );
    } catch {
      throw new M1cWorkspaceTransferError('blob_unavailable');
    }
    let reviewPreferences: PersonalDataBundleSection['reviewPreferences'];
    try {
      reviewPreferences =
        await this.#dependencies.reviewPreferences.load(workspaceId);
    } catch {
      throw new M1cWorkspaceTransferError('preferences_failed');
    }
    let personalData: Readonly<PersonalDataBundleSection>;
    try {
      personalData = normalizePersonalDataBundleSection({
        schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
        blobs,
        reviewPreferences,
      });
    } catch {
      throw new M1cWorkspaceTransferError('bundle_invalid');
    }

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
              value: snapshot.domain,
            },
            {
              type: M1D_ENTRY_BUNDLE_SECTION_TYPE,
              version: M1D_ENTRY_BUNDLE_SECTION_VERSION,
              value: snapshot.entries,
            },
            {
              type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
              version: M1D_ASSOCIATION_BUNDLE_SECTION_VERSION,
              value: snapshot.associations,
            },
            {
              type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
              version: M1E_PROCESSING_BUNDLE_SECTION_VERSION,
              value: snapshot.processing,
            },
            {
              type: PERSONAL_DATA_BUNDLE_SECTION_TYPE,
              version: PERSONAL_DATA_BUNDLE_SECTION_VERSION,
              value: personalData,
            },
          ],
          blobReferences: references,
        },
        BUNDLE_CODECS,
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
        personalDataIncluded: true,
        tableCounts: transferTableCounts(snapshot),
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

    let snapshot: Readonly<M1cWorkspaceTransferSnapshot>;
    let references;
    let personalData: Readonly<PersonalDataBundleSection> | undefined;
    try {
      const bundle = readWorkspaceBundle(bytes, BUNDLE_CODECS);
      if (bundle.workspaceId !== workspaceId) {
        throw new M1cWorkspaceTransferError('workspace_mismatch');
      }
      const domainSection = bundle.sections.find(
        (section) => section.type === M1C_DOMAIN_BUNDLE_SECTION_TYPE,
      );
      const entrySection = bundle.sections.find(
        (section) => section.type === M1D_ENTRY_BUNDLE_SECTION_TYPE,
      );
      const associationSection = bundle.sections.find(
        (section) => section.type === M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
      );
      const processingSection = bundle.sections.find(
        (section) => section.type === M1E_PROCESSING_BUNDLE_SECTION_TYPE,
      );
      const personalSection = bundle.sections.find(
        (section) => section.type === PERSONAL_DATA_BUNDLE_SECTION_TYPE,
      );
      if (
        domainSection === undefined ||
        bundle.sections.length > 5 ||
        ((associationSection !== undefined ||
          processingSection !== undefined) &&
          entrySection === undefined)
      ) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
      snapshot = normalizeTransferSnapshot(
        {
          domain: normalizeM1cDomainSnapshot(domainSection.value),
          entries:
            entrySection === undefined
              ? createEmptyM1dEntrySnapshot()
              : normalizeM1dEntrySnapshot(entrySection.value),
          associations:
            associationSection === undefined
              ? createEmptyM1dAssociationSnapshot()
              : normalizeM1dAssociationSnapshot(associationSection.value),
          processing:
            processingSection === undefined
              ? createEmptyM1eProcessingSnapshot()
              : normalizeM1eProcessingSnapshot(processingSection.value),
        },
        workspaceId,
      );
      references = m1cDomainBlobReferences(snapshot.domain);
      if (!sameBlobReferences(references, bundle.blobReferences)) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
      if (personalSection !== undefined) {
        personalData = normalizePersonalDataBundleSection(
          personalSection.value,
        );
        if (
          personalData.reviewPreferences.workspaceId !== workspaceId ||
          !sameBlobReferences(
            references,
            personalData.blobs.map((blob) => blob.identity),
          )
        ) {
          throw new M1cWorkspaceTransferError('bundle_invalid');
        }
      }
    } catch (error) {
      if (error instanceof M1cWorkspaceTransferError) throw error;
      if (error instanceof WorkspaceBundleError) {
        throw new M1cWorkspaceTransferError('bundle_invalid');
      }
      throw new M1cWorkspaceTransferError('bundle_invalid');
    }

    if (personalData === undefined) {
      await verifyBlobReferences(this.#dependencies.blobStore, references);
    } else {
      await restorePortableBlobs(this.#dependencies.blobStore, personalData);
    }

    let previousPreferences: Readonly<ReviewPreferences> | undefined;
    if (personalData !== undefined) {
      try {
        previousPreferences =
          await this.#dependencies.reviewPreferences.load(workspaceId);
        await saveReviewPreferences(
          this.#dependencies.reviewPreferences,
          personalData.reviewPreferences,
        );
      } catch {
        throw new M1cWorkspaceTransferError('preferences_failed');
      }
    }

    try {
      await this.#dependencies.repository.restoreEmptyWorkspace(
        workspaceId,
        snapshot,
      );
    } catch (error) {
      if (previousPreferences !== undefined) {
        try {
          await saveReviewPreferences(
            this.#dependencies.reviewPreferences,
            previousPreferences,
          );
        } catch {
          throw new M1cWorkspaceTransferError('preferences_failed');
        }
      }
      throw mapRepositoryError(error);
    }

    return Object.freeze({
      fileName,
      byteLength: bytes.byteLength,
      blobCount: references.length,
      personalDataIncluded: personalData !== undefined,
      tableCounts: transferTableCounts(snapshot),
    });
  }
}

function normalizeTransferSnapshot(
  value: Readonly<M1cWorkspaceTransferSnapshot>,
  workspaceId: string,
): Readonly<M1cWorkspaceTransferSnapshot> {
  const domain = normalizeM1cDomainSnapshot(value.domain);
  const entries = normalizeM1dEntrySnapshot(value.entries);
  const associations = normalizeM1dAssociationSnapshot(value.associations);
  const processing = normalizeM1eProcessingSnapshot(value.processing);
  assertM1cDomainWorkspace(domain, workspaceId);
  assertM1dEntryWorkspace(entries, workspaceId);
  assertM1dAssociationWorkspace(associations, workspaceId);
  assertM1eProcessingWorkspace(processing, workspaceId);
  return Object.freeze({domain, entries, associations, processing});
}

function transferTableCounts(
  snapshot: Readonly<M1cWorkspaceTransferSnapshot>,
): Readonly<Record<string, number>> {
  return Object.freeze({
    ...m1cDomainTableCounts(snapshot.domain),
    ...m1dEntryTableCounts(snapshot.entries),
    ...m1dAssociationTableCounts(snapshot.associations),
    ...m1eProcessingTableCounts(snapshot.processing),
  });
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
  const orderedExpected = [...expected].sort((left, right) =>
    left.digest.localeCompare(right.digest),
  );
  const orderedActual = [...actual].sort((left, right) =>
    left.digest.localeCompare(right.digest),
  );
  return (
    orderedExpected.length === orderedActual.length &&
    orderedExpected.every((reference, index) => {
      const candidate = orderedActual[index];
      return (
        candidate?.algorithm === reference.algorithm &&
        candidate.digest === reference.digest &&
        candidate.byteLength === reference.byteLength
      );
    })
  );
}

async function saveReviewPreferences(
  store: ReviewPreferencesStore,
  preferences: Readonly<ReviewPreferences>,
): Promise<void> {
  await store.save(
    preferences.workspaceId,
    preferences.quickTags,
    preferences.automaticKeywords,
    preferences.vocabulary,
    preferences.associationPolicy,
    preferences.explorationPolicy,
    preferences.sourceSubscriptions,
    preferences.entryPreferenceProfile,
    preferences.entryAutomationPolicy,
    preferences.entrySplitRuleProfile,
  );
}
async function restorePortableBlobs(
  blobStore: BlobStore,
  personalData: Readonly<PersonalDataBundleSection>,
): Promise<void> {
  try {
    for (const blob of personalData.blobs) {
      const restored = await blobStore.put(blob.bytes);
      if (!sameBlobReferences([blob.identity], [restored])) {
        throw new Error('Blob identity mismatch.');
      }
    }
  } catch {
    throw new M1cWorkspaceTransferError('blob_unavailable');
  }
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

export function createEmptyM1cWorkspaceTransferSnapshot(
  workspaceId: string,
  createdAt: string,
): M1cWorkspaceTransferSnapshot {
  return Object.freeze({
    domain: createEmptyM1cDomainSnapshot(workspaceId, createdAt),
    entries: createEmptyM1dEntrySnapshot(),
    associations: createEmptyM1dAssociationSnapshot(),
    processing: createEmptyM1eProcessingSnapshot(),
  });
}

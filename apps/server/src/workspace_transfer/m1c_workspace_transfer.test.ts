import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import type {BlobIdentity, BlobStore} from '../storage/blob_store.js';
import {
  createReviewPreferences,
  patchReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import {
  M1C_DOMAIN_BUNDLE_CODEC,
  M1C_DOMAIN_BUNDLE_SCHEMA,
  M1C_DOMAIN_BUNDLE_SECTION_TYPE,
  M1C_DOMAIN_BUNDLE_SECTION_VERSION,
  M1C_DOMAIN_TABLES,
  m1cDomainBlobReferences,
  normalizeM1cDomainSnapshot,
  type M1cDomainSnapshot,
} from './m1c_domain_bundle.js';
import {
  M1D_ASSOCIATION_BUNDLE_CODEC,
  M1D_ASSOCIATION_BUNDLE_SCHEMA,
  M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
  M1D_ASSOCIATION_BUNDLE_SECTION_VERSION,
  M1D_ASSOCIATION_TABLES,
  normalizeM1dAssociationSnapshot,
} from './m1d_association_bundle.js';
import {
  M1D_ENTRY_BUNDLE_CODEC,
  M1D_ENTRY_BUNDLE_SCHEMA,
  M1D_ENTRY_BUNDLE_SECTION_TYPE,
  M1D_ENTRY_BUNDLE_SECTION_VERSION,
  M1D_ENTRY_TABLES,
  normalizeM1dEntrySnapshot,
} from './m1d_entry_bundle.js';
import {createEmptyM1eProcessingSnapshot} from './m1e_processing_bundle.js';
import {
  type M1cDomainTransferRepositoryPort,
  M1cDomainTransferRepositoryError,
  M1cWorkspaceTransfer,
  type M1cWorkspaceTransferSnapshot,
} from './m1c_workspace_transfer.js';
import {writeWorkspaceBundle} from './workspace_bundle.js';
import type {
  StoredWorkspaceBundleFile,
  WorkspaceBundleFileStore,
} from './workspace_bundle_file_store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2040-01-02T03:04:05.000Z';
const BLOB_BYTES = new TextEncoder().encode('synthetic external Blob bytes');
const BLOB_IDENTITY = Object.freeze({
  algorithm: 'sha256' as const,
  digest: createHash('sha256').update(BLOB_BYTES).digest('hex'),
  byteLength: BLOB_BYTES.byteLength,
});

describe('M1C workspace transfer', () => {
  it('exports a closed domain snapshot and restores it through Blob references', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
    const restoreEmptyWorkspace = vi.fn<
      M1cDomainTransferRepositoryPort['restoreEmptyWorkspace']
    >((workspaceId, restoredSnapshot) => {
      expect(workspaceId).toBe(WORKSPACE_ID);
      expect(restoredSnapshot.entries.tables).toHaveLength(9);
      expect(restoredSnapshot.associations.tables).toHaveLength(2);
      return Promise.resolve();
    });
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore,
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });

    const exported = await transfer.exportWorkspace(WORKSPACE_ID);
    const storedBytes = await fileStore.read(exported.fileName);
    const verified = await transfer.verifyWorkspace(
      WORKSPACE_ID,
      exported.fileName,
    );
    expect(verified).toMatchObject({
      fileName: exported.fileName,
      sha256: exported.sha256,
      exportedAt: CREATED_AT,
      blobCount: 1,
      personalDataIncluded: true,
      tableCounts: {
        workspace: 1,
        evidence_blob: 1,
        information_entry: 2,
        information_entry_association_projection: 1,
      },
    });
    expect(restoreEmptyWorkspace).not.toHaveBeenCalled();
    const restored = await transfer.restoreWorkspace(
      WORKSPACE_ID,
      exported.fileName,
    );

    expect(exported).toMatchObject({
      blobCount: 1,
      personalDataIncluded: true,
      tableCounts: {
        workspace: 1,
        evidence_blob: 1,
        information_entry: 2,
        information_entry_association_projection: 1,
      },
    });
    const serialized = new TextDecoder().decode(storedBytes);
    expect(serialized).not.toContain('synthetic external Blob bytes');
    expect(serialized).toContain(Buffer.from(BLOB_BYTES).toString('base64'));
    expect(serialized).toContain('struinfo.personal-data');
    expect(serialized).toContain('"associationPolicy"');
    expect(serialized).toContain('"contentWeight":50');
    expect(serialized).toContain('"explorationPolicy"');
    expect(serialized).toContain('"resultShare":30');
    expect(serialized).toContain('"entryPreferenceProfile"');
    expect(serialized).toContain('"featureIdentity":"postgresql"');
    expect(serialized).toContain('"entryAutomationPolicy"');
    expect(serialized).toContain('"maximumEntriesPerRun":25');
    expect(new TextDecoder().decode(storedBytes)).toContain(
      'struinfo.m1d-entry',
    );
    expect(new TextDecoder().decode(storedBytes)).toContain(
      'struinfo.m1d-association',
    );
    expect(restored).toMatchObject({
      fileName: exported.fileName,
      sha256: exported.sha256,
      exportedAt: CREATED_AT,
      blobCount: 1,
      personalDataIncluded: true,
      tableCounts: {
        workspace: 1,
        evidence_blob: 1,
        information_entry: 2,
        information_entry_association_projection: 1,
      },
    });
    expect(restoreEmptyWorkspace).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      snapshot,
    );
  });

  it('rejects cross-workspace restore before repository writes', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const restoreEmptyWorkspace = vi.fn<
      M1cDomainTransferRepositoryPort['restoreEmptyWorkspace']
    >((workspaceId, restoredSnapshot) => {
      expect(workspaceId).toBe(WORKSPACE_ID);
      expect(restoredSnapshot.domain.tables).toHaveLength(36);
      return Promise.resolve();
    });
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });
    const exported = await transfer.exportWorkspace(WORKSPACE_ID);

    await expect(
      transfer.restoreWorkspace(OTHER_WORKSPACE_ID, exported.fileName),
    ).rejects.toMatchObject({code: 'workspace_mismatch'});
    expect(restoreEmptyWorkspace).not.toHaveBeenCalled();
  });

  it('restores a legacy one-section M1C Bundle with an empty Entry section', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    let restoredSnapshot: Readonly<M1cWorkspaceTransferSnapshot> | undefined;
    const restoreEmptyWorkspace = vi.fn(
      (
        workspaceId: string,
        snapshotInput: Readonly<M1cWorkspaceTransferSnapshot>,
      ) => {
        expect(workspaceId).toBe(WORKSPACE_ID);
        restoredSnapshot = snapshotInput;
        return Promise.resolve();
      },
    );
    const bytes = writeWorkspaceBundle(
      {
        workspaceId: WORKSPACE_ID,
        exportedAt: CREATED_AT,
        sections: [
          {
            type: M1C_DOMAIN_BUNDLE_SECTION_TYPE,
            version: M1C_DOMAIN_BUNDLE_SECTION_VERSION,
            value: snapshot.domain,
          },
        ],
        blobReferences: [BLOB_IDENTITY],
      },
      [M1C_DOMAIN_BUNDLE_CODEC],
    );
    const stored = await fileStore.write(WORKSPACE_ID, CREATED_AT, bytes);
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
    });

    const restored = await transfer.restoreWorkspace(
      WORKSPACE_ID,
      stored.fileName,
    );

    expect(restored.tableCounts.information_entry).toBe(0);
    expect(restoreEmptyWorkspace).toHaveBeenCalledOnce();
    expect(restoredSnapshot).toBeDefined();
    expect(
      restoredSnapshot?.entries.tables.every(
        (table) => table.rows.length === 0,
      ),
    ).toBe(true);
    expect(
      restoredSnapshot?.associations.tables.every(
        (table) => table.rows.length === 0,
      ),
    ).toBe(true);
  });

  it('restores a two-section M1D-2 Bundle with empty associations', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    let restoredSnapshot: Readonly<M1cWorkspaceTransferSnapshot> | undefined;
    const bytes = writeWorkspaceBundle(
      {
        workspaceId: WORKSPACE_ID,
        exportedAt: CREATED_AT,
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
        ],
        blobReferences: [BLOB_IDENTITY],
      },
      [M1C_DOMAIN_BUNDLE_CODEC, M1D_ENTRY_BUNDLE_CODEC],
    );
    const stored = await fileStore.write(WORKSPACE_ID, CREATED_AT, bytes);
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: (_workspaceId, restored) => {
          restoredSnapshot = restored;
          return Promise.resolve();
        },
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
    });

    const restored = await transfer.restoreWorkspace(
      WORKSPACE_ID,
      stored.fileName,
    );

    expect(restored.tableCounts.information_entry).toBe(2);
    expect(restored.tableCounts.information_entry_association_projection).toBe(
      0,
    );
    expect(
      restoredSnapshot?.associations.tables.every(
        (table) => table.rows.length === 0,
      ),
    ).toBe(true);
  });

  it('rejects an Association section that omits its Entry dependency', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const restoreEmptyWorkspace = vi.fn(() => Promise.resolve());
    const bytes = writeWorkspaceBundle(
      {
        workspaceId: WORKSPACE_ID,
        exportedAt: CREATED_AT,
        sections: [
          {
            type: M1C_DOMAIN_BUNDLE_SECTION_TYPE,
            version: M1C_DOMAIN_BUNDLE_SECTION_VERSION,
            value: snapshot.domain,
          },
          {
            type: M1D_ASSOCIATION_BUNDLE_SECTION_TYPE,
            version: M1D_ASSOCIATION_BUNDLE_SECTION_VERSION,
            value: snapshot.associations,
          },
        ],
        blobReferences: [BLOB_IDENTITY],
      },
      [M1C_DOMAIN_BUNDLE_CODEC, M1D_ASSOCIATION_BUNDLE_CODEC],
    );
    const stored = await fileStore.write(WORKSPACE_ID, CREATED_AT, bytes);
    const transfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
    });

    await expect(
      transfer.restoreWorkspace(WORKSPACE_ID, stored.fileName),
    ).rejects.toMatchObject({code: 'bundle_invalid'});
    expect(restoreEmptyWorkspace).not.toHaveBeenCalled();
  });

  it('keeps missing Blobs and non-empty targets as visible failures', async () => {
    const snapshot = syntheticSnapshot();
    const missingBlobTransfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore: {
        put: () => Promise.reject(new Error('unexpected')),
        read: () => Promise.reject(new Error('missing')),
      },
      fileStore: new MemoryBundleFileStore(),
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });
    await expect(
      missingBlobTransfer.exportWorkspace(WORKSPACE_ID),
    ).rejects.toEqual(expect.objectContaining({code: 'blob_unavailable'}));

    const fileStore = new MemoryBundleFileStore();
    const nonEmptyTransfer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () =>
          Promise.reject(
            new M1cDomainTransferRepositoryError('workspace_not_empty'),
          ),
      },
      blobStore: new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES),
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });
    const exported = await nonEmptyTransfer.exportWorkspace(WORKSPACE_ID);
    await expect(
      nonEmptyTransfer.restoreWorkspace(WORKSPACE_ID, exported.fileName),
    ).rejects.toEqual(expect.objectContaining({code: 'workspace_not_empty'}));
  });

  it('does not begin database restore when personal preferences cannot be written', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
    const exporter = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore,
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });
    const exported = await exporter.exportWorkspace(WORKSPACE_ID);
    const restoreEmptyWorkspace = vi.fn(() => Promise.resolve());
    const importer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace,
      },
      blobStore,
      fileStore,
      reviewPreferences: {
        load: () =>
          Promise.resolve(createReviewPreferences(WORKSPACE_ID, ['before'])),
        save: () => Promise.reject(new Error('synthetic preference failure')),
      },
    });

    await expect(
      importer.restoreWorkspace(WORKSPACE_ID, exported.fileName),
    ).rejects.toMatchObject({code: 'preferences_failed'});
    expect(restoreEmptyWorkspace).not.toHaveBeenCalled();
  });

  it('restores saved query conditions and selection through the complete personal package', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
    const savedQueries = {
      version: 1 as const,
      revision: 2,
      views: [
        {
          viewId: WORKSPACE_ID,
          name: 'Synthetic packaged query',
          query: {includePrivate: true, onlyPrivate: true},
          selectedEntryId: '44444444-4444-4444-8444-444444444444',
        },
      ],
    };
    const preferences = patchReviewPreferences(
      createReviewPreferences(WORKSPACE_ID, []),
      {entrySavedQueries: savedQueries},
    );
    const exporter = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore,
      fileStore,
      reviewPreferences: {
        load: () => Promise.resolve(preferences),
        save: () => Promise.reject(new Error('Unexpected export write.')),
      },
      now: () => CREATED_AT,
    });
    const exported = await exporter.exportWorkspace(WORKSPACE_ID);
    const target = memoryReviewPreferences();
    const importer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore,
      fileStore,
      reviewPreferences: target,
    });
    await importer.restoreWorkspace(WORKSPACE_ID, exported.fileName);
    expect((await target.load(WORKSPACE_ID)).entrySavedQueries).toMatchObject(
      savedQueries,
    );
  });

  it('restores previous preferences when an empty-workspace restore is rejected', async () => {
    const snapshot = syntheticSnapshot();
    const fileStore = new MemoryBundleFileStore();
    const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
    const exporter = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () => Promise.resolve(),
      },
      blobStore,
      fileStore,
      reviewPreferences: memoryReviewPreferences(),
      now: () => CREATED_AT,
    });
    const exported = await exporter.exportWorkspace(WORKSPACE_ID);
    let current = patchReviewPreferences(
      createReviewPreferences(WORKSPACE_ID, ['before']),
      {
        entrySavedQueries: {
          version: 1,
          revision: 3,
          views: [
            {
              viewId: WORKSPACE_ID,
              name: 'Synthetic prior query',
              query: {includePrivate: false},
            },
          ],
        },
      },
    );
    const priorQueries = current.entrySavedQueries;
    const save = vi.fn<ReviewPreferencesStore['save']>((...args) => {
      current = createReviewPreferences(...args);
      return Promise.resolve(current);
    });
    const importer = new M1cWorkspaceTransfer({
      repository: {
        exportWorkspace: () => Promise.resolve(snapshot),
        restoreEmptyWorkspace: () =>
          Promise.reject(
            new M1cDomainTransferRepositoryError('workspace_not_empty'),
          ),
      },
      blobStore,
      fileStore,
      reviewPreferences: {
        load: () => Promise.resolve(current),
        save,
      },
    });

    await expect(
      importer.restoreWorkspace(WORKSPACE_ID, exported.fileName),
    ).rejects.toMatchObject({code: 'workspace_not_empty'});
    expect(save).toHaveBeenCalledTimes(2);
    expect(current.quickTags).toEqual(['before']);
    expect(current.entrySavedQueries).toEqual(priorQueries);
  });
  it.each([true, false])(
    'isolates preference reads and writes while a restore settles (accepted=%s)',
    async (accepted) => {
      const root = mkdtempSync(join(tmpdir(), 'struinfo-restore-overlap-'));
      const started = restoreGate();
      const finish = restoreGate();
      let restoring: Promise<unknown> | undefined;
      try {
        const snapshot = syntheticSnapshot();
        const fileStore = new MemoryBundleFileStore();
        const blobStore = new MemoryBlobStore(BLOB_IDENTITY, BLOB_BYTES);
        const exporter = new M1cWorkspaceTransfer({
          repository: {
            exportWorkspace: () => Promise.resolve(snapshot),
            restoreEmptyWorkspace: () => Promise.resolve(),
          },
          blobStore,
          fileStore,
          reviewPreferences: memoryReviewPreferences(),
          now: () => CREATED_AT,
        });
        const exported = await exporter.exportWorkspace(WORKSPACE_ID);
        const store = new LocalReviewPreferencesStore(root);
        await store.save(WORKSPACE_ID, ['synthetic-before-restore']);
        const importer = new M1cWorkspaceTransfer({
          repository: {
            exportWorkspace: () => Promise.resolve(snapshot),
            restoreEmptyWorkspace: async () => {
              started.resolve();
              await finish.promise;
              if (!accepted)
                throw new M1cDomainTransferRepositoryError(
                  'workspace_not_empty',
                );
            },
          },
          blobStore,
          fileStore,
          reviewPreferences: store,
        });
        restoring = importer
          .restoreWorkspace(WORKSPACE_ID, exported.fileName)
          .catch((error: unknown) => error);
        await started.promise;
        const savedQueries = {
          version: 1 as const,
          revision: 1,
          views: [
            {
              viewId: OTHER_WORKSPACE_ID,
              name: 'Synthetic later query',
              query: {includePrivate: false},
            },
          ],
        };
        const write = () =>
          store.update(WORKSPACE_ID, (current) => ({
            next: patchReviewPreferences(current, {
              entrySavedQueries: savedQueries,
            }),
            result: undefined,
          }));
        const writeFailure = await write().catch((error: unknown) => error);
        const readFailure = await store
          .load(WORKSPACE_ID)
          .catch((error: unknown) => error);
        finish.resolve();
        const outcome = await restoring;
        expect(writeFailure).toMatchObject({code: 'preferences_unavailable'});
        expect(readFailure).toMatchObject({code: 'preferences_unavailable'});
        if (!accepted)
          expect(outcome).toMatchObject({code: 'workspace_not_empty'});
        else expect(outcome).toMatchObject({personalDataIncluded: true});
        await write();
        const final = await store.load(WORKSPACE_ID);
        expect(final.entrySavedQueries).toMatchObject(savedQueries);
        expect(final.quickTags).toEqual(
          accepted ? ['synthetic'] : ['synthetic-before-restore'],
        );
      } finally {
        finish.resolve();
        await restoring;
        rmSync(root, {recursive: true, force: true});
      }
    },
  );

  it('rejects table drift and derives the exact Blob manifest', () => {
    const snapshot = syntheticSnapshot();
    expect(m1cDomainBlobReferences(snapshot.domain)).toEqual([BLOB_IDENTITY]);
    const raw = JSON.parse(JSON.stringify(snapshot.domain)) as {
      tables: {name: string; rows: Record<string, unknown>[]}[];
    };
    const firstTable = raw.tables[0];
    const firstRow = firstTable?.rows[0];
    if (firstRow === undefined) {
      throw new Error('The synthetic M1C snapshot must include one row.');
    }
    firstRow.unexpected = true;
    expect(() => normalizeM1cDomainSnapshot(raw)).toThrow();
  });
});

function restoreGate() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return {promise, resolve};
}

function syntheticSnapshot(): M1cWorkspaceTransferSnapshot {
  const domain: M1cDomainSnapshot = normalizeM1cDomainSnapshot({
    schemaVersion: M1C_DOMAIN_BUNDLE_SCHEMA,
    tables: M1C_DOMAIN_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'workspace'
          ? [{workspace_id: WORKSPACE_ID, created_at: CREATED_AT}]
          : descriptor.name === 'evidence_blob'
            ? [
                {
                  workspace_id: WORKSPACE_ID,
                  blob_id: '33333333-3333-4333-8333-333333333333',
                  digest_algorithm: 'sha256',
                  digest: BLOB_IDENTITY.digest,
                  byte_length: BLOB_IDENTITY.byteLength,
                  media_type: 'text/markdown',
                  read_revoked_at: null,
                  delete_after: null,
                  created_at: CREATED_AT,
                },
              ]
            : [],
    })),
  });
  const entries = normalizeM1dEntrySnapshot({
    schemaVersion: M1D_ENTRY_BUNDLE_SCHEMA,
    tables: M1D_ENTRY_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry'
          ? [
              currentEntryRow(
                '44444444-4444-4444-8444-444444444444',
                '77777777-7777-4777-8777-777777777777',
                0,
              ),
              currentEntryRow(
                '88888888-8888-4888-8888-888888888888',
                '99999999-9999-4999-8999-999999999999',
                1,
              ),
            ]
          : [],
    })),
  });
  const associations = normalizeM1dAssociationSnapshot({
    schemaVersion: M1D_ASSOCIATION_BUNDLE_SCHEMA,
    tables: M1D_ASSOCIATION_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows:
        descriptor.name === 'information_entry_association_projection'
          ? [
              {
                workspace_id: WORKSPACE_ID,
                entry_low_id: '44444444-4444-4444-8444-444444444444',
                entry_high_id: '88888888-8888-4888-8888-888888888888',
                entry_low_revision: 1,
                entry_low_revision_id: '77777777-7777-4777-8777-777777777777',
                entry_high_revision: 1,
                entry_high_revision_id: '99999999-9999-4999-8999-999999999999',
                content_similarity: 2500,
                type_similarity: 10000,
                domain_similarity: 5000,
                base_score: 4125,
                algorithm_version: 'synthetic-v1',
                candidate_basis: 'content_keyword,type_keyword',
                candidate_rank: 1,
                generated_at: CREATED_AT,
              },
            ]
          : [],
    })),
  });
  return Object.freeze({
    domain,
    entries,
    associations,
    processing: createEmptyM1eProcessingSnapshot(),
  });
}

function currentEntryRow(
  entryId: string,
  revisionId: string,
  documentOrder: number,
) {
  return {
    workspace_id: WORKSPACE_ID,
    entry_id: entryId,
    resource_id: '55555555-5555-4555-8555-555555555555',
    snapshot_id: '66666666-6666-4666-8666-666666666666',
    current_revision: 1,
    current_revision_id: revisionId,
    document_order: documentOrder,
    title_path: 'Entry ' + documentOrder.toString(),
    body: 'Synthetic current Entry body.',
    body_sha256: 'a'.repeat(64),
    chunk_mode: 'split',
    split_rule_version: 'synthetic-v1',
    is_private: false,
    is_current_structure: true,
    type_keyword: null,
    type_custom_name: null,
    usefulness_score: 3,
    interest_score: 3,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function memoryReviewPreferences(): ReviewPreferencesStore {
  let preferences = createReviewPreferences(
    WORKSPACE_ID,
    ['synthetic'],
    undefined,
    undefined,
    {
      revision: 2,
      contentWeight: 50,
      typeWeight: 25,
      domainWeight: 25,
      threshold: 2_000,
    },
    {
      revision: 4,
      enabled: true,
      resultShare: 30,
      neighborExpansion: true,
      crossDomain: false,
      serendipity: true,
    },
    undefined,
    {
      revision: 2,
      enabled: true,
      rules: [
        {
          ruleId: '77777777-7777-4777-8777-777777777777',
          dimension: 'usefulness',
          featureKind: 'content_keyword',
          featureIdentity: 'postgresql',
          displayValue: 'PostgreSQL',
          effect: 'prefer',
          weight: 5,
        },
      ],
    },
    {
      revision: 3,
      enabled: true,
      paused: false,
      profileRevision: 2,
      minimumMatchedRuleCount: 1,
      advanceThresholds: {
        usefulness: 4,
        interest: 3,
        requiredDimensions: 1,
      },
      deferThresholds: {
        usefulness: 4,
        interest: 3,
        requiredDimensions: 1,
      },
      budgets: {
        maximumEntriesPerRun: 25,
        maximumAdvanceCandidatesPerRun: 5,
        maximumDeferCandidatesPerRun: 5,
      },
      failureMode: 'pause',
    },
  );
  return {
    load(workspaceId) {
      if (workspaceId !== WORKSPACE_ID)
        return Promise.reject(new Error('workspace'));
      return Promise.resolve(preferences);
    },
    save(
      workspaceId,
      quickTags,
      automaticKeywords,
      vocabulary,
      associationPolicy,
      explorationPolicy,
      sourceSubscriptions,
      entryPreferenceProfile,
      entryAutomationPolicy,
      entrySplitRuleProfile,
      entryClassificationProfile,
      entrySavedQueries,
    ) {
      if (workspaceId !== WORKSPACE_ID)
        return Promise.reject(new Error('workspace'));
      preferences = createReviewPreferences(
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        associationPolicy,
        explorationPolicy,
        sourceSubscriptions,
        entryPreferenceProfile,
        entryAutomationPolicy,
        entrySplitRuleProfile,
        entryClassificationProfile,
        entrySavedQueries,
      );
      return Promise.resolve(preferences);
    },
  };
}
class MemoryBlobStore implements BlobStore {
  readonly #identity: Readonly<BlobIdentity>;
  readonly #bytes: Uint8Array;

  public constructor(identity: Readonly<BlobIdentity>, bytes: Uint8Array) {
    this.#identity = identity;
    this.#bytes = Uint8Array.from(bytes);
  }

  public put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>> {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      digest !== this.#identity.digest ||
      bytes.byteLength !== this.#identity.byteLength
    ) {
      return Promise.reject(new Error('unexpected Blob write'));
    }
    return Promise.resolve(this.#identity);
  }

  public read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    return identity.digest === this.#identity.digest
      ? Promise.resolve(Uint8Array.from(this.#bytes))
      : Promise.reject(new Error('missing Blob'));
  }
}

class MemoryBundleFileStore implements WorkspaceBundleFileStore {
  readonly #files = new Map<string, Uint8Array>();

  public write(
    workspaceId: string,
    _exportedAt: string,
    bytes: Uint8Array,
  ): Promise<Readonly<StoredWorkspaceBundleFile>> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = `${workspaceId}-${sha256.slice(0, 12)}.workspace-bundle.json`;
    this.#files.set(fileName, Uint8Array.from(bytes));
    return Promise.resolve(
      Object.freeze({fileName, byteLength: bytes.byteLength, sha256}),
    );
  }

  public read(fileName: string): Promise<Uint8Array> {
    const bytes = this.#files.get(fileName);
    return bytes === undefined
      ? Promise.reject(new Error('missing Bundle'))
      : Promise.resolve(Uint8Array.from(bytes));
  }
}

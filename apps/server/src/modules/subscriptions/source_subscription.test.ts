import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryEmptySnapshotRepositoryPort,
  InformationEntryMaterializeRow,
} from '../entries/index.js';
import type {
  EvidenceSnapshotReadState,
  ImportMarkdownEvidenceResult,
} from '../evidence/index.js';
import type {
  EntryAutomationClaim,
  EntryAutomationExecution,
  EntryAutomationExecutionInitialize,
  EntryAutomationExecutionRepositoryPort,
  EntryAutomationExecutionSettle,
  ProcessingRun,
  ProcessingRunRepositoryPort,
  ProcessingRunWriteOutcome,
} from '../processing/index.js';
import {
  createReviewPreferences,
  type EntryAutomationPolicy,
  type EntryPreferenceProfile,
  type ReviewPreferences,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {
  SourceConnectorRegistry,
  type SourceConnectorImportDependencies,
  type SourceConnectorImportInput,
} from './source_connector.js';
import {SourceSubscriptionService} from './source_subscription.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const COMMIT_SHA = 'a'.repeat(40);
const SAME_CONTENT_COMMIT_SHA = 'b'.repeat(40);
const CHANGED_COMMIT_SHA = 'c'.repeat(40);

describe('SourceSubscriptionService', () => {
  it('stores external configuration and imports only changed Git content', async () => {
    const preferences = memoryPreferences();
    const processing = memoryProcessingRuns();
    const originalSource = new TextEncoder().encode('# Synthetic source\n');
    const changedSource = new TextEncoder().encode(
      '# Synthetic source\n\nChanged.\n',
    );
    const observations = [
      {
        commitSha: COMMIT_SHA,
        sourceUtf8: originalSource,
        canonicalUri: `https://github.com/example/project/blob/${COMMIT_SHA}/docs/source.md`,
      },
      {
        commitSha: SAME_CONTENT_COMMIT_SHA,
        sourceUtf8: originalSource,
        canonicalUri: `https://github.com/example/project/blob/${SAME_CONTENT_COMMIT_SHA}/docs/source.md`,
      },
      {
        commitSha: CHANGED_COMMIT_SHA,
        sourceUtf8: changedSource,
        canonicalUri: `https://github.com/example/project/blob/${CHANGED_COMMIT_SHA}/docs/source.md`,
      },
    ];
    const reader = {
      read: vi.fn(() => {
        const observation = observations.shift();
        return observation === undefined
          ? Promise.reject(new Error('unexpected source read'))
          : Promise.resolve(observation);
      }),
    };
    let importCount = 0;
    const imported = vi.fn((): Promise<ImportMarkdownEvidenceResult> =>
      Promise.resolve(
        (() => {
          importCount += 1;
          return {
            status: 'created' as const,
            workspaceId: WORKSPACE_ID,
            commandIdempotencyKey: 'synthetic',
            resourceId: '33333333-3333-4333-8333-333333333333',
            snapshotId:
              importCount === 1
                ? '44444444-4444-4444-8444-444444444444'
                : '77777777-7777-4777-8777-777777777777',
            structureId: '55555555-5555-4555-8555-555555555555',
            fragmentIds: Object.freeze([
              '66666666-6666-4666-8666-666666666666',
            ]),
            mediaAssetIds: Object.freeze([]),
          };
        })(),
      ),
    );
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing,
      reader,
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.reject(new Error('unexpected Blob read')),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      importEvidence: imported,
      now: () => '2026-08-25T08:00:00.000Z',
    });

    const replaced = await service.replace(0, [
      {
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Synthetic source',
        enabled: false,
        repositoryUri: 'https://github.com/example/project.git',
        repositoryRef: 'main',
        repositoryPath: 'docs/source.md',
        profile: 'commonmark-v1',
        sourceAlias: 'synthetic-source',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 1_440,
      },
    ]);
    expect(replaced.outcome).toBe('applied');
    const savedSubscription = replaced.value.subscriptions[0];
    expect(savedSubscription?.kind).toBe('github_markdown');
    if (savedSubscription?.kind !== 'github_markdown') {
      throw new Error('expected saved Git subscription');
    }
    expect(savedSubscription.repositoryUri).toBe(
      'https://github.com/example/project',
    );

    await expect(
      service.runNow(SUBSCRIPTION_ID, 'first-check'),
    ).resolves.toMatchObject({
      outcome: 'imported',
      subscriptionId: SUBSCRIPTION_ID,
      snapshotId: '44444444-4444-4444-8444-444444444444',
    });
    await expect(
      service.runNow(SUBSCRIPTION_ID, 'second-check'),
    ).resolves.toMatchObject({
      outcome: 'unchanged',
      subscriptionId: SUBSCRIPTION_ID,
    });
    await expect(
      service.runNow(SUBSCRIPTION_ID, 'third-check'),
    ).resolves.toMatchObject({
      outcome: 'imported',
      subscriptionId: SUBSCRIPTION_ID,
      snapshotId: '77777777-7777-4777-8777-777777777777',
    });
    await expect(
      service.runNow(SUBSCRIPTION_ID, 'third-check'),
    ).resolves.toMatchObject({
      outcome: 'existing',
      subscriptionId: SUBSCRIPTION_ID,
    });

    expect(reader.read).toHaveBeenCalledTimes(3);
    expect(imported).toHaveBeenCalledTimes(2);
    const saved = await service.list();
    expect(saved.subscriptions[0]).toMatchObject({
      lastAttemptAt: '2026-08-25T08:00:00.000Z',
      lastSuccessAt: '2026-08-25T08:00:00.000Z',
      cursor: {
        commitSha: CHANGED_COMMIT_SHA,
      },
    });
    expect(
      (await processing.listRecentRuns(WORKSPACE_ID, 100)).map(
        (run) => run.status,
      ),
    ).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });

  it('checks only enabled subscriptions which are due', async () => {
    const preferences = memoryPreferences();
    const processing = memoryProcessingRuns();
    const reader = {
      read: vi.fn(() =>
        Promise.resolve({
          commitSha: COMMIT_SHA,
          sourceUtf8: new TextEncoder().encode('Synthetic'),
          canonicalUri:
            'https://github.com/example/project/blob/' +
            COMMIT_SHA +
            '/source.md',
        }),
      ),
    };
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing,
      reader,
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.reject(new Error('unexpected Blob read')),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      importEvidence: () =>
        Promise.resolve({
          status: 'persistence_failed',
          code: 'unavailable',
        }),
      now: () => '2026-08-25T08:00:00.000Z',
    });
    await service.replace(0, [
      {
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Manual only',
        enabled: false,
        repositoryUri: 'https://github.com/example/project',
        repositoryRef: 'main',
        repositoryPath: 'source.md',
        profile: 'commonmark-v1',
        sourceAlias: 'manual-only',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 15,
      },
      {
        subscriptionId: '77777777-7777-4777-8777-777777777777',
        label: 'Scheduled source',
        enabled: true,
        repositoryUri: 'https://github.com/example/project',
        repositoryRef: 'main',
        repositoryPath: 'scheduled.md',
        profile: 'commonmark-v1',
        sourceAlias: 'scheduled-source',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 15,
      },
    ]);

    await expect(service.runDue()).resolves.toEqual([]);
    await expect(service.runDue()).resolves.toEqual([]);
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(
      (await processing.listRecentRuns(WORKSPACE_ID, 100)).map((run) => ({
        status: run.status,
        errorCode: run.errorCode,
      })),
    ).toEqual([{status: 'failed', errorCode: 'source_import_unavailable'}]);
  });

  it('optionally materializes a changed source and routes only its current Entries', async () => {
    const text = '# Synthetic section\n\nSynthetic body.\n';
    const textBytes = new TextEncoder().encode(text);
    const textSha256 = createHash('sha256').update(textBytes).digest('hex');
    const snapshotId = '44444444-4444-4444-8444-444444444444';
    const fragmentId = '66666666-6666-4666-8666-666666666666';
    const snapshot: EvidenceSnapshotReadState = {
      workspaceId: WORKSPACE_ID,
      snapshotId,
      resourceId: '33333333-3333-4333-8333-333333333333',
      resourceKind: 'git_file',
      sourceKey: 'synthetic-source',
      capturedAt: '2026-08-25T08:00:00.000Z',
      fragmentCount: 1,
      rawSha256: textSha256,
      canonicalContentSha256: textSha256,
      canonicalizationVersion: 'utf8-lf-v1',
      mediaType: 'text/markdown',
      structures: [
        {
          structureId: '55555555-5555-4555-8555-555555555555',
          parserName: 'synthetic',
          parserVersion: '1',
          textNormalizationVersion: 'utf8-lf-v1',
          structureSha256: textSha256,
          textBlob: {
            algorithm: 'sha256',
            digest: textSha256,
            byteLength: textBytes.byteLength,
          },
          fragments: [
            {
              fragmentId,
              structureId: '55555555-5555-4555-8555-555555555555',
              nodeId: '77777777-7777-4777-8777-777777777777',
              nodeKind: 'section',
              codePointRange: {start: 0, end: Array.from(text).length},
              selectedTextSha256: textSha256,
            },
          ],
        },
      ],
    };
    const preferences = memoryPreferences(automationPreferences());
    const processing = memoryProcessingRuns();
    const entries = new MemoryMaterializedEntries();
    const automation = new MemoryAutomationExecution();
    const imported = vi.fn((): Promise<ImportMarkdownEvidenceResult> =>
      Promise.resolve({
        status: 'created',
        workspaceId: WORKSPACE_ID,
        commandIdempotencyKey: 'synthetic',
        resourceId: snapshot.resourceId,
        snapshotId,
        structureId: snapshot.structures[0]?.structureId ?? '',
        fragmentIds: Object.freeze([fragmentId]),
        mediaAssetIds: Object.freeze([]),
      }),
    );
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing,
      reader: {
        read: () =>
          Promise.resolve({
            commitSha: COMMIT_SHA,
            sourceUtf8: textBytes,
            canonicalUri: `https://github.com/example/project/blob/${COMMIT_SHA}/docs/source.md`,
          }),
      },
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.resolve(textBytes),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      evidenceRead: {
        listSnapshots: () => Promise.resolve([snapshot]),
        loadSnapshot: () => Promise.resolve(snapshot),
      },
      entries,
      automationExecutions: automation,
      importEvidence: imported,
      now: () => '2026-08-25T08:00:00.000Z',
    });
    await service.replace(0, [
      {
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Synthetic routed source',
        enabled: false,
        repositoryUri: 'https://github.com/example/project',
        repositoryRef: 'main',
        repositoryPath: 'docs/source.md',
        profile: 'commonmark-v1',
        sourceAlias: 'synthetic-source',
        isPrivate: false,
        routeAfterImport: true,
        intervalMinutes: 1_440,
      },
    ]);

    const result = await service.runNow(SUBSCRIPTION_ID, 'routed-check');

    expect(result).toMatchObject({
      outcome: 'imported',
      snapshotId,
      automationRunId: automation.current?.runId,
      materializedEntryCount: 1,
    });
    expect(entries.values).toHaveLength(1);
    expect(automation.current).toMatchObject({
      status: 'succeeded',
      claims: [{status: 'completed', entryId: entries.values[0]?.entryId}],
    });
    expect((await service.list()).subscriptions[0]?.cursor).toMatchObject({
      commitSha: COMMIT_SHA,
    });
  });

  it('imports an RSS connector batch before advancing its opaque cursor', async () => {
    const preferences = memoryPreferences();
    const processing = memoryProcessingRuns();
    const connector = {
      connectorId: 'builtin.rss-atom.v1',
      read: vi.fn(() =>
        Promise.resolve({
          status: 'changed' as const,
          cursor: 'synthetic-cursor-v1',
          documents: Object.freeze([
            Object.freeze({
              externalId: 'synthetic-feed-item-1',
              version: 'version-1',
              canonicalUri: 'https://example.invalid/items/1',
              mediaType: 'application/rss+xml',
              profile: 'commonmark-v1' as const,
              sourceUtf8: new TextEncoder().encode('# First\n'),
            }),
            Object.freeze({
              externalId: 'synthetic-feed-item-2',
              version: 'version-1',
              canonicalUri: 'https://example.invalid/items/2',
              mediaType: 'application/rss+xml',
              profile: 'commonmark-v1' as const,
              sourceUtf8: new TextEncoder().encode('# Second\n'),
            }),
          ]),
        }),
      ),
    };
    const importConnectorDocuments = vi.fn(() =>
      Promise.resolve({
        status: 'complete' as const,
        documents: Object.freeze([
          Object.freeze({
            externalId: 'synthetic-feed-item-1',
            resourceId: '33333333-3333-4333-8333-333333333333',
            snapshotId: '44444444-4444-4444-8444-444444444444',
            outcome: 'created' as const,
          }),
          Object.freeze({
            externalId: 'synthetic-feed-item-2',
            resourceId: '55555555-5555-4555-8555-555555555555',
            snapshotId: '66666666-6666-4666-8666-666666666666',
            outcome: 'created' as const,
          }),
        ]),
      }),
    );
    const gitReader = {read: vi.fn()};
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing,
      reader: gitReader,
      connectors: new SourceConnectorRegistry([connector]),
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.reject(new Error('unexpected Blob read')),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      importConnectorDocuments,
      now: () => '2026-08-25T08:00:00.000Z',
    });
    await service.replace(0, [
      {
        kind: 'rss_atom',
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Synthetic Feed',
        enabled: false,
        feedUrl: 'https://example.invalid/feed.xml',
        itemLimit: 20,
        sourceAlias: 'synthetic-feed',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 60,
      },
    ]);

    await expect(
      service.runNow(SUBSCRIPTION_ID, 'rss-check'),
    ).resolves.toMatchObject({
      outcome: 'imported',
      importedDocumentCount: 2,
      snapshotId: '44444444-4444-4444-8444-444444444444',
      snapshotIds: [
        '44444444-4444-4444-8444-444444444444',
        '66666666-6666-4666-8666-666666666666',
      ],
    });
    expect(gitReader.read).not.toHaveBeenCalled();
    expect(importConnectorDocuments).toHaveBeenCalledTimes(1);
    expect((await service.list()).subscriptions[0]).toMatchObject({
      kind: 'rss_atom',
      cursor: {connectorCursor: 'synthetic-cursor-v1'},
    });
  });

  it('passes declarative JSON mappings to the connector and commits its cursor last', async () => {
    const preferences = memoryPreferences();
    const connector = {
      connectorId: 'builtin.json-api.v1',
      read: vi.fn(() =>
        Promise.resolve({
          status: 'changed' as const,
          cursor: 'synthetic-json-cursor-v1',
          documents: Object.freeze([
            Object.freeze({
              externalId: 'record-1',
              version: 'version-1',
              canonicalUri: 'https://api.example.invalid/records/1',
              mediaType: 'application/json',
              profile: 'commonmark-v1' as const,
              sourceUtf8: new TextEncoder().encode('# Record one\n'),
            }),
          ]),
        }),
      ),
    };
    const importConnectorDocuments = vi.fn(() =>
      Promise.resolve({
        status: 'complete' as const,
        documents: Object.freeze([
          Object.freeze({
            externalId: 'record-1',
            resourceId: '33333333-3333-4333-8333-333333333333',
            snapshotId: '44444444-4444-4444-8444-444444444444',
            outcome: 'created' as const,
          }),
        ]),
      }),
    );
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing: memoryProcessingRuns(),
      reader: {read: vi.fn()},
      connectors: new SourceConnectorRegistry([connector]),
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.reject(new Error('unexpected Blob read')),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      importConnectorDocuments,
      now: () => '2026-08-27T08:00:00.000Z',
    });
    await service.replace(0, [
      {
        kind: 'json_api',
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Synthetic JSON API',
        enabled: false,
        endpointUrl: 'https://api.example.invalid/records',
        recordsPath: 'data.items',
        externalIdPath: 'id',
        titlePath: 'title',
        bodyPath: 'content.body',
        canonicalUriPath: 'url',
        publishedAtPath: 'published_at',
        versionPath: 'revision',
        recordLimit: 16,
        pageCursor: {
          queryParameter: 'cursor',
          responsePath: 'next_cursor',
        },
        incrementalCursor: {
          queryParameter: 'since',
          responsePath: 'checkpoint',
        },
        authentication: {
          kind: 'bearer_env',
          variable: 'STRUIINFO_SYNTHETIC_API_TOKEN',
        },
        sourceAlias: 'synthetic-json',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 60,
      },
    ]);

    await expect(
      service.runNow(SUBSCRIPTION_ID, 'json-check'),
    ).resolves.toMatchObject({
      outcome: 'imported',
      importedDocumentCount: 1,
      snapshotId: '44444444-4444-4444-8444-444444444444',
    });
    expect(connector.read).toHaveBeenCalledWith({
      subscriptionId: SUBSCRIPTION_ID,
      configuration: {
        endpointUrl: 'https://api.example.invalid/records',
        recordsPath: 'data.items',
        externalIdPath: 'id',
        titlePath: 'title',
        bodyPath: 'content.body',
        canonicalUriPath: 'url',
        publishedAtPath: 'published_at',
        versionPath: 'revision',
        recordLimit: 16,
        pageCursor: {
          queryParameter: 'cursor',
          responsePath: 'next_cursor',
        },
        incrementalCursor: {
          queryParameter: 'since',
          responsePath: 'checkpoint',
        },
        authentication: {
          kind: 'bearer_env',
          variable: 'STRUIINFO_SYNTHETIC_API_TOKEN',
        },
      },
    });
    expect(importConnectorDocuments).toHaveBeenCalledTimes(1);
    expect((await service.list()).subscriptions[0]).toMatchObject({
      kind: 'json_api',
      cursor: {connectorCursor: 'synthetic-json-cursor-v1'},
    });
  });

  it('runs constrained Web and installed plugin adapters through one host-owned import path', async () => {
    const preferences = memoryPreferences();
    const webRead = vi.fn(() =>
      Promise.resolve({
        status: 'changed' as const,
        cursor: 'synthetic-web-cursor-v1',
        documents: [
          {
            externalId: 'page:a',
            version: 'version-1',
            canonicalUri: 'https://example.invalid/articles',
            mediaType: 'text/html',
            profile: 'commonmark-v1' as const,
            sourceUtf8: new TextEncoder().encode('# Synthetic page\n'),
          },
        ],
      }),
    );
    const pluginRead = vi.fn(() =>
      Promise.resolve({
        status: 'changed' as const,
        cursor: 'synthetic-plugin-cursor-v1',
        documents: [
          {
            externalId: 'plugin-record-1',
            version: 'version-1',
            canonicalUri: 'https://example.invalid/plugin/1',
            mediaType: 'text/markdown',
            profile: 'commonmark-v1' as const,
            sourceUtf8: new TextEncoder().encode('# Plugin record\n'),
          },
        ],
      }),
    );
    const importConnectorDocuments = vi.fn(
      (
        _dependencies: Readonly<SourceConnectorImportDependencies>,
        input: Readonly<SourceConnectorImportInput>,
      ) =>
        Promise.resolve({
          status: 'complete' as const,
          documents: Object.freeze(
            input.result.documents.map((document, index) =>
              Object.freeze({
                externalId: document.externalId,
                resourceId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
                snapshotId:
                  input.connectorId === 'builtin.web.v1'
                    ? '44444444-4444-4444-8444-444444444444'
                    : '55555555-5555-4555-8555-555555555555',
                outcome: 'created' as const,
              }),
            ),
          ),
        }),
    );
    const service = new SourceSubscriptionService({
      workspaceId: WORKSPACE_ID,
      preferences,
      processing: memoryProcessingRuns(),
      reader: {read: vi.fn()},
      connectors: new SourceConnectorRegistry([
        {
          connectorId: 'builtin.web.v1',
          descriptor: {
            displayName: '受限网页',
            origin: 'builtin',
            configurationMode: 'internal',
          },
          read: webRead,
        },
        {
          connectorId: 'plugin.synthetic.v1',
          descriptor: {
            displayName: 'Synthetic plugin',
            origin: 'plugin',
            configurationMode: 'external_reference',
          },
          read: pluginRead,
        },
      ]),
      blobStore: {
        put: () => Promise.reject(new Error('unexpected Blob write')),
        read: () => Promise.reject(new Error('unexpected Blob read')),
      },
      evidence: {
        saveCapture: () =>
          Promise.reject(new Error('unexpected Evidence write')),
      },
      importConnectorDocuments,
      now: () => '2026-08-27T08:00:00.000Z',
    });
    await service.replace(0, [
      {
        kind: 'web',
        subscriptionId: SUBSCRIPTION_ID,
        label: 'Synthetic Web',
        enabled: false,
        pageUrl: 'https://example.invalid/articles',
        additionalPaths: ['/about'],
        sourceAlias: 'synthetic-web',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 60,
      },
      {
        kind: 'plugin',
        subscriptionId: '66666666-6666-4666-8666-666666666666',
        label: 'Synthetic plugin',
        enabled: false,
        connectorId: 'plugin.synthetic.v1',
        configurationRef: 'profile.default',
        sourceAlias: 'synthetic-plugin',
        isPrivate: true,
        routeAfterImport: false,
        intervalMinutes: 120,
      },
    ]);

    expect(service.connectorCapabilities()).toEqual([
      expect.objectContaining({connectorId: 'builtin.web.v1'}),
      expect.objectContaining({
        connectorId: 'plugin.synthetic.v1',
        origin: 'plugin',
      }),
    ]);
    await service.runNow(SUBSCRIPTION_ID, 'web-check');
    await service.runNow(
      '66666666-6666-4666-8666-666666666666',
      'plugin-check',
    );
    expect(webRead).toHaveBeenCalledWith({
      subscriptionId: SUBSCRIPTION_ID,
      configuration: {
        pageUrl: 'https://example.invalid/articles',
        additionalPaths: ['/about'],
      },
    });
    expect(pluginRead).toHaveBeenCalledWith({
      subscriptionId: '66666666-6666-4666-8666-666666666666',
      configuration: {configurationRef: 'profile.default'},
    });
    expect(importConnectorDocuments).toHaveBeenCalledTimes(2);
    expect((await service.list()).subscriptions).toMatchObject([
      {kind: 'web', cursor: {connectorCursor: 'synthetic-web-cursor-v1'}},
      {
        kind: 'plugin',
        cursor: {connectorCursor: 'synthetic-plugin-cursor-v1'},
      },
    ]);
  });
});

function memoryPreferences(
  initial: Readonly<ReviewPreferences> = createReviewPreferences(
    WORKSPACE_ID,
    [],
  ),
): ReviewPreferencesStore {
  let current = initial;
  return {
    load: () => Promise.resolve(current),
    save: (
      workspaceId,
      quickTags,
      automaticKeywords,
      vocabulary,
      associationPolicy,
      explorationPolicy,
      sourceSubscriptions,
      entryPreferenceProfile,
      entryAutomationPolicy,
    ) => {
      current = createReviewPreferences(
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        associationPolicy,
        explorationPolicy,
        sourceSubscriptions,
        entryPreferenceProfile,
        entryAutomationPolicy,
      );
      return Promise.resolve(current);
    },
  };
}

class MemoryMaterializedEntries implements InformationEntryEmptySnapshotRepositoryPort {
  public values: readonly Readonly<CurrentInformationEntry>[] = [];

  public materializeEntries(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ) {
    if (this.values.length > 0) {
      return Promise.resolve({outcome: 'existing' as const, createdCount: 0});
    }
    return this.writeRows(entries);
  }

  public materializeEntriesIfSnapshotEmpty(
    entries: readonly Readonly<InformationEntryMaterializeRow>[],
  ) {
    if (this.values.length > 0) {
      return Promise.resolve({
        outcome: 'snapshot_not_empty' as const,
        createdCount: 0,
      });
    }
    return this.writeRows(entries);
  }

  public reviseEntry(): Promise<'not_found'> {
    return Promise.resolve('not_found');
  }

  public loadCurrentEntries(): Promise<
    readonly Readonly<CurrentInformationEntry>[]
  > {
    return Promise.resolve(this.values);
  }

  private writeRows(rows: readonly Readonly<InformationEntryMaterializeRow>[]) {
    this.values = Object.freeze(
      rows.map((row) =>
        Object.freeze({
          workspaceId: row.workspaceId,
          entryId: row.entryId,
          resourceId: row.resourceId,
          snapshotId: row.snapshotId,
          revision: 1,
          revisionId: row.revisionId,
          sourceKey: 'synthetic-source',
          capturedAt: '2026-08-25T08:00:00.000Z',
          value: row.value,
        }),
      ),
    );
    return Promise.resolve({
      outcome: 'created' as const,
      createdCount: rows.length,
    });
  }
}

class MemoryAutomationExecution implements EntryAutomationExecutionRepositoryPort {
  public current: Readonly<EntryAutomationExecution> | undefined;

  public loadExecution(): Promise<
    Readonly<EntryAutomationExecution> | undefined
  > {
    return Promise.resolve(this.current);
  }

  public initializeExecution(
    initialize: Readonly<EntryAutomationExecutionInitialize>,
  ): Promise<ProcessingRunWriteOutcome> {
    this.current = Object.freeze({
      ...initialize,
      status: 'queued',
      version: 1,
      claims: Object.freeze(
        initialize.claims.map((claim) => claimValue(initialize, claim)),
      ),
    });
    return Promise.resolve('applied');
  }

  public startExecution(
    _workspaceId: string,
    _runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current?.version !== expectedVersion)
      return Promise.resolve('stale');
    this.current = Object.freeze({
      ...this.current,
      status: 'running',
      version: 2,
    });
    return Promise.resolve('applied');
  }

  public settleExecution(
    settle: Readonly<EntryAutomationExecutionSettle>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current?.version !== settle.expectedVersion) {
      return Promise.resolve('stale');
    }
    this.current = Object.freeze({
      ...this.current,
      status: settle.status,
      version: this.current.version + 1,
      claims: Object.freeze(
        this.current.claims.map((claim) =>
          Object.freeze({
            ...claim,
            status: settle.status === 'succeeded' ? 'completed' : 'compensated',
            finishedAt: '2026-08-25T08:00:01.000Z',
          }),
        ),
      ),
    });
    return Promise.resolve('applied');
  }
}

function claimValue(
  initialize: Readonly<EntryAutomationExecutionInitialize>,
  claim: Readonly<EntryAutomationExecutionInitialize['claims'][number]>,
): Readonly<EntryAutomationClaim> {
  return Object.freeze({
    workspaceId: initialize.workspaceId,
    runId: initialize.runId,
    ...claim,
    status: 'claimed',
    createdAt: '2026-08-25T08:00:00.000Z',
  });
}

function automationPreferences(): Readonly<ReviewPreferences> {
  return createReviewPreferences(
    WORKSPACE_ID,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    automationProfile(),
    automationPolicy(),
  );
}

function automationProfile(): EntryPreferenceProfile {
  return {revision: 1, enabled: true, rules: Object.freeze([])};
}

function automationPolicy(): EntryAutomationPolicy {
  return {
    revision: 1,
    enabled: true,
    paused: false,
    profileRevision: 1,
    minimumMatchedRuleCount: 1,
    advanceThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
    deferThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
    budgets: {
      maximumEntriesPerRun: 10,
      maximumAdvanceCandidatesPerRun: 5,
      maximumDeferCandidatesPerRun: 5,
    },
    failureMode: 'pause',
  };
}

function memoryProcessingRuns(): ProcessingRunRepositoryPort {
  const runs = new Map<string, ProcessingRun>();
  return {
    listRecentRuns: (_workspaceId, limit) =>
      Promise.resolve(Object.freeze([...runs.values()].slice(-limit))),
    createRun: (create) => {
      if (runs.has(create.runId)) return Promise.resolve('unchanged');
      runs.set(create.runId, {
        workspaceId: create.workspaceId,
        runId: create.runId,
        idempotencyKey: create.idempotencyKey,
        origin: create.origin,
        status: 'queued',
        privacyScope: create.privacyScope,
        currentStage: create.initialStage,
        ...(create.initialStep === undefined
          ? {}
          : {currentStep: create.initialStep}),
        completedUnits: 0,
        attempt: 1,
        version: 1,
        createdAt: '2026-08-25T08:00:00.000Z',
        updatedAt: '2026-08-25T08:00:00.000Z',
        proposals: Object.freeze([]),
      });
      return Promise.resolve('applied');
    },
    writeProgress: (write) => {
      const current = runs.get(write.runId);
      if (current === undefined) return Promise.resolve('not_found');
      if (current.version !== write.expectedVersion) {
        return Promise.resolve('stale');
      }
      runs.set(write.runId, {
        ...current,
        status: write.status,
        currentStage: write.currentStage,
        ...(write.currentStep === undefined
          ? {}
          : {currentStep: write.currentStep}),
        completedUnits: write.completedUnits,
        ...(write.totalUnits === undefined
          ? {}
          : {totalUnits: write.totalUnits}),
        ...(write.errorCode === undefined ? {} : {errorCode: write.errorCode}),
        version: current.version + 1,
        ...(write.status === 'running' && current.startedAt === undefined
          ? {startedAt: '2026-08-25T08:00:00.000Z'}
          : {}),
        ...(write.status === 'succeeded' || write.status === 'failed'
          ? {finishedAt: '2026-08-25T08:00:00.000Z'}
          : {}),
        updatedAt: '2026-08-25T08:00:00.000Z',
      });
      return Promise.resolve('applied');
    },
    cancelRun: () => Promise.resolve('not_found'),
    appendProposal: () => Promise.resolve('not_found'),
  };
}

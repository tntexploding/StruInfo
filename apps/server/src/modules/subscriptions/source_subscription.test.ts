import {describe, expect, it, vi} from 'vitest';

import type {ImportMarkdownEvidenceResult} from '../evidence/index.js';
import type {
  ProcessingRun,
  ProcessingRunRepositoryPort,
} from '../processing/index.js';
import {
  createReviewPreferences,
  type ReviewPreferences,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
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
        intervalMinutes: 1_440,
      },
    ]);
    expect(replaced.outcome).toBe('applied');
    expect(replaced.value.subscriptions[0]?.repositoryUri).toBe(
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
});

function memoryPreferences(): ReviewPreferencesStore {
  let current: Readonly<ReviewPreferences> = createReviewPreferences(
    WORKSPACE_ID,
    [],
  );
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
    ) => {
      current = createReviewPreferences(
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        associationPolicy,
        explorationPolicy,
        sourceSubscriptions,
      );
      return Promise.resolve(current);
    },
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

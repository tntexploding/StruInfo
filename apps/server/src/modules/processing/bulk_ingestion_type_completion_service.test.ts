import {describe, expect, it, vi} from 'vitest';

import {
  ENTRY_CLASSIFICATION_PROFILE_FORMAT,
  ENTRY_CLASSIFICATION_PROFILE_VERSION,
  type CurrentInformationEntry,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  REVIEW_PREFERENCES_FORMAT,
  REVIEW_PREFERENCES_VERSION,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import type {BulkIngestionAdjudicationException} from './bulk_ingestion_adjudication_contract.js';
import type {
  BulkIngestionEnrichmentBatch,
  BulkIngestionEnrichmentStatus,
} from './bulk_ingestion_enrichment_contract.js';
import {BulkIngestionTypeCompletionService} from './bulk_ingestion_type_completion_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';

describe('BulkIngestionTypeCompletionService', () => {
  it('previews only current pending missing types with stable redacted samples', async () => {
    const assignable = entry(1, {
      title: '年度统计数据集',
      body: '这份资料汇总包含可复核的统计数据。',
    });
    const unresolved = entry(2, {
      title: '一则短消息',
      body: '今天记录了一件事情。',
    });
    const classified = entry(3, {
      title: '已有类型',
      body: '不应重新分类。',
      typeKeyword: 'argument',
    });
    const staleEntry = entry(4, {title: '过期', body: '过期内容'});
    const privateEntry = entry(5, {
      title: 'PrivateTool 开源工具',
      body: '私密工具：https://example.test/private',
      isPrivate: true,
    });
    const exceptions = [
      exception(assignable),
      exception(unresolved, 'classification_no_signal'),
      exception(classified),
      exception(staleEntry, 'classification_tied', {
        currentEntryRevision: 2,
      }),
      exception(privateEntry),
      exception(entry(6, {title: '人工保留', body: '人工决定'}), undefined, {
        status: 'manual_review',
      }),
      exception(entry(7, {title: '旧异常', body: '旧版本'}), undefined, {
        isCurrent: false,
      }),
    ];
    const loadCurrentEntries = vi.fn(() => Promise.resolve([]));
    const loadCurrentEntriesByIds = vi.fn(() =>
      Promise.resolve([assignable, unresolved, classified, staleEntry]),
    );
    const service = createService({
      entries: {loadCurrentEntries, loadCurrentEntriesByIds},
      exceptions,
      profileRevision: 9,
    });

    const preview = await service.preview({
      batchId: BATCH_ID,
      privacyScope: 'public_only',
      sampleLimit: 20,
    });

    expect(loadCurrentEntries).toHaveBeenCalledWith(WORKSPACE_ID, false);
    expect(loadCurrentEntriesByIds).toHaveBeenCalledWith(
      WORKSPACE_ID,
      false,
      expect.arrayContaining([
        assignable.entryId,
        unresolved.entryId,
        classified.entryId,
        staleEntry.entryId,
      ]),
    );
    expect(preview).toMatchObject({
      profileRevision: 9,
      candidateExceptionCount: 4,
      staleExceptionCount: 1,
      protectedDecisionCount: 1,
      scopeExcludedCount: 1,
      staleEntryCount: 1,
      alreadyClassifiedCount: 1,
      missingTypeCount: 2,
      assignableCount: 1,
      unresolvedCount: 1,
      nextAction: 'apply_type_completion',
    });
    expect(
      preview.byPredictedType.find(
        (candidate) => candidate.typeKeyword === 'factual_material',
      )?.count,
    ).toBe(1);
    expect(
      preview.byReason.find((candidate) => candidate.reason === 'no_signal')
        ?.count,
    ).toBe(1);
    expect(JSON.stringify(preview)).not.toContain(assignable.value.body);
    expect(preview.samples.map((sample) => sample.sampleRank)).toEqual([1, 2]);
  });

  it.each([
    ['planned', 'run'],
    ['paused', 'resume'],
    ['running', 'retry'],
    ['failed', 'retry'],
    ['succeeded', 'refresh'],
  ] as const)(
    'uses the recoverable %s enrichment mode instead of a second writer',
    async (status, expectedMode) => {
      let current = entry(10, {
        title: '数据库统计资料汇总',
        body: '这份数据集包含可复核的统计数据。',
      });
      const execute = vi.fn(() => {
        current = entry(10, {
          title: current.value.titlePath,
          body: current.value.body,
          typeKeyword: 'factual_material',
          revision: 2,
        });
        return Promise.resolve({
          outcome: 'succeeded' as const,
          batch: enrichmentBatch('succeeded'),
          rulesSha256: 'a'.repeat(64),
        });
      });
      const service = createService({
        entries: {
          loadCurrentEntries: () => Promise.resolve([current]),
          loadCurrentEntriesByIds: () => Promise.resolve([current]),
        },
        exceptions: [exception(current)],
        enrichmentStatus: status,
        execute,
      });

      const result = await service.apply({
        batchId: BATCH_ID,
        maxItems: 100,
        sampleLimit: 5,
      });

      expect(execute).toHaveBeenCalledWith({
        batchId: BATCH_ID,
        mode: expectedMode,
        maxItems: 100,
      });
      expect(result).toMatchObject({
        outcome: 'succeeded',
        enrichmentMode: expectedMode,
        enrichmentStatus: 'succeeded',
        nextAction: 'none',
      });
      expect(result.before.assignableCount).toBe(1);
      expect(result.after.assignableCount).toBe(0);
      expect(result.after.staleEntryCount).toBe(1);
    },
  );

  it('leaves unresolved items unchanged and directs them to Codex review', async () => {
    const unresolved = entry(20, {
      title: '短消息',
      body: '没有足够的体裁信号。',
    });
    const execute = vi.fn();
    const service = createService({
      entries: {
        loadCurrentEntries: () => Promise.resolve([unresolved]),
        loadCurrentEntriesByIds: () => Promise.resolve([unresolved]),
      },
      exceptions: [exception(unresolved, 'classification_no_signal')],
      enrichmentStatus: 'succeeded',
      execute,
    });

    const result = await service.apply({
      batchId: BATCH_ID,
      maxItems: 100,
      sampleLimit: 5,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'unchanged',
      nextAction: 'export_codex_review',
    });
  });

  it('rejects invalid request bounds before reading state', async () => {
    const service = createService({entries: memoryEntries([]), exceptions: []});

    await expect(
      service.preview({
        batchId: BATCH_ID,
        privacyScope: 'public_only',
        sampleLimit: 51,
      }),
    ).rejects.toMatchObject({code: 'input_invalid'});
  });
});

function createService(input: {
  entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntries' | 'loadCurrentEntriesByIds'
  >;
  exceptions: readonly Readonly<BulkIngestionAdjudicationException>[];
  profileRevision?: number;
  enrichmentStatus?: BulkIngestionEnrichmentStatus;
  execute?: (input: unknown) => Promise<unknown>;
}): BulkIngestionTypeCompletionService {
  const preferences: ReviewPreferencesStore = {
    load: () =>
      Promise.resolve({
        format: REVIEW_PREFERENCES_FORMAT,
        version: REVIEW_PREFERENCES_VERSION,
        workspaceId: WORKSPACE_ID,
        quickTags: [],
        entryClassificationProfile: {
          format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
          version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
          revision: input.profileRevision ?? 0,
          aliases: [],
          typeMappings: [],
          domainMappings: [],
          exclusions: [],
        },
      }),
    save: () => Promise.reject(new Error('unexpected write')),
  };
  return new BulkIngestionTypeCompletionService({
    workspaceId: WORKSPACE_ID,
    entries: input.entries,
    adjudication: {
      loadExceptions: () => Promise.resolve(input.exceptions),
    },
    enrichment: {
      load: () =>
        Promise.resolve(enrichmentBatch(input.enrichmentStatus ?? 'succeeded')),
      execute: (input.execute ??
        (() =>
          Promise.resolve({
            outcome: 'succeeded',
            batch: enrichmentBatch('succeeded'),
            rulesSha256: 'a'.repeat(64),
          }))) as never,
    },
    preferences,
  });
}

function memoryEntries(
  values: readonly Readonly<CurrentInformationEntry>[],
): Pick<
  InformationEntryRepositoryPort,
  'loadCurrentEntries' | 'loadCurrentEntriesByIds'
> {
  return {
    loadCurrentEntries: () => Promise.resolve(values),
    loadCurrentEntriesByIds: (_workspaceId, _includePrivate, entryIds) =>
      Promise.resolve(
        values.filter((entry) => entryIds.includes(entry.entryId)),
      ),
  };
}

function entry(
  ordinal: number,
  input: Readonly<{
    title: string;
    body: string;
    typeKeyword?: CurrentInformationEntry['value']['typeKeyword'];
    isPrivate?: boolean;
    revision?: number;
  }>,
): Readonly<CurrentInformationEntry> {
  const id = ordinal.toString(16).padStart(12, '0');
  const revision = input.revision ?? 1;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: `10000000-0000-4000-8000-${id}`,
    resourceId: `20000000-0000-4000-8000-${id}`,
    snapshotId: `30000000-0000-4000-8000-${id}`,
    revision,
    revisionId: `40000000-0000-4000-8000-${revision.toString(16).padStart(12, '0')}`,
    sourceKey: `synthetic-${ordinal.toString()}`,
    capturedAt: '2026-09-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal,
      titlePath: input.title,
      body: input.body,
      bodySha256: 'b'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic',
      isPrivate: input.isPrivate ?? false,
      ...(input.typeKeyword === undefined
        ? {}
        : {typeKeyword: input.typeKeyword}),
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([`50000000-0000-4000-8000-${id}`]),
    }),
  });
}

function exception(
  value: Readonly<CurrentInformationEntry>,
  exceptionCode: BulkIngestionAdjudicationException['exceptionCode'] = 'classification_type_missing',
  override: Partial<BulkIngestionAdjudicationException> = {},
): Readonly<BulkIngestionAdjudicationException> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    ordinal: value.value.documentOrder,
    snapshotId: value.snapshotId,
    isPrivate: value.value.isPrivate,
    entryId: value.entryId,
    entryRevision: value.revision,
    entryRevisionId: value.revisionId,
    currentEntryRevision: value.revision,
    currentEntryRevisionId: value.revisionId,
    isCurrent: true,
    exceptionCode,
    status: 'pending',
    version: 1,
    ...override,
  });
}

function enrichmentBatch(
  status: BulkIngestionEnrichmentStatus,
): Readonly<BulkIngestionEnrichmentBatch> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    privacyScope: 'public_only',
    status,
    attempt: 1,
    snapshotCount: 1,
    plannedEntryCount: 1,
    succeededSnapshotCount: status === 'succeeded' ? 1 : 0,
    succeededEntryCount: status === 'succeeded' ? 1 : 0,
    revisedEntryCount: 0,
    addedTagCount: 0,
    associationProjectionCount: 0,
    exceptionEntryCount: 1,
    failedSnapshotCount: status === 'failed' ? 1 : 0,
    pendingSnapshotCount: status === 'planned' ? 1 : 0,
    runningSnapshotCount: status === 'running' ? 1 : 0,
    items: Object.freeze([]),
  });
}

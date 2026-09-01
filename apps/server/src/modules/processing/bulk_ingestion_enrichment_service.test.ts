import {describe, expect, it} from 'vitest';

import {
  createReviewPreferences,
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import type {
  CurrentInformationEntry,
  EntryClassificationProfile,
  InformationEntryAssociationProjection,
  InformationEntryBulkRevisionRepositoryPort,
  InformationEntryRepositoryPort,
  InformationEntryRevisionWrite,
} from '../entries/index.js';
import {DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION} from '../entries/index.js';
import type {
  BulkIngestionEnrichmentBatch,
  BulkIngestionEnrichmentItem,
  BulkIngestionEnrichmentRepositoryPort,
} from './bulk_ingestion_enrichment_contract.js';
import {BulkIngestionEnrichmentService} from './bulk_ingestion_enrichment_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('M2-P0B bulk ingestion enrichment', () => {
  it('adds deterministic tags per Snapshot and replaces only new-entry associations', async () => {
    const repository = new MemoryEnrichmentRepository();
    const entries = new MemoryEntries([
      entry(
        '44444444-4444-4444-8444-444444444444',
        SNAPSHOT_ID,
        'TypeScript 配置指南\nUse **TypeScript** with `Vitest`.',
        [keyword('TypeScript')],
      ),
      entry(
        '55555555-5555-4555-8555-555555555555',
        '66666666-6666-4666-8666-666666666666',
        'Existing TypeScript reference',
        [keyword('TypeScript')],
      ),
    ]);
    const associations = new MemoryAssociations();
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations,
      preferences: preferences(true),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.outcome).toBe('succeeded');
    expect(result.rulesSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.batch).toMatchObject({
      succeededSnapshotCount: 1,
      succeededEntryCount: 1,
      revisedEntryCount: 1,
      exceptionEntryCount: 0,
    });
    expect(result.batch.addedTagCount).toBeGreaterThan(0);
    expect(entries.values[0]?.value.contentKeywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: 'vitest',
          origin: 'rule',
        }),
      ]),
    );
    expect(entries.values[0]?.value.typeKeyword).toBe('operating_guideline');
    expect(entries.values[0]?.value.domains).toEqual([
      expect.objectContaining({
        keyword: 'engineering_computing',
        origin: 'rule',
      }),
    ]);
    expect(associations.sourceEntryIds).toEqual([
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(associations.projections).toHaveLength(1);
    expect(associations.projections[0]).toMatchObject({
      entryLowId: '44444444-4444-4444-8444-444444444444',
      entryHighId: '55555555-5555-4555-8555-555555555555',
    });
  });

  it('records a bounded exception instead of pretending disabled rules produced tags', async () => {
    const repository = new MemoryEnrichmentRepository();
    const entries = new MemoryEntries([
      entry(
        '44444444-4444-4444-8444-444444444444',
        SNAPSHOT_ID,
        'TypeScript tool\nUse **TypeScript** with `Vitest`.',
      ),
    ]);
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations: new MemoryAssociations(),
      preferences: preferences(false),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.outcome).toBe('succeeded');
    expect(result.batch.revisedEntryCount).toBe(0);
    expect(result.batch.addedTagCount).toBe(0);
    expect(result.batch.exceptionEntryCount).toBe(1);
    expect(result.batch.items[0]?.exceptions).toEqual([
      expect.objectContaining({
        entryId: '44444444-4444-4444-8444-444444444444',
        code: 'automatic_tagging_disabled',
      }),
    ]);
  });

  it('routes ambiguous missing classification to review without overwriting existing annotations', async () => {
    const repository = new MemoryEnrichmentRepository();
    const current = entry(
      '44444444-4444-4444-8444-444444444444',
      SNAPSHOT_ID,
      '一则短消息\n今天记录了一件事情。',
      [keyword('记录')],
    );
    const entries = new MemoryEntries([current]);
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations: new MemoryAssociations(),
      preferences: preferences(false),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.batch.items[0]?.exceptions).toEqual([
      expect.objectContaining({code: 'classification_no_signal'}),
    ]);
    expect(entries.values[0]?.value.typeKeyword).toBeUndefined();
    expect(entries.values[0]?.value.domains).toEqual([]);
    expect(entries.values[0]?.revision).toBe(current.revision);
    expect(result.batch.revisedEntryCount).toBe(0);
  });

  it.each([
    {
      label: 'missing domain',
      keywords: ['教程'],
      code: 'classification_domain_missing',
      revisedEntryCount: 1,
    },
    {
      label: 'missing type',
      keywords: ['Docker'],
      code: 'classification_type_missing',
      revisedEntryCount: 1,
    },
    {
      label: 'tied evidence',
      keywords: ['医学健康', '软件数据库'],
      code: 'classification_tied',
      revisedEntryCount: 0,
    },
  ] as const)(
    'records the refined diagnostic for $label',
    async ({keywords, code, revisedEntryCount}) => {
      const repository = new MemoryEnrichmentRepository();
      const entries = new MemoryEntries([
        entry(
          '44444444-4444-4444-8444-444444444444',
          SNAPSHOT_ID,
          'Synthetic body.',
          keywords.map(keyword),
        ),
      ]);
      const service = new BulkIngestionEnrichmentService({
        workspaceId: WORKSPACE_ID,
        repository,
        entries,
        associations: new MemoryAssociations(),
        preferences: preferences(false),
      });

      const result = await service.execute({
        batchId: BATCH_ID,
        mode: 'run',
        maxItems: 1,
      });

      expect(result.batch.items[0]?.exceptions).toEqual([
        expect.objectContaining({code}),
      ]);
      expect(result.batch.revisedEntryCount).toBe(revisedEntryCount);
    },
  );

  it('preserves existing manual type and domain when deterministic rules disagree', async () => {
    const repository = new MemoryEnrichmentRepository();
    const base = entry(
      '44444444-4444-4444-8444-444444444444',
      SNAPSHOT_ID,
      'Docker 配置指南\n这是一份软件开发教程。',
      [keyword('Docker')],
    );
    const entries = new MemoryEntries([
      Object.freeze({
        ...base,
        value: Object.freeze({
          ...base.value,
          typeKeyword: 'argument' as const,
          domains: Object.freeze([
            Object.freeze({
              keyword: 'culture_arts' as const,
              origin: 'manual' as const,
              originVersion: 'synthetic.manual.v1',
            }),
          ]),
        }),
      }),
    ]);
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations: new MemoryAssociations(),
      preferences: preferences(true),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.batch.exceptionEntryCount).toBe(0);
    expect(entries.values[0]?.value.typeKeyword).toBe('argument');
    expect(entries.values[0]?.value.domains).toEqual([
      expect.objectContaining({keyword: 'culture_arts', origin: 'manual'}),
    ]);
  });

  it('applies the external classification profile through the batch service', async () => {
    const repository = new MemoryEnrichmentRepository();
    const entries = new MemoryEntries([
      entry(
        '44444444-4444-4444-8444-444444444444',
        SNAPSHOT_ID,
        'Synthetic material with no built-in classification signal.',
        [keyword('owner-term')],
      ),
    ]);
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations: new MemoryAssociations(),
      preferences: preferences(
        false,
        Object.freeze({
          format: 'struinfo.entry-classification-profile',
          version: 1,
          revision: 4,
          aliases: Object.freeze([]),
          typeMappings: Object.freeze([
            Object.freeze({
              term: 'owner-term',
              keyword: 'investigation_analysis',
            }),
          ]),
          domainMappings: Object.freeze([
            Object.freeze({
              term: 'owner-term',
              keyword: 'humanities_history',
            }),
          ]),
          exclusions: Object.freeze([]),
        }),
      ),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.batch.exceptionEntryCount).toBe(0);
    expect(entries.values[0]?.value.typeKeyword).toBe('investigation_analysis');
    expect(entries.values[0]?.value.domains).toHaveLength(1);
    expect(entries.values[0]?.value.domains[0]).toMatchObject({
      keyword: 'humanities_history',
      origin: 'rule',
    });
    expect(entries.values[0]?.value.domains[0]?.originVersion).toContain(
      `${DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION}:m2-p2:`,
    );
  });

  it('uses bounded labelled-neighbor consensus through the existing atomic writer', async () => {
    const repository = new MemoryEnrichmentRepository();
    const candidate = entry(
      '44444444-4444-4444-8444-444444444444',
      SNAPSHOT_ID,
      'Synthetic body without a built-in genre signal.',
      [keyword('shared-alpha'), keyword('shared-beta')],
    );
    const references = [
      classifiedReference(
        '55555555-5555-4555-8555-555555555551',
        '66666666-6666-4666-8666-666666666661',
      ),
      classifiedReference(
        '55555555-5555-4555-8555-555555555552',
        '66666666-6666-4666-8666-666666666662',
      ),
      classifiedReference(
        '55555555-5555-4555-8555-555555555553',
        '66666666-6666-4666-8666-666666666663',
      ),
      classifiedReference(
        '55555555-5555-4555-8555-555555555554',
        '66666666-6666-4666-8666-666666666664',
      ),
    ];
    const entries = new MemoryEntries([candidate, ...references]);
    const service = new BulkIngestionEnrichmentService({
      workspaceId: WORKSPACE_ID,
      repository,
      entries,
      associations: new MemoryAssociations(),
      preferences: preferences(false),
    });

    const result = await service.execute({
      batchId: BATCH_ID,
      mode: 'run',
      maxItems: 1,
    });

    expect(result.batch.exceptionEntryCount).toBe(0);
    expect(entries.values[0]?.value.typeKeyword).toBe('operating_guideline');
    expect(entries.values[0]?.value.domains).toEqual([
      expect.objectContaining({
        keyword: 'engineering_computing',
        origin: 'rule',
      }),
    ]);
    expect(entries.values[0]?.revision).toBe(2);
  });
});

class MemoryEnrichmentRepository implements BulkIngestionEnrichmentRepositoryPort {
  public item: BulkIngestionEnrichmentItem = Object.freeze({
    workspaceId: WORKSPACE_ID,
    batchId: BATCH_ID,
    ordinal: 0,
    snapshotId: SNAPSHOT_ID,
    isPrivate: false,
    plannedEntryCount: 1,
    status: 'pending',
    attempt: 0,
    version: 1,
    exceptions: Object.freeze([]),
  });

  public ensureItems(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public loadBatch(): Promise<Readonly<BulkIngestionEnrichmentBatch>> {
    const succeeded = this.item.status === 'succeeded';
    const failed = this.item.status === 'failed';
    const running = this.item.status === 'running';
    return Promise.resolve(
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        batchId: BATCH_ID,
        privacyScope: 'public_only' as const,
        status: succeeded
          ? ('succeeded' as const)
          : failed
            ? ('failed' as const)
            : running
              ? ('running' as const)
              : this.item.attempt === 0
                ? ('planned' as const)
                : ('paused' as const),
        attempt: this.item.attempt,
        snapshotCount: 1,
        plannedEntryCount: 1,
        succeededSnapshotCount: succeeded ? 1 : 0,
        succeededEntryCount: this.item.resultEntryCount ?? 0,
        revisedEntryCount: this.item.revisedEntryCount ?? 0,
        addedTagCount: this.item.addedTagCount ?? 0,
        associationProjectionCount: this.item.associationProjectionCount ?? 0,
        exceptionEntryCount: this.item.exceptionEntryCount ?? 0,
        failedSnapshotCount: failed ? 1 : 0,
        pendingSnapshotCount: this.item.status === 'pending' ? 1 : 0,
        runningSnapshotCount: running ? 1 : 0,
        items: Object.freeze([this.item]),
      }),
    );
  }

  public beginAttempt(): Promise<'started'> {
    return Promise.resolve('started');
  }

  public claimItems(
    _workspaceId: string,
    _batchId: string,
    runId: string,
    _maximumItems: number,
    rulesSha256: string,
  ): Promise<readonly Readonly<BulkIngestionEnrichmentItem>[]> {
    this.item = Object.freeze({
      ...this.item,
      status: 'running',
      attempt: this.item.attempt + 1,
      claimedRunId: runId,
      rulesSha256,
      version: this.item.version + 1,
    });
    return Promise.resolve(Object.freeze([this.item]));
  }

  public settleItem(
    input: Parameters<BulkIngestionEnrichmentRepositoryPort['settleItem']>[0],
  ): Promise<'applied'> {
    this.item = Object.freeze({
      ...this.item,
      status: input.status,
      ...(input.resultEntryCount === undefined
        ? {}
        : {resultEntryCount: input.resultEntryCount}),
      ...(input.revisedEntryCount === undefined
        ? {}
        : {revisedEntryCount: input.revisedEntryCount}),
      ...(input.addedTagCount === undefined
        ? {}
        : {addedTagCount: input.addedTagCount}),
      ...(input.associationProjectionCount === undefined
        ? {}
        : {associationProjectionCount: input.associationProjectionCount}),
      ...(input.exceptionEntryCount === undefined
        ? {}
        : {exceptionEntryCount: input.exceptionEntryCount}),
      ...(input.errorCode === undefined ? {} : {errorCode: input.errorCode}),
      exceptions: Object.freeze([...input.exceptions]),
      version: this.item.version + 1,
    });
    return Promise.resolve('applied');
  }

  public finishAttempt(): Promise<'applied'> {
    return Promise.resolve('applied');
  }
}

class MemoryEntries
  implements
    InformationEntryRepositoryPort,
    InformationEntryBulkRevisionRepositoryPort
{
  public values: CurrentInformationEntry[];

  public constructor(values: CurrentInformationEntry[]) {
    this.values = values;
  }

  public materializeEntries(): Promise<
    Readonly<{outcome: 'existing'; createdCount: 0}>
  > {
    return Promise.resolve(
      Object.freeze({outcome: 'existing', createdCount: 0}),
    );
  }

  public reviseEntry(): Promise<'unchanged'> {
    return Promise.resolve('unchanged');
  }

  public loadCurrentEntries(): Promise<
    readonly Readonly<CurrentInformationEntry>[]
  > {
    return Promise.resolve(Object.freeze([...this.values]));
  }

  public reviseEntriesAtomically(
    writes: readonly Readonly<InformationEntryRevisionWrite>[],
  ): Promise<
    Readonly<{outcome: 'applied' | 'unchanged'; appliedCount: number}>
  > {
    let appliedCount = 0;
    for (const write of writes) {
      const index = this.values.findIndex(
        (entry_) => entry_.entryId === write.entryId,
      );
      const current = this.values[index];
      if (current?.revision !== write.expectedRevision) {
        throw new Error('synthetic stale Entry');
      }
      this.values[index] = Object.freeze({
        ...current,
        revision: current.revision + 1,
        revisionId: write.revisionId,
        value: write.value,
      });
      appliedCount += 1;
    }
    return Promise.resolve(
      Object.freeze({
        outcome: appliedCount === 0 ? 'unchanged' : 'applied',
        appliedCount,
      }),
    );
  }
}

class MemoryAssociations {
  public sourceEntryIds: readonly string[] = Object.freeze([]);
  public projections: readonly Readonly<InformationEntryAssociationProjection>[] =
    Object.freeze([]);

  public replaceAssociationProjectionsForEntries(
    _workspaceId: string,
    sourceEntryIds: readonly string[],
    projections: readonly Readonly<InformationEntryAssociationProjection>[],
  ): Promise<number> {
    this.sourceEntryIds = Object.freeze([...sourceEntryIds]);
    this.projections = Object.freeze([...projections]);
    return Promise.resolve(projections.length);
  }
}

function preferences(
  enabled: boolean,
  entryClassificationProfile?: Readonly<EntryClassificationProfile>,
): ReviewPreferencesStore {
  const base = createReviewPreferences(
    WORKSPACE_ID,
    [],
    Object.freeze({
      enabled,
      includeLinkDomains: false,
      excludedKeywords: Object.freeze([]),
    }),
    DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
    DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  );
  const value =
    entryClassificationProfile === undefined
      ? base
      : Object.freeze({...base, entryClassificationProfile});
  return {
    load: () => Promise.resolve(value),
    save: () => Promise.resolve(value),
  };
}

function entry(
  entryId: string,
  snapshotId: string,
  body: string,
  contentKeywords: readonly ReturnType<typeof keyword>[] = Object.freeze([]),
): CurrentInformationEntry {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '77777777-7777-4777-8777-777777777777',
    snapshotId,
    revision: 1,
    revisionId: entryId.replace(/^./u, '8'),
    sourceKey: 'synthetic-source',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic Entry',
      body,
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      contentKeywords: Object.freeze([...contentKeywords]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['99999999-9999-4999-8999-999999999999']),
    }),
  });
}

function keyword(displayValue: string) {
  return Object.freeze({
    displayValue,
    normalizedValue: displayValue.toLowerCase(),
    origin: 'manual' as const,
    originVersion: 'synthetic.manual.v1',
  });
}

function classifiedReference(
  entryId: string,
  snapshotId: string,
): CurrentInformationEntry {
  const base = entry(entryId, snapshotId, 'Synthetic labelled reference.', [
    keyword('shared-alpha'),
    keyword('shared-beta'),
  ]);
  return Object.freeze({
    ...base,
    value: Object.freeze({
      ...base.value,
      typeKeyword: 'operating_guideline' as const,
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'synthetic.manual.v1',
        }),
      ]),
    }),
  });
}

import {describe, expect, it} from 'vitest';

import {
  entryTypeLearningModelsEqual,
  isEntryTypeLearningModelActivationEligible,
  trainEntryTypeLearningModel,
  type CurrentInformationEntry,
} from '../entries/index.js';
import {
  createReviewPreferences,
  type ReviewPreferences,
  type ReviewPreferencesStore,
  type ReviewPreferencesUpdater,
  type ReviewPreferencesUpdateResult,
} from '../../storage/review_preferences_store.js';
import type {
  BulkIngestionCodexReviewFileStorePort,
  BulkIngestionCodexReviewStoredPackage,
} from './bulk_ingestion_codex_review_contract.js';
import {
  ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
  type EntryTypeLearningCodexPacket,
} from './entry_type_learning_codex_contract.js';
import {EntryTypeLearningCodexService} from './entry_type_learning_codex_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';

describe('EntryTypeLearningCodexService', () => {
  it('exports active samples, imports only confirmed labels, and activates an eligible shadow model', async () => {
    const entries = fixtures();
    const preferences = new MemoryPreferences();
    const files = new MemoryFiles();
    const service = new EntryTypeLearningCodexService({
      workspaceId: WORKSPACE_ID,
      entries: {loadCurrentEntries: () => Promise.resolve(entries)},
      preferences,
      fileStore: files,
    });

    const exported = await service.export({
      includePrivate: false,
      limit: entries.length,
    });
    expect(exported.outcome).toBe('created');
    if (exported.outcome === 'empty') throw new Error('packet_expected');
    const packet = JSON.parse(
      new TextDecoder().decode(files.packet),
    ) as EntryTypeLearningCodexPacket;
    expect(packet.items).toHaveLength(entries.length);
    files.result = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
        packetId: packet.packetId,
        packetSha256: packet.packetSha256,
        decisions: packet.items.map((item, index) => ({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          action: 'trust',
          authority: index % 2 === 0 ? 'manual' : 'codex_accepted',
          typeKeyword: typeForTitle(item.titlePath),
        })),
      }),
    );

    const applied = await service.apply(packet.packetId);
    expect(applied.outcome).toBe('applied');
    expect(applied.trustedExampleCount).toBe(entries.length);
    expect(applied.evaluation).toMatchObject({
      activationEligible: true,
      crossValidationFoldCount: 3,
      targetPrecisionBasisPoints: 9_200,
    });
    expect(
      applied.evaluation?.confusionMatrix?.reduce(
        (total, cell) => total + cell.count,
        0,
      ),
    ).toBe(applied.evaluation?.validationCount);
    expect(applied.evaluation?.misclassifications).toEqual([]);
    expect(
      new Set(
        preferences.current.entryClassificationProfile?.typeLearning?.trustedExamples.map(
          (example) => example.authority,
        ),
      ),
    ).toEqual(new Set(['manual', 'codex_accepted']));
    const storedState =
      preferences.current.entryClassificationProfile?.typeLearning;
    const refreshed = trainEntryTypeLearningModel(
      storedState?.trustedExamples ?? [],
      entries,
      {includePrivate: false},
    );
    expect(
      isEntryTypeLearningModelActivationEligible(storedState?.candidateModel),
    ).toBe(true);
    expect(isEntryTypeLearningModelActivationEligible(refreshed)).toBe(true);
    expect(storedState?.candidateModel?.trainingDigest).toBe(
      refreshed?.trainingDigest,
    );
    expect(storedState?.candidateModel?.classes).toStrictEqual(
      refreshed?.classes,
    );
    expect(storedState?.candidateModel?.evaluation).toStrictEqual(
      refreshed?.evaluation,
    );
    expect(
      entryTypeLearningModelsEqual(storedState?.candidateModel, refreshed),
    ).toBe(true);

    const activated = await service.activate(applied.profileRevision);
    expect(activated.outcome).toBe('activated');
    expect(
      preferences.current.entryClassificationProfile?.typeLearning?.activeModel
        ?.trainingDigest,
    ).toBe(activated.trainingDigest);
  });

  it('refuses activation when the current full-corpus projection has changed', async () => {
    let entries = fixtures();
    const preferences = new MemoryPreferences();
    const files = new MemoryFiles();
    const service = new EntryTypeLearningCodexService({
      workspaceId: WORKSPACE_ID,
      entries: {loadCurrentEntries: () => Promise.resolve(entries)},
      preferences,
      fileStore: files,
    });
    const exported = await service.export({
      includePrivate: false,
      limit: entries.length,
    });
    if (exported.outcome === 'empty') throw new Error('packet_expected');
    const packet = JSON.parse(
      new TextDecoder().decode(files.packet),
    ) as EntryTypeLearningCodexPacket;
    files.result = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
        packetId: packet.packetId,
        packetSha256: packet.packetSha256,
        decisions: packet.items.map((item) => ({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          action: 'trust',
          authority: 'manual',
          typeKeyword: typeForTitle(item.titlePath),
        })),
      }),
    );
    const applied = await service.apply(packet.packetId);
    expect(applied.outcome).toBe('applied');
    expect(applied.evaluation?.activationEligible).toBe(true);

    entries = Object.freeze([
      ...entries,
      entry(99, 0, 'Build cmdline recipe changed', [
        'cmdline-recipe',
        'terminal-workflow',
      ]),
    ]);

    await expect(
      service.activate(applied.profileRevision),
    ).resolves.toMatchObject({
      outcome: 'not_eligible',
    });
    expect(
      preferences.current.entryClassificationProfile?.typeLearning?.activeModel,
    ).toBeUndefined();
  });

  it('keeps the packet bound to the external Profile revision', async () => {
    const entries = fixtures().slice(0, 4);
    const preferences = new MemoryPreferences();
    const files = new MemoryFiles();
    const service = new EntryTypeLearningCodexService({
      workspaceId: WORKSPACE_ID,
      entries: {loadCurrentEntries: () => Promise.resolve(entries)},
      preferences,
      fileStore: files,
    });
    const exported = await service.export({
      includePrivate: false,
      limit: entries.length,
    });
    if (exported.outcome === 'empty') throw new Error('packet_expected');
    const packet = JSON.parse(
      new TextDecoder().decode(files.packet),
    ) as EntryTypeLearningCodexPacket;
    const currentProfile = preferences.current.entryClassificationProfile;
    if (currentProfile === undefined) throw new Error('profile_expected');
    await preferences.save(
      WORKSPACE_ID,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...currentProfile,
        revision: 1,
      },
    );
    files.result = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
        packetId: packet.packetId,
        packetSha256: packet.packetSha256,
        decisions: packet.items.map((item) => ({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          action: 'reject',
        })),
      }),
    );

    await expect(service.apply(packet.packetId)).resolves.toMatchObject({
      outcome: 'stale',
      profileRevision: 1,
    });
  });

  it('rejects a valid packet when it is applied to another workspace', async () => {
    const entries = fixtures().slice(0, 4);
    const preferences = new MemoryPreferences();
    const files = new MemoryFiles();
    const source = new EntryTypeLearningCodexService({
      workspaceId: WORKSPACE_ID,
      entries: {loadCurrentEntries: () => Promise.resolve(entries)},
      preferences,
      fileStore: files,
    });
    const exported = await source.export({
      includePrivate: false,
      limit: entries.length,
    });
    if (exported.outcome === 'empty') throw new Error('packet_expected');
    const packet = JSON.parse(
      new TextDecoder().decode(files.packet),
    ) as EntryTypeLearningCodexPacket;
    files.result = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
        packetId: packet.packetId,
        packetSha256: packet.packetSha256,
        decisions: packet.items.map((item) => ({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          action: 'reject',
        })),
      }),
    );
    const otherWorkspace = new EntryTypeLearningCodexService({
      workspaceId: OTHER_WORKSPACE_ID,
      entries: {loadCurrentEntries: () => Promise.resolve(entries)},
      preferences,
      fileStore: files,
    });

    await expect(otherWorkspace.apply(packet.packetId)).rejects.toMatchObject({
      code: 'packet_invalid',
    });
  });
});

class MemoryFiles implements BulkIngestionCodexReviewFileStorePort {
  public packet = new Uint8Array();
  public result = new Uint8Array();

  public writePackage(input: {
    packetId: string;
    packetBytes: Uint8Array;
    resultTemplateBytes: Uint8Array;
  }): Promise<Readonly<BulkIngestionCodexReviewStoredPackage>> {
    this.packet = Uint8Array.from(input.packetBytes);
    this.result = Uint8Array.from(input.resultTemplateBytes);
    return Promise.resolve(
      Object.freeze({
        outcome: 'created',
        packetFileName: input.packetId + '.codex-review.json',
        resultFileName: input.packetId + '.codex-result.json',
        packetByteLength: input.packetBytes.byteLength,
        packetFileSha256: '0'.repeat(64),
      }),
    );
  }

  public readPacket(): Promise<Uint8Array> {
    return Promise.resolve(Uint8Array.from(this.packet));
  }

  public readResult(): Promise<Uint8Array> {
    return Promise.resolve(Uint8Array.from(this.result));
  }
}

class MemoryPreferences implements ReviewPreferencesStore {
  public current: Readonly<ReviewPreferences> = createReviewPreferences(
    WORKSPACE_ID,
    [],
  );

  public load(): Promise<Readonly<ReviewPreferences>> {
    return Promise.resolve(this.current);
  }

  public save(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords?: Parameters<typeof createReviewPreferences>[2],
    vocabulary?: Parameters<typeof createReviewPreferences>[3],
    associationPolicy?: Parameters<typeof createReviewPreferences>[4],
    explorationPolicy?: Parameters<typeof createReviewPreferences>[5],
    sourceSubscriptions?: Parameters<typeof createReviewPreferences>[6],
    entryPreferenceProfile?: Parameters<typeof createReviewPreferences>[7],
    entryAutomationPolicy?: Parameters<typeof createReviewPreferences>[8],
    entrySplitRuleProfile?: Parameters<typeof createReviewPreferences>[9],
    entryClassificationProfile?: Parameters<typeof createReviewPreferences>[10],
  ): Promise<Readonly<ReviewPreferences>> {
    this.current = createReviewPreferences(
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
    );
    return Promise.resolve(this.current);
  }

  public update<T>(
    _workspaceId: string,
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<Readonly<ReviewPreferencesUpdateResult<T>>> {
    const update = updater(this.current);
    this.current = update.next;
    return Promise.resolve({
      preferences: this.current,
      result: update.result,
    });
  }
}

function fixtures(): readonly Readonly<CurrentInformationEntry>[] {
  return Object.freeze(
    Array.from({length: 10}, (_, snapshot) =>
      TYPE_CASES.map((item, order) =>
        entry(snapshot + 1, order, item.title, item.keywords),
      ),
    ).flat(),
  );
}

const TYPE_CASES = [
  Object.freeze({
    typeKeyword: 'operating_guideline' as const,
    title: 'Build cmdline recipe',
    keywords: Object.freeze(['cmdline-recipe', 'terminal-workflow']),
  }),
  Object.freeze({
    typeKeyword: 'investigation_analysis' as const,
    title: 'Measure evidence corpus',
    keywords: Object.freeze(['evidence-corpus', 'measurement-result']),
  }),
  Object.freeze({
    typeKeyword: 'personal_experience' as const,
    title: 'My migration diary',
    keywords: Object.freeze(['migration-diary', 'lessons-learned']),
  }),
  Object.freeze({
    typeKeyword: 'literary_creation' as const,
    title: 'Poem from moon garden',
    keywords: Object.freeze(['poetry', 'fiction-writing']),
  }),
] as const;

function typeForTitle(title: string) {
  const matched = TYPE_CASES.find((item) => title.startsWith(item.title));
  if (matched === undefined) throw new Error('type_fixture_missing');
  return matched.typeKeyword;
}

function entry(
  snapshot: number,
  order: number,
  titlePath: string,
  contentKeywords: readonly string[],
): Readonly<CurrentInformationEntry> {
  const suffix = (snapshot * 100 + order + 1).toString(16).padStart(12, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: '00000000-0000-4000-8000-' + suffix,
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId:
      '00000000-0000-4000-8000-' + snapshot.toString(16).padStart(12, '0'),
    revision: 1,
    revisionId: '33333333-3333-4333-8333-' + suffix,
    sourceKey: 'synthetic-source',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: order,
      titlePath,
      body: titlePath + ' body',
      bodySha256: '0'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      contentKeywords: Object.freeze(
        contentKeywords.map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword,
            origin: 'manual' as const,
            originVersion: 'synthetic',
          }),
        ),
      ),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([]),
    }),
  });
}

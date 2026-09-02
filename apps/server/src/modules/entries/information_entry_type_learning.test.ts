import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
} from './information_entry_deterministic_classification.js';
import {
  cloneEntryTypeLearningState,
  decodeEntryTypeLearningState,
  isEntryTypeLearningModelActivationEligible,
  predictEntryType,
  selectEntryTypeLearningCandidates,
  trainEntryTypeLearningModel,
  type EntryTypeTrustedExample,
  type LearnedEntryTypeKeyword,
} from './information_entry_type_learning.js';

describe('Entry type learning', () => {
  it('trains an explainable snapshot-separated candidate and predicts from bounded features', () => {
    const entries = fixtures();
    const examples = entries.map((entry) =>
      trusted(entry, typeForTitle(entry.value.titlePath)),
    );

    const model = trainEntryTypeLearningModel(examples, entries);

    expect(model).toBeDefined();
    expect(model?.evaluation.validationCount).toBeGreaterThanOrEqual(8);
    expect(model?.evaluation.precisionBasisPoints).toBe(10_000);
    expect(model?.evaluation.supportedClassCount).toBe(4);
    expect(model?.evaluation.projection).toMatchObject({
      populationCount: 40,
      assignedCount: 40,
      assignedClassCount: 4,
      maximumClassShareBasisPoints: 2_500,
    });
    expect(model?.evaluation.activationEligible).toBe(true);
    expect(isEntryTypeLearningModelActivationEligible(model)).toBe(true);
    const prediction = predictEntryType(
      entry(90, 0, 'Build cmdline recipe', ['cmdline-recipe']),
      model,
    );
    expect(prediction?.keyword).toBe('operating_guideline');
    expect(prediction?.matchedFeatures.length).toBeGreaterThan(0);
  });

  it('fills class support deficits before the stable missing-entry stream', () => {
    const typed = ALL_LEARNED_TYPES.map((typeKeyword, index) =>
      entry(
        index + 1,
        0,
        `Existing ${typeKeyword}`,
        [`seed-${typeKeyword}`],
        typeKeyword,
      ),
    );
    const entries = [
      ...typed,
      entry(20, 0, 'Missing one', ['alpha']),
      entry(21, 0, 'Missing two', ['beta']),
      entry(22, 0, 'Private', ['epsilon'], undefined, true),
    ];
    const state = cloneEntryTypeLearningState({trustedExamples: []});

    const publicCandidates = selectEntryTypeLearningCandidates(entries, state, {
      includePrivate: false,
      limit: ALL_LEARNED_TYPES.length,
    });

    expect(publicCandidates.map((item) => item.entry.entryId)).not.toContain(
      entries.at(-1)?.entryId,
    );
    expect(
      new Set(publicCandidates.map((item) => item.targetTypeKeyword)),
    ).toEqual(new Set(ALL_LEARNED_TYPES));
    expect(
      new Set(publicCandidates.map((item) => item.entry.snapshotId)).size,
    ).toBe(ALL_LEARNED_TYPES.length);
    expect(
      publicCandidates.every(
        (item) => item.reason === 'untrusted_existing_type',
      ),
    ).toBe(true);
  });

  it('disables zero and low-support classes instead of learning smoothed phantom weights', () => {
    const entries = Array.from({length: 8}, (_, index) =>
      entry(index + 1, 0, 'Dataset reference material', ['dataset-reference']),
    );
    const examples = entries.map((item) => trusted(item, 'factual_material'));

    const model = trainEntryTypeLearningModel(examples, entries);

    expect(model).toBeDefined();
    expect(model?.evaluation.supportedClassCount).toBe(1);
    expect(model?.evaluation.activationEligible).toBe(false);
    expect(isEntryTypeLearningModelActivationEligible(model)).toBe(false);
    expect(
      model?.classes.find((item) => item.keyword === 'literary_creation'),
    ).toMatchObject({
      minimumScore: 2_000_000,
      minimumMargin: 2_000_000,
      features: [],
    });
  });

  it('rejects a precise shadow model when full-corpus projection is dominated by one class', () => {
    const trainingEntries = fixtures(true);
    const examples = trainingEntries.map((item) =>
      trusted(item, typeForTitle(item.value.titlePath)),
    );
    const projectionCounts = [6_000, 1_334, 1_333, 1_333] as const;
    let snapshot = 100;
    const projectionEntries = TYPE_CASES.flatMap((item, index) => {
      const count = projectionCounts[index];
      if (count === undefined) throw new Error('projection_count_missing');
      return Array.from({length: count}, () =>
        entry(snapshot++, 0, item.title, item.keywords),
      );
    });

    const model = trainEntryTypeLearningModel(examples, [
      ...trainingEntries,
      ...projectionEntries,
    ]);

    expect(model?.evaluation.precisionBasisPoints).toBe(10_000);
    expect(model?.evaluation.projection?.populationCount).toBe(10_000);
    expect(
      model?.evaluation.projection?.maximumClassShareBasisPoints,
    ).toBeGreaterThan(5_000);
    expect(model?.evaluation.activationEligible).toBe(false);
    expect(isEntryTypeLearningModelActivationEligible(model)).toBe(false);
  });

  it('round-trips the closed external learning state and rejects duplicate samples', () => {
    const entries = fixtures();
    const examples = entries.map((item) =>
      trusted(item, typeForTitle(item.value.titlePath)),
    );
    const candidateModel = trainEntryTypeLearningModel(examples, entries);
    expect(candidateModel).toBeDefined();
    const state = cloneEntryTypeLearningState({
      trustedExamples: examples,
      ...(candidateModel === undefined ? {} : {candidateModel}),
    });

    expect(
      decodeEntryTypeLearningState(JSON.parse(JSON.stringify(state))),
    ).toEqual(state);
    expect(
      decodeEntryTypeLearningState({
        trustedExamples: [examples[0], examples[0]],
      }),
    ).toBeUndefined();
  });

  it('keeps legacy models readable but ineligible until they are retrained', () => {
    const entries = fixtures();
    const examples = entries.map((item) =>
      trusted(item, typeForTitle(item.value.titlePath)),
    );
    const candidateModel = trainEntryTypeLearningModel(examples, entries);
    expect(candidateModel).toBeDefined();
    const serialized = JSON.parse(
      JSON.stringify(
        cloneEntryTypeLearningState({
          trustedExamples: examples,
          ...(candidateModel === undefined ? {} : {candidateModel}),
        }),
      ),
    ) as {
      candidateModel: {
        evaluation: Record<string, unknown> & {
          byType: Record<string, unknown>[];
        };
      };
    };
    delete serialized.candidateModel.evaluation.activationPolicyVersion;
    delete serialized.candidateModel.evaluation.supportedClassCount;
    delete serialized.candidateModel.evaluation.projection;
    for (const item of serialized.candidateModel.evaluation.byType) {
      delete item.trustedExampleCount;
      delete item.trustedSnapshotCount;
      delete item.trainingExampleCount;
      delete item.trainingSnapshotCount;
      delete item.validationSnapshotCount;
      delete item.supported;
    }

    const decoded = decodeEntryTypeLearningState(serialized);

    expect(decoded?.candidateModel).toBeDefined();
    expect(
      isEntryTypeLearningModelActivationEligible(decoded?.candidateModel),
    ).toBe(false);
  });

  it('keeps deterministic rules ahead of the active model and neighbor consensus behind it', () => {
    const entries = fixtures();
    const examples = entries.map((item) =>
      trusted(item, typeForTitle(item.value.titlePath)),
    );
    const activeModel = trainEntryTypeLearningModel(examples, entries);
    if (activeModel === undefined) throw new Error('model_expected');
    const profile = Object.freeze({
      ...DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      revision: 1,
      typeLearning: cloneEntryTypeLearningState({
        trustedExamples: examples,
        activeModel,
      }),
    });
    const neighborEvidence = Object.freeze({
      type: Object.freeze({
        keyword: 'argument' as const,
        referenceCount: 8,
        consensusBasisPoints: 10_000,
        score: 100,
      }),
      domains: Object.freeze([]),
    });

    const learned = classifyInformationEntryDeterministically({
      titlePath: 'Build cmdline recipe',
      body: 'Build cmdline recipe body',
      contentKeywords: ['cmdline-recipe', 'terminal-workflow'],
      chunkMode: 'split',
      profile,
      neighborEvidence,
    });
    const deterministic = classifyInformationEntryDeterministically({
      titlePath: '正式发布 Build cmdline recipe',
      body: 'Build cmdline recipe body',
      contentKeywords: ['cmdline-recipe', 'terminal-workflow'],
      chunkMode: 'split',
      profile,
      neighborEvidence,
    });
    const legacyEvaluation = {...activeModel.evaluation};
    delete legacyEvaluation.activationPolicyVersion;
    const legacyIgnored = classifyInformationEntryDeterministically({
      titlePath: 'Build cmdline recipe',
      body: 'Build cmdline recipe body',
      contentKeywords: ['cmdline-recipe', 'terminal-workflow'],
      chunkMode: 'split',
      profile: Object.freeze({
        ...profile,
        typeLearning: cloneEntryTypeLearningState({
          trustedExamples: examples,
          activeModel: Object.freeze({
            ...activeModel,
            evaluation: Object.freeze(legacyEvaluation),
          }),
        }),
      }),
      neighborEvidence,
    });

    expect(learned.typeKeyword).toBe('operating_guideline');
    expect(learned.diagnostics.type.evidenceSource).toBe('learned_type_model');
    expect(deterministic.typeKeyword).toBe('public_communication');
    expect(deterministic.diagnostics.type.evidenceSource).toBeUndefined();
    expect(legacyIgnored.typeKeyword).toBe('argument');
    expect(legacyIgnored.diagnostics.type.evidenceSource).toBe(
      'neighbor_consensus',
    );
  });
});

function fixtures(
  includeCurrentTypes = false,
): readonly Readonly<CurrentInformationEntry>[] {
  return Object.freeze(
    Array.from({length: 10}, (_, snapshot) =>
      TYPE_CASES.map((item, order) =>
        entry(
          snapshot + 1,
          order,
          item.title,
          item.keywords,
          includeCurrentTypes ? item.typeKeyword : undefined,
        ),
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

const ALL_LEARNED_TYPES = [
  'factual_material',
  'knowledge_explanation',
  'operating_guideline',
  'investigation_analysis',
  'argument',
  'personal_experience',
  'interactive_collaboration',
  'public_communication',
  'literary_creation',
] as const satisfies readonly LearnedEntryTypeKeyword[];

function typeForTitle(title: string): LearnedEntryTypeKeyword {
  const matched = TYPE_CASES.find((item) => title.startsWith(item.title));
  if (matched === undefined) throw new Error('type_fixture_missing');
  return matched.typeKeyword;
}

function trusted(
  value: Readonly<CurrentInformationEntry>,
  typeKeyword: LearnedEntryTypeKeyword,
): Readonly<EntryTypeTrustedExample> {
  return Object.freeze({
    entryId: value.entryId,
    entryRevision: value.revision,
    snapshotId: value.snapshotId,
    typeKeyword,
    authority: 'manual',
  });
}

function entry(
  snapshot: number,
  order: number,
  titlePath: string,
  contentKeywords: readonly string[],
  typeKeyword?: CurrentInformationEntry['value']['typeKeyword'],
  isPrivate = false,
): Readonly<CurrentInformationEntry> {
  const suffix = (snapshot * 100 + order + 1).toString(16).padStart(12, '0');
  const snapshotSuffix = snapshot.toString(16).padStart(12, '0');
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: '00000000-0000-4000-8000-' + suffix,
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '00000000-0000-4000-8000-' + snapshotSuffix,
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
      isPrivate,
      ...(typeKeyword === undefined ? {} : {typeKeyword}),
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

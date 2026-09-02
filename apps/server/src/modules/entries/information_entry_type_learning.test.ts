import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
} from './information_entry_deterministic_classification.js';
import {
  cloneEntryTypeLearningState,
  decodeEntryTypeLearningState,
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
      trusted(
        entry,
        entry.value.titlePath.startsWith('Build')
          ? 'operating_guideline'
          : 'investigation_analysis',
      ),
    );

    const model = trainEntryTypeLearningModel(examples, entries);

    expect(model).toBeDefined();
    expect(model?.evaluation.validationCount).toBeGreaterThanOrEqual(2);
    expect(model?.evaluation.precisionBasisPoints).toBe(10_000);
    expect(model?.evaluation.activationEligible).toBe(true);
    const prediction = predictEntryType(
      entry(90, 0, 'Build cmdline recipe', ['cmdline-recipe']),
      model,
    );
    expect(prediction?.keyword).toBe('operating_guideline');
    expect(prediction?.matchedFeatures.length).toBeGreaterThan(0);
  });

  it('samples missing and conflicting entries across snapshots without reusing trusted revisions', () => {
    const entries = [
      entry(1, 0, 'Missing one', ['alpha']),
      entry(1, 1, 'Missing two', ['beta']),
      entry(2, 0, 'Other', ['gamma'], 'other'),
      entry(3, 0, 'Trusted', ['delta'], 'argument'),
      entry(4, 0, 'Private', ['epsilon'], undefined, true),
    ];
    const state = cloneEntryTypeLearningState({
      trustedExamples: [
        trusted(entries[3] as CurrentInformationEntry, 'argument'),
      ],
    });

    const publicCandidates = selectEntryTypeLearningCandidates(entries, state, {
      includePrivate: false,
      limit: 3,
    });

    expect(publicCandidates.map((item) => item.entry.entryId)).not.toContain(
      entries[3]?.entryId,
    );
    expect(publicCandidates.map((item) => item.entry.entryId)).not.toContain(
      entries[4]?.entryId,
    );
    expect(publicCandidates[0]?.reason).toBe('missing_type');
    expect(
      new Set(publicCandidates.map((item) => item.entry.snapshotId)).size,
    ).toBeGreaterThan(1);
  });

  it('round-trips the closed external learning state and rejects duplicate samples', () => {
    const entries = fixtures();
    const examples = entries.map((item) =>
      trusted(
        item,
        item.value.titlePath.startsWith('Build')
          ? 'operating_guideline'
          : 'investigation_analysis',
      ),
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

  it('keeps deterministic rules ahead of the active model and neighbor consensus behind it', () => {
    const entries = fixtures();
    const examples = entries.map((item) =>
      trusted(
        item,
        item.value.titlePath.startsWith('Build')
          ? 'operating_guideline'
          : 'investigation_analysis',
      ),
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

    expect(learned.typeKeyword).toBe('operating_guideline');
    expect(learned.diagnostics.type.evidenceSource).toBe('learned_type_model');
    expect(deterministic.typeKeyword).toBe('public_communication');
    expect(deterministic.diagnostics.type.evidenceSource).toBeUndefined();
  });
});

function fixtures(): readonly Readonly<CurrentInformationEntry>[] {
  return Object.freeze(
    Array.from({length: 10}, (_, snapshot) => [
      entry(snapshot + 1, 0, 'Build cmdline recipe', [
        'cmdline-recipe',
        'terminal-workflow',
      ]),
      entry(snapshot + 1, 1, 'Measure evidence corpus', [
        'evidence-corpus',
        'measurement-result',
      ]),
    ]).flat(),
  );
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
  const suffix = (snapshot * 10 + order + 1).toString(16).padStart(12, '0');
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

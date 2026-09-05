import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {buildInformationEntryClassificationContext} from './information_entry_classification_context.js';
import {
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
} from './information_entry_deterministic_classification.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('InformationEntry classification neighbor context', () => {
  it('adds explainable consensus only from sufficiently similar labelled neighbors', () => {
    const candidate = entry(1, ['alpha-tool', 'container'], {});
    const references = [2, 3, 4, 5].map((ordinal) =>
      entry(ordinal, ['alpha-tool', 'container'], {
        typeKeyword: 'operating_guideline',
        domains: ['engineering_computing'],
      }),
    );
    const context = buildInformationEntryClassificationContext([
      candidate,
      ...references,
    ]);
    const evidence = context.evidenceFor(candidate);
    const classification = classifyInformationEntryDeterministically({
      titlePath: candidate.value.titlePath,
      body: candidate.value.body,
      contentKeywords: candidate.value.contentKeywords.map(
        (keyword) => keyword.displayValue,
      ),
      neighborEvidence: evidence,
    });

    expect(evidence.type).toEqual({
      keyword: 'operating_guideline',
      referenceCount: 4,
      consensusBasisPoints: 10_000,
      score: 12,
    });
    expect(evidence.domains).toEqual([
      {
        keyword: 'engineering_computing',
        referenceCount: 4,
        consensusBasisPoints: 10_000,
        score: 12,
      },
    ]);
    expect(classification.typeKeyword).toBe('operating_guideline');
    expect(classification.diagnostics.type).toMatchObject({
      evidenceSource: 'neighbor_consensus',
      referenceCount: 4,
      consensusBasisPoints: 10_000,
    });
  });

  it('does not copy type labels within one source document', () => {
    const candidate = entry(10, ['shared-a', 'shared-b'], {
      snapshotOrdinal: 90,
    });
    const references = [11, 12, 13, 14].map((ordinal) =>
      entry(ordinal, ['shared-a', 'shared-b'], {
        snapshotOrdinal: 90,
        typeKeyword: 'argument',
        domains: ['humanities_history'],
      }),
    );
    const evidence = buildInformationEntryClassificationContext([
      candidate,
      ...references,
    ]).evidenceFor(candidate);

    expect(evidence.type).toBeUndefined();
    expect(evidence.domains[0]).toMatchObject({
      keyword: 'humanities_history',
      referenceCount: 4,
    });
  });

  it('separates public and private evidence before consensus', () => {
    const candidate = entry(20, ['secret-a', 'secret-b'], {});
    const privateReferences = [21, 22, 23, 24].map((ordinal) =>
      entry(ordinal, ['secret-a', 'secret-b'], {
        isPrivate: true,
        typeKeyword: 'argument',
      }),
    );
    const evidence = buildInformationEntryClassificationContext([
      candidate,
      ...privateReferences,
    ]).evidenceFor(candidate);

    expect(evidence).toEqual({domains: []});
  });

  it('rejects divided votes and keywords that exceed the fan-out cap', () => {
    const candidate = entry(30, ['generic-a', 'generic-b'], {});
    const divided = [
      entry(31, ['generic-a', 'generic-b'], {typeKeyword: 'argument'}),
      entry(32, ['generic-a', 'generic-b'], {typeKeyword: 'argument'}),
      entry(33, ['generic-a', 'generic-b'], {
        typeKeyword: 'knowledge_explanation',
      }),
      entry(34, ['generic-a', 'generic-b'], {
        typeKeyword: 'knowledge_explanation',
      }),
    ];
    const strictFanOut = {
      ...DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
      maximumReferencesPerKeyword: 4,
    };

    expect(
      buildInformationEntryClassificationContext(
        [candidate, ...divided],
        strictFanOut,
      ).evidenceFor(candidate),
    ).toEqual({domains: []});
  });
});

function entry(
  ordinal: number,
  keywords: readonly string[],
  input: Readonly<{
    snapshotOrdinal?: number;
    isPrivate?: boolean;
    typeKeyword?: CurrentInformationEntry['value']['typeKeyword'];
    domains?: readonly Exclude<
      CurrentInformationEntry['value']['domains'][number]['keyword'],
      'other'
    >[];
  }>,
): Readonly<CurrentInformationEntry> {
  const id = ordinal.toString(16).padStart(12, '0');
  const snapshotId = (input.snapshotOrdinal ?? ordinal)
    .toString(16)
    .padStart(12, '0');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: `10000000-0000-4000-8000-${id}`,
    resourceId: `20000000-0000-4000-8000-${id}`,
    snapshotId: `30000000-0000-4000-8000-${snapshotId}`,
    revision: 1,
    revisionId: `40000000-0000-4000-8000-${id}`,
    sourceKey: `synthetic-${ordinal.toString()}`,
    capturedAt: '2026-09-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal,
      titlePath: `Synthetic ${ordinal.toString()}`,
      body: 'No built-in classification signal.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: input.isPrivate ?? false,
      ...(input.typeKeyword === undefined
        ? {}
        : {typeKeyword: input.typeKeyword}),
      contentKeywords: Object.freeze(
        keywords.map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword,
            origin: 'manual' as const,
            originVersion: 'synthetic.v1',
          }),
        ),
      ),
      domains: Object.freeze(
        (input.domains ?? []).map((keyword) =>
          Object.freeze({
            keyword,
            origin: 'manual' as const,
            originVersion: 'synthetic.v1',
          }),
        ),
      ),
      fragmentIds: Object.freeze([`50000000-0000-4000-8000-${id}`]),
    }),
  });
}

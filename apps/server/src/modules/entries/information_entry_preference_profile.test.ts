import {describe, expect, it} from 'vitest';

import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  suggestInformationEntryPreferenceRules,
  trialInformationEntryPreferenceProfile,
} from './information_entry_preference_profile.js';
import {
  MAXIMUM_INFORMATION_ENTRY_PREFERENCE_SUGGESTIONS,
  MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES,
} from './information_entry_preference_profile_contract.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('Information Entry preference profile', () => {
  it('suggests usefulness and interest rules independently with stable evidence', () => {
    const entries = [
      scoredEntry(1, 5, 1, 'PostgreSQL'),
      scoredEntry(2, 4, 2, 'POSTGRESQL'),
      scoredEntry(3, 5, 2, 'postgresql'),
      scoredEntry(4, 1, 5, 'PostgreSQL'),
      scoredEntry(5, 3, 3, 'PostgreSQL'),
      entry(6, {keyword: 'PostgreSQL'}),
    ];

    const result = suggestInformationEntryPreferenceRules(entries, {
      includePrivate: false,
    });

    expect(result).toMatchObject({
      visibleEntryCount: 6,
      totalCandidateCount: 6,
      truncated: false,
    });
    expect(
      result.candidates.map((candidate) => [
        candidate.dimension,
        candidate.featureKind,
        candidate.featureIdentity,
      ]),
    ).toEqual([
      ['usefulness', 'content_keyword', 'postgresql'],
      ['usefulness', 'type', 'knowledge_explanation'],
      ['usefulness', 'domain', 'engineering_computing'],
      ['interest', 'content_keyword', 'postgresql'],
      ['interest', 'type', 'knowledge_explanation'],
      ['interest', 'domain', 'engineering_computing'],
    ]);
    expect(result.candidates[0]).toEqual({
      dimension: 'usefulness',
      featureKind: 'content_keyword',
      featureIdentity: 'postgresql',
      displayValue: 'POSTGRESQL',
      effect: 'prefer',
      suggestedWeight: 2,
      positiveCount: 3,
      neutralCount: 1,
      negativeCount: 1,
      positiveEntryIds: [entryId(1), entryId(2), entryId(3)],
      neutralEntryIds: [entryId(5)],
      negativeEntryIds: [entryId(4)],
    });
    expect(result.candidates[3]).toMatchObject({
      dimension: 'interest',
      effect: 'deprioritize',
      suggestedWeight: 2,
      positiveCount: 1,
      neutralCount: 1,
      negativeCount: 3,
    });
    expect(Object.isFrozen(result.candidates[0]?.positiveEntryIds)).toBe(true);
  });

  it('does not suggest rules from insufficient or contradictory observations', () => {
    const insufficient = [
      entry(1, {usefulnessScore: 5, keyword: 'small-sample'}),
      entry(2, {usefulnessScore: 4, keyword: 'small-sample'}),
    ];
    const contradictory = [
      entry(3, {usefulnessScore: 5, keyword: 'mixed'}),
      entry(4, {usefulnessScore: 4, keyword: 'mixed'}),
      entry(5, {usefulnessScore: 1, keyword: 'mixed'}),
    ];

    expect(
      suggestInformationEntryPreferenceRules(
        [...insufficient, ...contradictory],
        {includePrivate: false},
      ).candidates,
    ).toEqual([]);
  });

  it('filters privacy before counting and only explains private samples after opt-in', () => {
    const entries = [
      scoredEntry(1, 5, undefined, 'local'),
      scoredEntry(2, 4, undefined, 'local'),
      entry(3, {
        usefulnessScore: 5,
        keyword: 'local',
        isPrivate: true,
        typeKeyword: 'knowledge_explanation',
        domainKeyword: 'engineering_computing',
      }),
    ];

    const publicResult = suggestInformationEntryPreferenceRules(entries, {
      includePrivate: false,
    });
    const privateResult = suggestInformationEntryPreferenceRules(entries, {
      includePrivate: true,
    });

    expect(publicResult).toMatchObject({
      visibleEntryCount: 2,
      totalCandidateCount: 0,
    });
    expect(privateResult).toMatchObject({
      visibleEntryCount: 3,
      totalCandidateCount: 3,
    });
    expect(privateResult.candidates[0]?.positiveEntryIds).toContain(entryId(3));
  });

  it('caps suggestions after stable dimension, kind and UTF-8 identity ordering', () => {
    const entries: Readonly<CurrentInformationEntry>[] = [];
    for (let group = 0; group < 3; group += 1) {
      const start = group * 24;
      const keywords = Array.from(
        {length: Math.min(24, 70 - start)},
        (_, index) => `keyword-${(start + index).toString()}`,
      );
      for (let sample = 0; sample < 3; sample += 1) {
        entries.push(
          entry(group * 3 + sample + 1, {
            usefulnessScore: 5,
            keywords,
          }),
        );
      }
    }

    const result = suggestInformationEntryPreferenceRules(entries, {
      includePrivate: false,
    });
    const identities = result.candidates.map(
      (candidate) => candidate.featureIdentity,
    );

    expect(result).toMatchObject({
      totalCandidateCount: 70,
      truncated: true,
    });
    expect(result.candidates).toHaveLength(
      MAXIMUM_INFORMATION_ENTRY_PREFERENCE_SUGGESTIONS,
    );
    expect(identities).toEqual([...identities].sort());
  });

  it('trials a disabled draft without changing Entries and keeps dimensions separate', () => {
    const entries = [
      entry(2, {
        usefulnessScore: 2,
        keyword: 'unmatched',
        typeKeyword: 'knowledge_explanation',
        domainKeyword: 'culture_arts',
      }),
      scoredEntry(1, 5, 4, 'PostgreSQL'),
    ];
    const before = JSON.stringify(entries);
    const draft = validProfile(false);

    const result = trialInformationEntryPreferenceProfile(entries, 2, draft, {
      includePrivate: false,
      expectedProfileRevision: 2,
    });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('expected trial');
    expect(result.profile.enabled).toBe(false);
    expect(result.items.map((item) => item.entryId)).toEqual([
      entryId(1),
      entryId(2),
    ]);
    expect(result.items[0]).toMatchObject({
      usefulnessScore: 5,
      interestScore: 4,
      totals: {usefulness: 3, interest: 3},
    });
    expect(
      result.items[0]?.matchedRules.map((match) => [
        match.rule.ruleId,
        match.signedWeight,
      ]),
    ).toEqual([
      ['77777777-7777-4777-8777-777777777771', 5],
      ['77777777-7777-4777-8777-777777777772', -2],
      ['77777777-7777-4777-8777-777777777773', 3],
    ]);
    expect(result.items[1]?.totals).toEqual({usefulness: -2, interest: 0});
    expect(JSON.stringify(entries)).toBe(before);
    expect('body' in (result.items[0] ?? {})).toBe(false);

    const firstDraftRule = draft.rules[0];
    if (firstDraftRule === undefined) throw new Error('expected draft rule');
    firstDraftRule.displayValue = 'caller mutation';
    expect(result.profile.rules[0]?.displayValue).toBe('PostgreSQL');
  });

  it('returns at most one hundred Entries in stable order', () => {
    const entries = Array.from({length: 105}, (_, index) =>
      entry(105 - index, {}),
    );

    const result = trialInformationEntryPreferenceProfile(
      entries,
      2,
      validProfile(),
      {
        includePrivate: false,
        expectedProfileRevision: 2,
      },
    );

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('expected trial');
    expect(result).toMatchObject({
      visibleEntryCount: 105,
      evaluatedEntryCount: MAXIMUM_INFORMATION_ENTRY_PREFERENCE_TRIAL_ENTRIES,
      truncated: true,
    });
    expect(result.items[0]?.entryId).toBe(entryId(1));
    expect(result.items.at(-1)?.entryId).toBe(entryId(100));
  });

  it('reports malformed and stale profile state instead of evaluating it', () => {
    expect(
      trialInformationEntryPreferenceProfile(
        [entry(1, {})],
        2,
        {
          ...validProfile(),
          rules: [{...validProfile().rules[0], weight: 6}],
        },
        {includePrivate: false, expectedProfileRevision: 2},
      ),
    ).toEqual({status: 'invalid_profile'});

    expect(
      trialInformationEntryPreferenceProfile(
        [entry(1, {})],
        3,
        validProfile(),
        {includePrivate: false, expectedProfileRevision: 2},
      ),
    ).toEqual({
      status: 'stale_profile',
      expectedProfileRevision: 2,
      draftProfileRevision: 2,
      currentProfileRevision: 3,
    });
  });

  it('reports changed or invisible Entry revisions and rejects an invalid ledger', () => {
    const entries = [
      entry(1, {revision: 2}),
      entry(2, {revision: 1, isPrivate: true}),
    ];

    expect(
      trialInformationEntryPreferenceProfile(entries, 2, validProfile(), {
        includePrivate: false,
        expectedProfileRevision: 2,
        expectedEntries: [
          {entryId: entryId(1), revision: 1},
          {entryId: entryId(2), revision: 1},
        ],
      }),
    ).toEqual({
      status: 'stale_entries',
      entries: [
        {
          entryId: entryId(1),
          expectedRevision: 1,
          currentRevision: 2,
        },
        {entryId: entryId(2), expectedRevision: 1},
      ],
    });

    expect(
      trialInformationEntryPreferenceProfile(entries, 2, validProfile(), {
        includePrivate: true,
        expectedProfileRevision: 2,
        expectedEntries: [
          {entryId: entryId(1), revision: 2},
          {entryId: entryId(1), revision: 2},
        ],
      }),
    ).toEqual({status: 'invalid_request'});
  });
});

function scoredEntry(
  ordinal: number,
  usefulnessScore: 1 | 2 | 3 | 4 | 5 | undefined,
  interestScore: 1 | 2 | 3 | 4 | 5 | undefined,
  keyword: string,
): Readonly<CurrentInformationEntry> {
  return entry(ordinal, {
    ...(usefulnessScore === undefined ? {} : {usefulnessScore}),
    ...(interestScore === undefined ? {} : {interestScore}),
    keyword,
    typeKeyword: 'knowledge_explanation',
    domainKeyword: 'engineering_computing',
  });
}

function entry(
  ordinal: number,
  options: Readonly<{
    revision?: number;
    isPrivate?: boolean;
    usefulnessScore?: 1 | 2 | 3 | 4 | 5;
    interestScore?: 1 | 2 | 3 | 4 | 5;
    keyword?: string;
    keywords?: readonly string[];
    typeKeyword?: 'knowledge_explanation';
    domainKeyword?: 'engineering_computing' | 'culture_arts';
  }>,
): Readonly<CurrentInformationEntry> {
  const keywords =
    options.keywords ?? (options.keyword ? [options.keyword] : []);
  const revision = options.revision ?? 1;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: entryId(ordinal),
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision,
    revisionId: revisionId(ordinal, revision),
    sourceKey: 'synthetic:preference-profile',
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal - 1,
      titlePath: `Synthetic preference Entry ${ordinal.toString()}`,
      body: `Synthetic preference body ${ordinal.toString()}`,
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: options.isPrivate ?? false,
      ...(options.typeKeyword === undefined
        ? {}
        : {typeKeyword: options.typeKeyword}),
      ...(options.usefulnessScore === undefined
        ? {}
        : {usefulnessScore: options.usefulnessScore}),
      ...(options.interestScore === undefined
        ? {}
        : {interestScore: options.interestScore}),
      contentKeywords: Object.freeze(
        keywords.map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword.toLowerCase().normalize('NFC'),
            origin: 'manual' as const,
            originVersion: 'synthetic.v1',
          }),
        ),
      ),
      domains: Object.freeze(
        options.domainKeyword === undefined
          ? []
          : [
              Object.freeze({
                keyword: options.domainKeyword,
                origin: 'manual' as const,
                originVersion: 'synthetic.v1',
              }),
            ],
      ),
      fragmentIds: Object.freeze([fragmentId(ordinal)]),
    }),
  });
}

function validProfile(enabled = true): {
  revision: number;
  enabled: boolean;
  rules: {
    ruleId: string;
    dimension: 'usefulness' | 'interest';
    featureKind: 'content_keyword' | 'type' | 'domain';
    featureIdentity: string;
    displayValue: string;
    effect: 'prefer' | 'deprioritize';
    weight: number;
  }[];
} {
  return {
    revision: 2,
    enabled,
    rules: [
      {
        ruleId: '77777777-7777-4777-8777-777777777771',
        dimension: 'usefulness',
        featureKind: 'content_keyword',
        featureIdentity: 'postgresql',
        displayValue: 'PostgreSQL',
        effect: 'prefer',
        weight: 5,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777772',
        dimension: 'usefulness',
        featureKind: 'type',
        featureIdentity: 'knowledge_explanation',
        displayValue: '知识说明',
        effect: 'deprioritize',
        weight: 2,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777773',
        dimension: 'interest',
        featureKind: 'domain',
        featureIdentity: 'engineering_computing',
        displayValue: '工程与计算',
        effect: 'prefer',
        weight: 3,
      },
    ],
  };
}

function entryId(ordinal: number): string {
  return `44444444-4444-4444-8444-${ordinal.toString().padStart(12, '0')}`;
}

function revisionId(ordinal: number, revision: number): string {
  return `55555555-5555-4555-8555-${(ordinal * 1000 + revision)
    .toString()
    .padStart(12, '0')}`;
}

function fragmentId(ordinal: number): string {
  return `66666666-6666-4666-8666-${ordinal.toString().padStart(12, '0')}`;
}

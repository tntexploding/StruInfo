import {describe, expect, it} from 'vitest';

import {
  decodeEntryAutomationPolicy,
  MAX_ENTRY_AUTOMATION_SCORE_THRESHOLD,
} from '../../storage/review_preferences_store.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {trialInformationEntryAutomationPolicy} from './information_entry_automation_policy.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('Information Entry automation policy', () => {
  it('decodes an owned frozen default-off authority record', () => {
    const input = validPolicy();
    const decoded = decodeEntryAutomationPolicy(input);

    expect(decoded).toEqual(input);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.advanceThresholds)).toBe(true);
    expect(Object.isFrozen(decoded?.budgets)).toBe(true);

    input.advanceThresholds.usefulness = 99;
    input.budgets.maximumEntriesPerRun = 1;
    expect(decoded?.advanceThresholds.usefulness).toBe(3);
    expect(decoded?.budgets.maximumEntriesPerRun).toBe(5);
  });

  it('rejects open, out-of-range and incoherent policy values', () => {
    expect(
      decodeEntryAutomationPolicy({...validPolicy(), unknown: true}),
    ).toBeUndefined();
    expect(
      decodeEntryAutomationPolicy({
        ...validPolicy(),
        advanceThresholds: {
          ...validPolicy().advanceThresholds,
          usefulness: MAX_ENTRY_AUTOMATION_SCORE_THRESHOLD + 1,
        },
      }),
    ).toBeUndefined();
    expect(
      decodeEntryAutomationPolicy({
        ...validPolicy(),
        budgets: {
          ...validPolicy().budgets,
          maximumAdvanceCandidatesPerRun: 6,
        },
      }),
    ).toBeUndefined();
    expect(
      decodeEntryAutomationPolicy({
        ...validPolicy(),
        failureMode: 'continue',
      }),
    ).toBeUndefined();
  });

  it('routes separate positive, negative, mixed and insufficient evidence', () => {
    const result = trialInformationEntryAutomationPolicy(
      [
        entry(5, {keywords: ['advance']}),
        entry(3, {keywords: ['advance', 'defer']}),
        entry(1, {
          keywords: ['advance'],
          domainKeyword: 'engineering_computing',
        }),
        entry(4, {}),
        entry(2, {
          keywords: ['defer'],
          typeKeyword: 'knowledge_explanation',
        }),
      ],
      4,
      2,
      validPolicy(),
      validProfile(),
      request(),
    );

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(result).toMatchObject({
      dryRunOnly: true,
      activation: 'ready',
      includePrivate: false,
      visibleEntryCount: 5,
      evaluatedEntryCount: 5,
      truncated: false,
      counts: {
        advance_candidate: 1,
        defer_candidate: 1,
        manual_review: 3,
      },
    });
    expect(
      result.items.map(({entryId: id, route, reason, signals}) => ({
        id,
        route,
        reason,
        signals,
      })),
    ).toEqual([
      {
        id: entryId(1),
        route: 'advance_candidate',
        reason: 'advance_threshold_met',
        signals: {usefulness: 'advance', interest: 'advance'},
      },
      {
        id: entryId(2),
        route: 'defer_candidate',
        reason: 'defer_threshold_met',
        signals: {usefulness: 'defer', interest: 'defer'},
      },
      {
        id: entryId(3),
        route: 'manual_review',
        reason: 'mixed_signals',
        signals: {usefulness: 'advance', interest: 'defer'},
      },
      {
        id: entryId(4),
        route: 'manual_review',
        reason: 'insufficient_profile_evidence',
        signals: {usefulness: 'neutral', interest: 'neutral'},
      },
      {
        id: entryId(5),
        route: 'manual_review',
        reason: 'advance_budget_exhausted',
        signals: {usefulness: 'advance', interest: 'neutral'},
      },
    ]);
  });

  it('applies manual takeover before run and candidate budgets', () => {
    const policy = validPolicy();
    policy.budgets.maximumEntriesPerRun = 1;
    policy.budgets.maximumAdvanceCandidatesPerRun = 1;
    const result = trialInformationEntryAutomationPolicy(
      [entry(1, {keywords: ['advance']}), entry(2, {keywords: ['advance']})],
      4,
      2,
      policy,
      validProfile(),
      {
        ...request(),
        manualTakeoverEntryIds: [entryId(1)],
      },
    );

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(result.items.map((item) => [item.route, item.reason])).toEqual([
      ['manual_review', 'manual_takeover'],
      ['manual_review', 'run_budget_exhausted'],
    ]);
  });

  it('keeps privacy request-scoped and never substitutes an invisible Entry', () => {
    const entries = [
      entry(1, {keywords: ['advance']}),
      entry(2, {keywords: ['advance'], isPrivate: true}),
    ];
    const publicResult = trialInformationEntryAutomationPolicy(
      entries,
      4,
      2,
      validPolicy(),
      validProfile(),
      request(),
    );
    const privateResult = trialInformationEntryAutomationPolicy(
      entries,
      4,
      2,
      validPolicy(),
      validProfile(),
      {...request(), includePrivate: true},
    );

    expect(publicResult).toMatchObject({
      status: 'complete',
      includePrivate: false,
      visibleEntryCount: 1,
      evaluatedEntryCount: 1,
    });
    expect(privateResult).toMatchObject({
      status: 'complete',
      includePrivate: true,
      visibleEntryCount: 2,
      evaluatedEntryCount: 2,
    });
    expect(
      trialInformationEntryAutomationPolicy(
        entries,
        4,
        2,
        validPolicy(),
        validProfile(),
        {
          ...request(),
          manualTakeoverEntryIds: [entryId(2)],
        },
      ),
    ).toEqual({status: 'invalid_request'});
  });

  it('reports disabled, paused and Profile-bound activation separately', () => {
    const cases = [
      {
        policy: {...validPolicy(), enabled: false},
        profile: validProfile(),
        activation: 'disabled',
      },
      {
        policy: {...validPolicy(), paused: true},
        profile: validProfile(),
        activation: 'paused',
      },
      {
        policy: validPolicy(),
        profile: {...validProfile(), enabled: false},
        activation: 'profile_disabled',
      },
      {
        policy: {...validPolicy(), profileRevision: 1},
        profile: validProfile(),
        activation: 'profile_revision_mismatch',
      },
    ];

    for (const scenario of cases) {
      expect(
        trialInformationEntryAutomationPolicy(
          [entry(1, {keywords: ['advance']})],
          4,
          2,
          scenario.policy,
          scenario.profile,
          request(),
        ),
      ).toMatchObject({
        status: 'complete',
        dryRunOnly: true,
        activation: scenario.activation,
      });
    }
  });

  it('fails visibly on stale policy, Profile and Entry revisions', () => {
    expect(
      trialInformationEntryAutomationPolicy(
        [entry(1, {})],
        5,
        2,
        validPolicy(),
        validProfile(),
        request(),
      ),
    ).toEqual({
      status: 'stale_policy',
      expectedPolicyRevision: 4,
      draftPolicyRevision: 4,
      currentPolicyRevision: 5,
    });
    expect(
      trialInformationEntryAutomationPolicy(
        [entry(1, {})],
        4,
        3,
        validPolicy(),
        validProfile(),
        request(),
      ),
    ).toEqual({
      status: 'stale_profile',
      expectedProfileRevision: 2,
      draftProfileRevision: 2,
      currentProfileRevision: 3,
    });
    expect(
      trialInformationEntryAutomationPolicy(
        [entry(1, {revision: 2})],
        4,
        2,
        validPolicy(),
        validProfile(),
        {
          ...request(),
          expectedEntries: [{entryId: entryId(1), revision: 1}],
        },
      ),
    ).toEqual({
      status: 'stale_entries',
      entries: [
        {
          entryId: entryId(1),
          expectedRevision: 1,
          currentRevision: 2,
        },
      ],
    });
  });
});

function request() {
  return {
    includePrivate: false,
    expectedPolicyRevision: 4,
    expectedProfileRevision: 2,
  };
}

function validPolicy() {
  return {
    revision: 4,
    enabled: true,
    paused: false,
    profileRevision: 2,
    minimumMatchedRuleCount: 1,
    advanceThresholds: {
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    },
    deferThresholds: {
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    },
    budgets: {
      maximumEntriesPerRun: 5,
      maximumAdvanceCandidatesPerRun: 1,
      maximumDeferCandidatesPerRun: 1,
    },
    failureMode: 'pause',
  };
}

function validProfile() {
  return {
    revision: 2,
    enabled: true,
    rules: [
      {
        ruleId: '77777777-7777-4777-8777-777777777771',
        dimension: 'usefulness',
        featureKind: 'content_keyword',
        featureIdentity: 'advance',
        displayValue: 'Advance',
        effect: 'prefer',
        weight: 5,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777772',
        dimension: 'interest',
        featureKind: 'domain',
        featureIdentity: 'engineering_computing',
        displayValue: '工程与计算',
        effect: 'prefer',
        weight: 4,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777773',
        dimension: 'usefulness',
        featureKind: 'type',
        featureIdentity: 'knowledge_explanation',
        displayValue: '知识说明',
        effect: 'deprioritize',
        weight: 3,
      },
      {
        ruleId: '77777777-7777-4777-8777-777777777774',
        dimension: 'interest',
        featureKind: 'content_keyword',
        featureIdentity: 'defer',
        displayValue: 'Defer',
        effect: 'deprioritize',
        weight: 5,
      },
    ],
  };
}

function entry(
  ordinal: number,
  options: Readonly<{
    revision?: number;
    isPrivate?: boolean;
    keywords?: readonly string[];
    typeKeyword?: 'knowledge_explanation';
    domainKeyword?: 'engineering_computing';
  }>,
): Readonly<CurrentInformationEntry> {
  const revision = options.revision ?? 1;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: entryId(ordinal),
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision,
    revisionId: revisionId(ordinal, revision),
    sourceKey: 'synthetic:automation-policy',
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal - 1,
      titlePath: `Synthetic automation Entry ${ordinal.toString()}`,
      body: `Synthetic automation body ${ordinal.toString()}`,
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: options.isPrivate ?? false,
      ...(options.typeKeyword === undefined
        ? {}
        : {typeKeyword: options.typeKeyword}),
      contentKeywords: Object.freeze(
        (options.keywords ?? []).map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword,
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

function entryId(ordinal: number): string {
  return `44444444-4444-4444-8444-${ordinal.toString().padStart(12, '0')}`;
}

function revisionId(ordinal: number, revision: number): string {
  return `55555555-5555-4555-8555-${(ordinal * 100 + revision)
    .toString()
    .padStart(12, '0')}`;
}

function fragmentId(ordinal: number): string {
  return `66666666-6666-4666-8666-${ordinal.toString().padStart(12, '0')}`;
}

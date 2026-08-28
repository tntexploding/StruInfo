import {describe, expect, it} from 'vitest';

import {
  decodeEntryPreferenceProfile,
  decodeReviewSourceSubscriptionPreferences,
  MAX_ENTRY_PREFERENCE_RULES,
  normalizeEntryPreferenceFeatureIdentity,
} from './review_preferences_store.js';

describe('source subscription preferences', () => {
  it('owns constrained Web paths and portable plugin configuration references', () => {
    const additionalPaths = ['/about', '/news?lang=zh'];
    const decoded = decodeReviewSourceSubscriptionPreferences({
      revision: 1,
      subscriptions: [
        {
          kind: 'web',
          subscriptionId: '11111111-1111-4111-8111-111111111111',
          label: 'Synthetic Web',
          enabled: false,
          pageUrl: 'https://example.invalid/articles',
          additionalPaths,
          sourceAlias: 'synthetic-web',
          isPrivate: false,
          routeAfterImport: false,
          intervalMinutes: 60,
        },
        {
          kind: 'plugin',
          subscriptionId: '22222222-2222-4222-8222-222222222222',
          label: 'Synthetic plugin',
          enabled: false,
          connectorId: 'plugin.synthetic.v1',
          configurationRef: 'profile.default',
          sourceAlias: 'synthetic-plugin',
          isPrivate: true,
          routeAfterImport: false,
          intervalMinutes: 120,
        },
      ],
    });

    expect(decoded?.subscriptions).toMatchObject([
      {kind: 'web', additionalPaths: ['/about', '/news?lang=zh']},
      {
        kind: 'plugin',
        connectorId: 'plugin.synthetic.v1',
        configurationRef: 'profile.default',
      },
    ]);
    additionalPaths[0] = '/changed-by-caller';
    expect(decoded?.subscriptions[0]).toMatchObject({
      additionalPaths: ['/about', '/news?lang=zh'],
    });
    expect(Object.isFrozen(decoded?.subscriptions[0])).toBe(true);
  });

  it('rejects open Web ranges and executable-looking plugin identities', () => {
    const base = {
      revision: 1,
      subscriptions: [
        {
          kind: 'web',
          subscriptionId: '11111111-1111-4111-8111-111111111111',
          label: 'Synthetic Web',
          enabled: false,
          pageUrl: 'https://example.invalid/articles',
          additionalPaths: ['//other.invalid/page'],
          sourceAlias: 'synthetic-web',
          isPrivate: false,
          routeAfterImport: false,
          intervalMinutes: 60,
        },
      ],
    };
    expect(decodeReviewSourceSubscriptionPreferences(base)).toBeUndefined();
    expect(
      decodeReviewSourceSubscriptionPreferences({
        ...base,
        subscriptions: [
          {
            ...base.subscriptions[0],
            kind: 'plugin',
            connectorId: 'C:\\plugins\\reader.js',
            configurationRef: '../secret.json',
          },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('EntryPreferenceProfile preferences', () => {
  it('uses the same stable ASCII-lower and NFC identity as Entry tags', () => {
    expect(normalizeEntryPreferenceFeatureIdentity(' PostgreSQL ')).toBe(
      'postgresql',
    );
    expect(normalizeEntryPreferenceFeatureIdentity('J\u030c')).toBe('\u01f0');
    expect(normalizeEntryPreferenceFeatureIdentity('知识')).toBe('知识');
  });

  it('decodes an ordered owned profile with separate assessment dimensions', () => {
    const input = validProfile();
    const decoded = decodeEntryPreferenceProfile(input);

    expect(decoded).toEqual(input);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.rules)).toBe(true);
    expect(Object.isFrozen(decoded?.rules[0])).toBe(true);

    firstRule(input).displayValue = 'changed by caller';
    expect(decoded?.rules[0]?.displayValue).toBe('PostgreSQL');
  });

  it('rejects duplicate identities, open fields and non-canonical values', () => {
    const duplicateRuleId = validProfile();
    duplicateRuleId.rules.push({...firstRule(duplicateRuleId)});
    expect(decodeEntryPreferenceProfile(duplicateRuleId)).toBeUndefined();

    const duplicateFeature = validProfile();
    duplicateFeature.rules.push({
      ...firstRule(duplicateFeature),
      ruleId: '55555555-5555-4555-8555-555555555555',
      effect: 'deprioritize',
    });
    expect(decodeEntryPreferenceProfile(duplicateFeature)).toBeUndefined();

    expect(
      decodeEntryPreferenceProfile({
        ...validProfile(),
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      decodeEntryPreferenceProfile({
        ...validProfile(),
        rules: [
          {
            ...validProfile().rules[0],
            featureIdentity: 'PostgreSQL',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('enforces the 64-rule and 1-through-5 weight boundaries', () => {
    const maximum = {
      revision: 1,
      enabled: true,
      rules: Array.from({length: MAX_ENTRY_PREFERENCE_RULES}, (_, index) => ({
        ruleId:
          '00000000-0000-4000-8000-' + (index + 1).toString().padStart(12, '0'),
        dimension: index % 2 === 0 ? 'usefulness' : 'interest',
        featureKind: 'content_keyword',
        featureIdentity: 'keyword-' + index.toString(),
        displayValue: 'Keyword ' + index.toString(),
        effect: index % 2 === 0 ? 'prefer' : 'deprioritize',
        weight: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      })),
    };

    expect(decodeEntryPreferenceProfile(maximum)?.rules).toHaveLength(64);
    expect(
      decodeEntryPreferenceProfile({
        ...maximum,
        rules: [
          ...maximum.rules,
          {
            ...maximum.rules[0],
            ruleId: '00000000-0000-4000-8000-000000000065',
            featureIdentity: 'keyword-64',
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      decodeEntryPreferenceProfile({
        ...validProfile(),
        rules: [{...validProfile().rules[0], weight: 0}],
      }),
    ).toBeUndefined();
  });
});

function validProfile(): {
  revision: number;
  enabled: boolean;
  rules: {
    ruleId: string;
    dimension: string;
    featureKind: string;
    featureIdentity: string;
    displayValue: string;
    effect: string;
    weight: number;
  }[];
} {
  return {
    revision: 2,
    enabled: true,
    rules: [
      {
        ruleId: '44444444-4444-4444-8444-444444444444',
        dimension: 'usefulness',
        featureKind: 'content_keyword',
        featureIdentity: 'postgresql',
        displayValue: 'PostgreSQL',
        effect: 'prefer',
        weight: 5,
      },
      {
        ruleId: '66666666-6666-4666-8666-666666666666',
        dimension: 'interest',
        featureKind: 'domain',
        featureIdentity: 'culture_arts',
        displayValue: '文化与艺术',
        effect: 'deprioritize',
        weight: 2,
      },
    ],
  };
}

function firstRule(profile: ReturnType<typeof validProfile>) {
  const rule = profile.rules[0];
  if (rule === undefined)
    throw new Error('The synthetic profile needs a rule.');
  return rule;
}

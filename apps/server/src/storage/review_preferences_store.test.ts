import {describe, expect, it} from 'vitest';

import {decodeReviewSourceSubscriptionPreferences} from './review_preferences_store.js';

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

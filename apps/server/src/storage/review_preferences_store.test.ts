import {describe, expect, it} from 'vitest';

import {decodeReviewSourceSubscriptionPreferences} from './review_preferences_store.js';
import {publicSubscriptionSchema} from '../application/agent_capture_service.js';

describe('source subscription preferences', () => {
  it('stores one-minute polling and keeps the Agent default at five minutes', () => {
    const source = {
      kind: 'json_api',
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      label: 'Synthetic bulletins',
      sourceAlias: 'synthetic-bulletins',
      enabled: false,
      isPrivate: false,
      endpointUrl: 'https://example.invalid/updates',
      recordsPath: '',
      externalIdPath: 'id',
      titlePath: 'title',
      bodyPath: 'body',
      recordLimit: 20,
      authentication: {kind: 'none'},
      pollingCursor: {queryParameter: 'before', recordPath: 'id'},
      timeZoneOffset: '+08:00',
      paidContentPath: 'paid',
      querySignature: {algorithm: 'sha1_md5', parameter: 'sign'},
    };
    const decode = (intervalMinutes: number) =>
      decodeReviewSourceSubscriptionPreferences({
        revision: 1,
        subscriptions: [{...source, intervalMinutes}],
      });
    expect(decode(1)?.subscriptions[0]).toMatchObject({
      ...source,
      intervalMinutes: 1,
    });
    expect(decode(0)).toBeUndefined();
    const agent = Object.fromEntries(
      Object.entries(source).filter(
        ([key]) => !['isPrivate', 'authentication'].includes(key),
      ),
    );
    expect(publicSubscriptionSchema.parse(agent).intervalMinutes).toBe(5);
    expect(
      publicSubscriptionSchema.parse({...agent, intervalMinutes: 1})
        .intervalMinutes,
    ).toBe(1);
  });
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

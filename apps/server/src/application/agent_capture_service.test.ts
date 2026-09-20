import {describe, expect, it, vi} from 'vitest';
import type {SourceSubscriptionServicePort} from '../modules/subscriptions/source_subscription.js';
import type {
  ReviewRssSourceSubscription,
  ReviewSourceSubscriptionPreferences,
} from '../storage/review_preferences_store.js';
import {
  AgentCaptureService,
  publicSubscriptionSchema,
} from './agent_capture_service.js';
import {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const SOURCE = '00000000-0000-4000-8000-000000000002';
const SIBLING = '00000000-0000-4000-8000-000000000003';
const agent = ExecutionAuthority.agent(WORKSPACE, 'synthetic-agent', [
  'sources.capture',
]);
const source: ReviewRssSourceSubscription = {
  subscriptionId: SOURCE,
  kind: 'rss_atom',
  label: 'Synthetic source',
  sourceAlias: 'synthetic',
  enabled: false,
  isPrivate: false,
  routeAfterImport: false,
  intervalMinutes: 60,
  feedUrl: 'https://example.com/synthetic.xml',
  itemLimit: 5,
};
const input = publicSubscriptionSchema.parse({
  subscriptionId: SOURCE,
  kind: 'rss_atom',
  label: 'Updated synthetic source',
  sourceAlias: 'synthetic',
  enabled: false,
  intervalMinutes: 60,
  feedUrl: 'https://example.com/synthetic.xml',
  itemLimit: 5,
});

describe('Agent source catalog updates', () => {
  it('rejects a future expected revision before an older read can overwrite a newer private source', async () => {
    const fixture = catalogFixture();
    fixture.list.mockImplementationOnce(() => {
      const observed = fixture.current();
      fixture.set({revision: 8, subscriptions: [{...source, isPrivate: true}]});
      return Promise.resolve(observed);
    });
    await expect(fixture.service.put(agent, 8, input)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'source_subscription_stale',
    });
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(fixture.current().subscriptions[0]?.isPrivate).toBe(true);
  });

  it('updates the matching catalog while preserving private sibling configuration', async () => {
    const fixture = catalogFixture();
    const sibling = {...source, subscriptionId: SIBLING, isPrivate: true};
    fixture.set({revision: 7, subscriptions: [source, sibling]});
    await expect(fixture.service.put(agent, 7, input)).resolves.toEqual({
      revision: 8,
      subscriptionId: SOURCE,
    });
    expect(fixture.current().subscriptions).toContainEqual(sibling);
    expect(
      fixture.current().subscriptions.find((s) => s.subscriptionId === SOURCE)
        ?.label,
    ).toBe('Updated synthetic source');
  });
});

function catalogFixture() {
  let current: ReviewSourceSubscriptionPreferences = {
    revision: 7,
    subscriptions: [source],
  };
  const list = vi.fn<SourceSubscriptionServicePort['list']>(() =>
    Promise.resolve(current),
  );
  const replace = vi.fn<SourceSubscriptionServicePort['replace']>(
    (expected, subscriptions) => {
      if (expected !== current.revision)
        return Promise.reject(
          new OperationError('conflict', 'source_subscription_stale'),
        );
      current = {revision: current.revision + 1, subscriptions};
      return Promise.resolve({outcome: 'applied', value: current});
    },
  );
  const unused = (): never => {
    throw new Error('Unexpected capture dependency');
  };
  const service = new AgentCaptureService(WORKSPACE, {
    get blobStore() {
      return unused();
    },
    get evidence() {
      return unused();
    },
    get evidenceRead() {
      return unused();
    },
    subscriptions: {list, replace, runNow: unused, runDue: unused},
  });
  return {
    service,
    list,
    replace,
    current: () => current,
    set(value: ReviewSourceSubscriptionPreferences) {
      current = value;
    },
  };
}

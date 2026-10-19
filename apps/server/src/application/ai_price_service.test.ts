import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AiPriceService} from './ai_price_service.js';
import {priceAwareFetch} from '../platform/ai/price_aware_fetch.js';
import {ExecutionAuthority} from './execution_authority.js';
import {
  aiPriceWindow,
  DEFAULT_AI_PRICE_POLICY,
  AI_PRICE_WAIT,
} from '../modules/processing/ai_price_policy.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {patchReviewPreferences} from '../storage/review_preferences_store.js';

const W = '00000000-0000-4000-8000-000000000001';
const provider = 'deepseek-responses-v1';
const enabled = {revision: 1, enabled: true};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, {recursive: true, force: true});
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-price-test-'));
  roots.push(root);
  const store = new LocalReviewPreferencesStore(root);
  let now = new Date('2026-09-14T00:59:59.999Z');
  const service = new AiPriceService(W, store, provider, () => now);
  return {
    store,
    service,
    clock: (text: string) => {
      now = new Date(text);
    },
  };
}
describe('DeepSeek price timing', () => {
  it.each([
    ['2026-09-14T00:59:59.999Z', false, null],
    ['2026-09-14T01:00:00Z', true, '2026-09-14T04:00:00.000Z'],
    ['2026-09-14T03:59:59.999Z', true, '2026-09-14T04:00:00.000Z'],
    ['2026-09-14T04:00:00Z', false, null],
    ['2026-09-14T05:59:59.999Z', false, null],
    ['2026-09-14T06:00:00Z', true, '2026-09-14T10:00:00.000Z'],
    ['2026-09-14T09:59:59.999Z', true, '2026-09-14T10:00:00.000Z'],
    ['2026-09-14T10:00:00Z', false, null],
    ['2026-09-18T06:00:00Z', true, '2026-09-18T10:00:00.000Z'],
    ['2026-09-19T01:00:00Z', false, null],
    ['2026-09-20T06:00:00Z', false, null],
    ['2026-09-20T16:00:00Z', false, null],
  ])('uses exact Beijing boundaries at %s', (text, blocked, nextAllowedAt) => {
    expect(aiPriceWindow(enabled, provider, new Date(text))).toMatchObject({
      blocked,
      nextAllowedAt,
    });
  });
  it('does not apply an enabled DeepSeek policy to other providers or the off baseline', () => {
    const now = new Date('2026-09-14T01:00:00Z');
    expect(aiPriceWindow(enabled, 'openai-responses-v1', now).blocked).toBe(
      false,
    );
    expect(aiPriceWindow(DEFAULT_AI_PRICE_POLICY, provider, now).blocked).toBe(
      false,
    );
  });
  it('persists with CAS, preserves unrelated preferences, and refuses external-agent changes', async () => {
    const f = fixture(),
      owner = ExecutionAuthority.owner(W);
    await f.store.update(W, (current) => ({
      next: patchReviewPreferences(current, {quickTags: ['Synthetic']}),
      result: null,
    }));
    await f.service.save(owner, {revision: 0, enabled: true});
    expect((await f.store.load(W)).quickTags).toEqual(['Synthetic']);
    expect(
      (await new AiPriceService(W, f.store, provider).status()).policy,
    ).toEqual(enabled);
    await expect(
      f.service.save(owner, {revision: 0, enabled: false}),
    ).rejects.toMatchObject({code: 'stale_ai_price_policy'});
    await expect(
      f.service.save(
        ExecutionAuthority.agent(W, 'synthetic-agent', ['processing.read']),
        {revision: 1, enabled: false},
      ),
    ).rejects.toMatchObject({code: 'ai_price_owner_required'});
  });
  it('checks immediately before each network dispatch and leaves an in-flight request alone', async () => {
    const f = fixture();
    await f.service.save(ExecutionAuthority.owner(W), {
      revision: 0,
      enabled: true,
    });
    let finish: ((response: Response) => void) | undefined;
    const network = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const fetcher = priceAwareFetch(f.service, network);
    const inflight = fetcher('https://example.invalid/model');
    await vi.waitFor(() => {
      expect(network).toHaveBeenCalledTimes(1);
    });
    f.clock('2026-09-14T01:00:00Z');
    await expect(
      fetcher('https://example.invalid/model'),
    ).rejects.toMatchObject({code: AI_PRICE_WAIT});
    finish?.(new Response('synthetic'));
    expect(await (await inflight).text()).toBe('synthetic');
    expect(network).toHaveBeenCalledTimes(1);
    f.clock('2026-09-14T04:00:00Z');
    network.mockResolvedValue(new Response('resumed'));
    expect(await (await fetcher('https://example.invalid/model')).text()).toBe(
      'resumed',
    );
    expect(network).toHaveBeenCalledTimes(2);
  });
});

it('keeps owner permission independent of price settings, persists it, and rejects stale or delegated writes', async () => {
  const f = fixture(),
    owner = ExecutionAuthority.owner(W);
  await f.service.save(owner, {revision: 0, operationsAllowed: false}, true);
  await expect(f.service.assertAllowed()).rejects.toMatchObject({
    code: 'ai_operations_paused',
  });
  await f.service.save(owner, {revision: 1, enabled: true});
  const status = await new AiPriceService(
    W,
    f.store,
    'openai-responses-v1',
  ).status();
  expect(status.policy.operationsAllowed).toBe(false);
  await expect(
    f.service.save(owner, {revision: 1, operationsAllowed: true}, true),
  ).rejects.toMatchObject({code: 'stale_ai_price_policy'});
  await expect(
    f.service.save(
      ExecutionAuthority.agent(W, 'synthetic', ['models.use']),
      {revision: 2, operationsAllowed: true},
      true,
    ),
  ).rejects.toMatchObject({code: 'ai_price_owner_required'});
  await f.service.save(owner, {revision: 2, operationsAllowed: true}, true);
  f.clock('2026-09-14T01:00:00Z');
  await expect(f.service.assertAllowed()).rejects.toMatchObject({
    code: AI_PRICE_WAIT,
  });
  expect((await f.service.status()).policy.enabled).toBe(true);
});

it('saves bounded execution settings independently and preserves them through price and permission changes', async () => {
  const f = fixture(),
    owner = ExecutionAuthority.owner(W);
  expect(await f.service.executionSettings()).toEqual({
    maxConcurrentRequests: 1,
    automaticRetryLimit: 0,
  });
  await f.service.save(
    owner,
    {revision: 0, maxConcurrentRequests: 3, automaticRetryLimit: 2},
    'execution',
  );
  await f.service.save(owner, {revision: 1, enabled: true});
  await f.service.save(owner, {revision: 2, operationsAllowed: false}, true);
  expect((await f.service.status()).policy).toEqual({
    revision: 3,
    enabled: true,
    operationsAllowed: false,
    maxConcurrentRequests: 3,
    automaticRetryLimit: 2,
  });
  for (const change of [
    {maxConcurrentRequests: 0},
    {maxConcurrentRequests: 5},
    {automaticRetryLimit: 3},
    {automaticRetryLimit: -1},
  ]) {
    await expect(
      f.service.save(
        owner,
        {
          revision: 3,
          maxConcurrentRequests: 1,
          automaticRetryLimit: 0,
          ...change,
        },
        'execution',
      ),
    ).rejects.toMatchObject({code: 'invalid_ai_price_policy'});
  }
  await expect(
    f.service.save(
      owner,
      {revision: 2, maxConcurrentRequests: 1, automaticRetryLimit: 0},
      'execution',
    ),
  ).rejects.toMatchObject({code: 'stale_ai_price_policy'});
  await expect(
    f.service.save(
      ExecutionAuthority.agent(W, 'synthetic', ['models.use']),
      {revision: 3, maxConcurrentRequests: 4, automaticRetryLimit: 2},
      'execution',
    ),
  ).rejects.toMatchObject({code: 'ai_price_owner_required'});
});

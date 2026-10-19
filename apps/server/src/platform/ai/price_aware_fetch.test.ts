import {expect, it, vi} from 'vitest';
import {priceAwareFetch} from './price_aware_fetch.js';
it('serializes complete model responses and rechecks permission after waiting', async () => {
  let release: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode('first'));
        controller.close();
      };
    },
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(body))
    .mockResolvedValueOnce(new Response('second'));
  const service = {assertAllowed: vi.fn(() => Promise.resolve())};
  const dispatch = priceAwareFetch(service, fetcher);
  const first = dispatch('https://synthetic.invalid/model');
  const second = dispatch('https://synthetic.invalid/model');
  await vi.waitFor(() => {
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  service.assertAllowed.mockRejectedValueOnce(new Error('permission revoked'));
  const rejected = expect(second).rejects.toThrow('permission revoked');
  release?.();
  expect(await (await first).text()).toBe('first');
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await (await dispatch('https://synthetic.invalid/model')).text()).toBe(
    'second',
  );
});

it('limits parallel responses, applies reductions after in-flight bodies finish, and drops aborted queued requests', async () => {
  let limit = 2;
  const finishes: (() => void)[] = [];
  const network = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            finishes.push(() => {
              controller.enqueue(new TextEncoder().encode('synthetic'));
              controller.close();
            });
          },
        }),
      ),
    ),
  );
  const dispatch = priceAwareFetch(
    {
      assertAllowed: () => Promise.resolve(),
      executionSettings: () => Promise.resolve({maxConcurrentRequests: limit}),
    },
    network,
  );
  const a = dispatch('https://synthetic.invalid/1'),
    b = dispatch('https://synthetic.invalid/2');
  const c = dispatch('https://synthetic.invalid/3');
  const abort = new AbortController();
  const d = dispatch('https://synthetic.invalid/4', {signal: abort.signal});
  const rejected = expect(d).rejects.toThrow();
  await vi.waitFor(() => {
    expect(network).toHaveBeenCalledTimes(2);
  });
  limit = 1;
  abort.abort();
  finishes[0]?.();
  await a;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(network).toHaveBeenCalledTimes(2);
  finishes[1]?.();
  await b;
  await vi.waitFor(() => {
    expect(network).toHaveBeenCalledTimes(3);
  });
  finishes[2]?.();
  await c;
  await rejected;
  expect(network).toHaveBeenCalledTimes(3);
});

it.each([408, 429, 500, 502, 503, 504])(
  'classifies HTTP %d as transient without issuing an extra request',
  async (status) => {
    const network = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('synthetic rejection', {status})),
    );
    const dispatch = priceAwareFetch(
      {assertAllowed: () => Promise.resolve()},
      network,
    );
    await expect(
      dispatch('https://example.invalid/model'),
    ).rejects.toMatchObject({code: 'ai_provider_unavailable'});
    expect(network).toHaveBeenCalledTimes(1);
  },
);
it('keeps HTTP credential rejection outside automatic transient recovery', async () => {
  const dispatch = priceAwareFetch(
    {assertAllowed: () => Promise.resolve()},
    () => Promise.resolve(new Response('synthetic rejection', {status: 401})),
  );
  expect((await dispatch('https://example.invalid/model')).status).toBe(401);
});

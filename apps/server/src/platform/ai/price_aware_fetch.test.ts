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

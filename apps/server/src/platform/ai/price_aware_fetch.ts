/** One local model request at a time; check price and permission after waiting. */
export function priceAwareFetch(
  service: {assertAllowed(): Promise<void>},
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  let tail: Promise<void> = Promise.resolve();
  return async (input, init) => {
    await service.assertAllowed();
    const request = tail.then(async () => {
      init?.signal?.throwIfAborted();
      await service.assertAllowed();
      const response = await fetcher(input, init);
      if (!response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
    tail = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  };
}

/** Recheck the selected provider's price policy immediately before dispatch. */
export function priceAwareFetch(
  service: {assertAllowed(): Promise<void>},
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    await service.assertAllowed();
    return fetcher(input, init);
  };
}

import {OperationError} from '../../application/operation_error.js';
import {AiWorkQueue} from '../../application/ai_work_queue.js';
import type {ModelUsageJournal} from './model_usage_journal.js';
/** The slot remains occupied until the response body is received in full. */
export function priceAwareFetch(
  service: {
    assertAllowed(): Promise<void>;
    executionSettings?: () => Promise<{maxConcurrentRequests: number}>;
  },
  fetcher: typeof fetch = globalThis.fetch,
  usage?: ModelUsageJournal,
): typeof fetch {
  const queue = new AiWorkQueue(
    async () =>
      (await service.executionSettings?.())?.maxConcurrentRequests ?? 1,
  );
  return async (input, init) => {
    await service.assertAllowed();
    return queue.run(async () => {
      init?.signal?.throwIfAborted();
      await service.assertAllowed();
      const ticket = await usage?.reserve(
        typeof init?.body === 'string' ? init.body : '',
      );
      let response: Response;
      let body: ArrayBuffer | undefined;
      try {
        response = await fetcher(input, init);
        if (response.body) body = await response.arrayBuffer();
      } catch (error) {
        if (ticket) await usage?.settle(ticket).catch(() => undefined);
        throw error;
      }
      // The reservation is already durable. A journal failure retains that
      // conservative charge; never discard a paid response and repeat the work.
      if (ticket)
        await usage
          ?.settle(
            ticket,
            response.status,
            body === undefined ? undefined : new Uint8Array(body),
          )
          .catch(() => undefined);
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new OperationError('rejected', 'ai_provider_unavailable');
      }
      if (body === undefined) return response;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
  };
}

import {expect, it, vi} from 'vitest';
import {aiPriceCommand} from './ai_price_client.js';

it.each([null, {}, {result: []}, {result: {policy: null}}])(
  'rejects malformed price settings without passing unusable state to the page',
  async (value) => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify(value))),
    );
    await expect(aiPriceCommand('ai_price_status')).rejects.toThrow(
      'ai_price_unavailable',
    );
  },
);

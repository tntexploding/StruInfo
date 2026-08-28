import {describe, expect, it, vi} from 'vitest';

import {
  decodePublicWebUrl,
  WebSourceConnector,
  WEB_SOURCE_CONNECTOR_ID,
} from './web_source_connector.js';

const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';

describe('WebSourceConnector', () => {
  it('reads only explicit same-origin pages, extracts reading content and reuses validators', async () => {
    const calls: {url: string; headers: Headers}[] = [];
    let round = 0;
    const fetcher = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        calls.push({url, headers: new Headers(init?.headers)});
        if (round >= 2)
          return Promise.resolve(new Response(null, {status: 304}));
        round += 1;
        const suffix = url.endsWith('/about') ? 'About' : 'Article';
        return Promise.resolve(
          new Response(
            `<!doctype html><html><head><title>${suffix}</title></head><body><nav>Skip navigation</nav><main><h1>${suffix}</h1><p>Synthetic body.</p><script>skip()</script></main></body></html>`,
            {
              status: 200,
              headers: {
                'content-type': 'text/html; charset=utf-8',
                etag: `"${suffix.toLowerCase()}-1"`,
                'last-modified': 'Wed, 27 Aug 2026 08:00:00 GMT',
              },
            },
          ),
        );
      },
    );
    const connector = new WebSourceConnector({
      fetch: fetcher,
      resolveAddresses: () => Promise.resolve(['203.0.113.10']),
    });

    const first = await connector.read({
      subscriptionId: SUBSCRIPTION_ID,
      configuration: {
        pageUrl: 'https://example.invalid/articles',
        additionalPaths: ['/about'],
      },
    });
    expect(connector.connectorId).toBe(WEB_SOURCE_CONNECTOR_ID);
    expect(connector.descriptor).toEqual({
      displayName: '受限网页',
      origin: 'builtin',
      configurationMode: 'internal',
    });
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('expected changed result');
    expect(first.documents).toHaveLength(2);
    expect(first.documents.map((document) => document.canonicalUri)).toEqual([
      'https://example.invalid/articles',
      'https://example.invalid/about',
    ]);
    expect(new TextDecoder().decode(first.documents[0]?.sourceUtf8)).toContain(
      'Synthetic body.',
    );
    expect(
      new TextDecoder().decode(first.documents[0]?.sourceUtf8),
    ).not.toContain('Skip navigation');
    expect(
      new TextDecoder().decode(first.documents[0]?.rawSourceBytes),
    ).toContain('<script>skip()</script>');

    const second = await connector.read({
      subscriptionId: SUBSCRIPTION_ID,
      configuration: {
        pageUrl: 'https://example.invalid/articles',
        additionalPaths: ['/about'],
      },
      previousCursor: first.cursor,
    });
    expect(second.status).toBe('unchanged');
    expect(calls).toHaveLength(4);
    expect(calls[2]?.headers.get('if-none-match')).toBe('"article-1"');
    expect(calls[3]?.headers.get('if-none-match')).toBe('"about-1"');
  });

  it('rejects non-public, cross-origin and redirecting page requests', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {location: 'https://other.invalid/page'},
        }),
      ),
    );
    const connector = new WebSourceConnector({
      fetch: fetcher,
      resolveAddresses: () => Promise.resolve(['203.0.113.10']),
    });
    await expect(
      connector.read({
        subscriptionId: SUBSCRIPTION_ID,
        configuration: {
          pageUrl: 'https://example.invalid/page',
          additionalPaths: ['//other.invalid/page'],
        },
      }),
    ).rejects.toMatchObject({
      code: 'connector_result_invalid',
    });
    await expect(
      connector.read({
        subscriptionId: SUBSCRIPTION_ID,
        configuration: {
          pageUrl: 'https://example.invalid/page',
          additionalPaths: [],
        },
      }),
    ).rejects.toMatchObject({
      code: 'connector_result_invalid',
    });
    const local = new WebSourceConnector({
      fetch: fetcher,
      resolveAddresses: () => Promise.resolve(['127.0.0.1']),
    });
    await expect(
      local.read({
        subscriptionId: SUBSCRIPTION_ID,
        configuration: {
          pageUrl: 'https://example.invalid/page',
          additionalPaths: [],
        },
      }),
    ).rejects.toMatchObject({
      code: 'connector_result_invalid',
    });
  });

  it('accepts only trimmed credential-free public HTTPS URLs', () => {
    expect(decodePublicWebUrl('https://example.invalid/page')?.toString()).toBe(
      'https://example.invalid/page',
    );
    expect(decodePublicWebUrl(' http://example.invalid/page')).toBeUndefined();
    expect(
      decodePublicWebUrl('https://user@example.invalid/page'),
    ).toBeUndefined();
    expect(
      decodePublicWebUrl('https://example.invalid/page#fragment'),
    ).toBeUndefined();
  });
});

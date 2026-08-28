import {describe, expect, it, vi} from 'vitest';

import type {SourceConnectorError} from '../../modules/subscriptions/index.js';
import {
  RssAtomSourceConnector,
  RSS_ATOM_SOURCE_CONNECTOR_ID,
  decodePublicFeedUrl,
} from './rss_atom_source_connector.js';

const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const FEED_URL = 'https://example.invalid/feed.xml';

describe('RssAtomSourceConnector', () => {
  it('projects RSS items and reuses conditional request metadata', async () => {
    const requests: RequestInit[] = [];
    const feed = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0"><channel><title>Synthetic feed</title><item>',
      '<guid>synthetic-item-1</guid><title>Useful &amp; bounded</title>',
      '<link>https://example.invalid/items/1</link>',
      '<pubDate>Tue, 25 Aug 2026 08:00:00 GMT</pubDate>',
      '<description><![CDATA[<article><p>First <strong>entry</strong>.</p>',
      '<script>not retained</script></article>]]></description>',
      '</item></channel></rss>',
    ].join('');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        requests.push(init ?? {});
        return Promise.resolve(
          new Response(feed, {
            status: 200,
            headers: {
              'content-type': 'application/rss+xml; charset=utf-8',
              etag: '"synthetic-v1"',
              'last-modified': 'Tue, 25 Aug 2026 08:00:00 GMT',
            },
          }),
        );
      })
      .mockImplementationOnce((_input, init) => {
        requests.push(init ?? {});
        return Promise.resolve(new Response(null, {status: 304}));
      });
    const connector = connectorWith(fetcher, '203.0.113.10');

    expect(connector.connectorId).toBe(RSS_ATOM_SOURCE_CONNECTOR_ID);
    const first = await connector.read(request());
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('expected changed result');
    expect(first.documents).toHaveLength(1);
    expect(first.documents[0]).toMatchObject({
      externalId: 'synthetic-item-1',
      canonicalUri: 'https://example.invalid/items/1',
      mediaType: 'application/rss+xml',
      profile: 'commonmark-v1',
      publication: {
        inferred: false,
        instant: '2026-08-25T08:00:00.000Z',
        precision: 'second',
      },
    });
    const markdown = new TextDecoder().decode(first.documents[0]?.sourceUtf8);
    expect(markdown).toContain('# Useful & bounded');
    expect(markdown).toContain('First entry.');
    expect(markdown).not.toContain('not retained');
    expect(first.documents[0]?.rawSourceBytes).toEqual(
      new TextEncoder().encode(feed),
    );

    const second = await connector.read(request(first.cursor));
    expect(second).toEqual({status: 'unchanged', cursor: first.cursor});
    const headers = new Headers(requests[1]?.headers);
    expect(headers.get('if-none-match')).toBe('"synthetic-v1"');
    expect(headers.get('if-modified-since')).toBe(
      'Tue, 25 Aug 2026 08:00:00 GMT',
    );
  });

  it('returns only new or revised Atom items in the cursor window', async () => {
    const initial = atomFeed([
      atomEntry('synthetic-1', 'First', 'Alpha'),
      atomEntry('synthetic-2', 'Second', 'Beta'),
    ]);
    const revised = atomFeed([
      atomEntry('synthetic-3', 'Third', 'Gamma', 'html'),
      atomEntry('synthetic-1', 'First revised', 'Alpha 2'),
      atomEntry('synthetic-2', 'Second', 'Beta'),
    ]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(xmlResponse(initial, 'application/atom+xml'))
      .mockResolvedValueOnce(xmlResponse(revised, 'application/atom+xml'));
    const connector = connectorWith(fetcher, '203.0.113.11');
    const first = await connector.read(request());
    if (first.status !== 'changed') throw new Error('expected initial batch');
    const second = await connector.read(request(first.cursor));
    if (second.status !== 'changed') throw new Error('expected revised batch');

    expect(second.documents.map((document) => document.externalId)).toEqual([
      'synthetic-3',
      'synthetic-1',
    ]);
    expect(new TextDecoder().decode(second.documents[0]?.sourceUtf8)).toContain(
      'Gamma',
    );
  });

  it('fails closed for local targets, declarations and malformed config', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const local = connectorWith(fetcher, '127.0.0.1');
    await expect(local.read(request())).rejects.toMatchObject({
      code: 'connector_result_invalid',
    } satisfies Partial<SourceConnectorError>);
    expect(fetcher).not.toHaveBeenCalled();

    const declared = connectorWith(
      () =>
        Promise.resolve(
          xmlResponse(
            '<!DOCTYPE rss><rss><channel><item><title>x</title></item></channel></rss>',
            'application/rss+xml',
          ),
        ),
      '203.0.113.12',
    );
    await expect(declared.read(request())).rejects.toMatchObject({
      code: 'connector_result_invalid',
    } satisfies Partial<SourceConnectorError>);
    await expect(
      declared.read({...request(), configuration: {feedUrl: FEED_URL}}),
    ).rejects.toMatchObject({
      code: 'connector_result_invalid',
    } satisfies Partial<SourceConnectorError>);
  });

  it('bounds streamed bytes and keeps cursor metadata within the host limit', async () => {
    const oversized = connectorWith(
      () =>
        Promise.resolve(
          new Response(new Uint8Array(1024 * 1024 + 1), {
            headers: {'content-type': 'application/rss+xml'},
          }),
        ),
      '203.0.113.13',
    );
    await expect(oversized.read(request())).rejects.toMatchObject({
      code: 'connector_too_large',
    } satisfies Partial<SourceConnectorError>);

    const feed = atomFeed(
      Array.from({length: 20}, (_value, index) =>
        atomEntry(
          `synthetic-${String(index + 1)}`,
          `Entry ${String(index + 1)}`,
          `Body ${String(index + 1)}`,
        ),
      ),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(feed, {
          headers: {
            'content-type': 'application/atom+xml',
            etag: 'x'.repeat(500),
            'last-modified': 'y'.repeat(500),
          },
        }),
      )
      .mockImplementationOnce((_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.has('if-none-match')).toBe(false);
        expect(headers.has('if-modified-since')).toBe(false);
        return Promise.resolve(xmlResponse(feed, 'application/atom+xml'));
      });
    const bounded = connectorWith(fetcher, '203.0.113.14');
    const first = await bounded.read(request());
    expect(first.cursor.length).toBeLessThanOrEqual(2_048);
    await expect(bounded.read(request(first.cursor))).resolves.toEqual({
      status: 'unchanged',
      cursor: first.cursor,
    });
  });

  it('admits only trimmed credential-free HTTPS Feed URLs', () => {
    expect(decodePublicFeedUrl(FEED_URL)?.toString()).toBe(FEED_URL);
    expect(
      decodePublicFeedUrl(' http://example.invalid/feed '),
    ).toBeUndefined();
    expect(
      decodePublicFeedUrl('https://user@example.invalid/feed'),
    ).toBeUndefined();
    expect(
      decodePublicFeedUrl('https://example.invalid/feed#fragment'),
    ).toBeUndefined();
  });
});

function connectorWith(fetcher: typeof fetch, address: string) {
  return new RssAtomSourceConnector({
    fetch: fetcher,
    resolveAddresses: () => Promise.resolve([address]),
  });
}

function request(previousCursor?: string) {
  return Object.freeze({
    subscriptionId: SUBSCRIPTION_ID,
    configuration: Object.freeze({feedUrl: FEED_URL, itemLimit: 20}),
    ...(previousCursor === undefined ? {} : {previousCursor}),
  });
}

function xmlResponse(value: string, contentType: string): Response {
  return new Response(value, {
    status: 200,
    headers: {'content-type': contentType},
  });
}

function atomFeed(entries: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>Synthetic</title>',
    ...entries,
    '</feed>',
  ].join('');
}

function atomEntry(
  id: string,
  title: string,
  content: string,
  type = 'text',
): string {
  return [
    '<entry><id>',
    id,
    '</id><title>',
    title,
    '</title><link rel="alternate" href="https://example.invalid/items/',
    id,
    '" /><updated>2026-08-25T08:00:00Z</updated><content type="',
    type,
    '">',
    type === 'html' ? '&lt;p&gt;' + content + '&lt;/p&gt;' : content,
    '</content></entry>',
  ].join('');
}

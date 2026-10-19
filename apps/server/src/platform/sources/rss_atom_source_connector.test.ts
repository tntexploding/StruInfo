import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import type {EvidenceCaptureRepositoryRequest} from '../../modules/evidence/index.js';
import {
  importSourceConnectorDocuments,
  MAX_SOURCE_CONNECTOR_DOCUMENT_BYTES,
  MAX_SOURCE_CONNECTOR_RAW_BYTES,
  SourceConnectorRegistry,
  type SourceConnectorError,
} from '../../modules/subscriptions/index.js';
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

  it('imports a selected article from a large feed without losing raw evidence', async () => {
    const feed = atomFeed([
      atomEntry('synthetic-selected', 'Selected', 'Complete article.'),
      atomEntry(
        'synthetic-unselected',
        'Unselected',
        'x'.repeat(2 * 1024 * 1024),
      ),
    ]);
    const feedBytes = new TextEncoder().encode(feed);
    expect(feedBytes.byteLength).toBeGreaterThan(
      MAX_SOURCE_CONNECTOR_DOCUMENT_BYTES,
    );
    const registry = new SourceConnectorRegistry([
      connectorWith(
        () => Promise.resolve(xmlResponse(feed, 'application/atom+xml')),
        '203.0.113.10',
      ),
    ]);
    const result = await registry.read(RSS_ATOM_SOURCE_CONNECTOR_ID, {
      ...request(),
      configuration: {feedUrl: FEED_URL, itemLimit: 1},
    });
    if (result.status !== 'changed')
      throw new Error('expected selected article');
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.rawSourceBytes?.byteLength).toBe(
      feedBytes.byteLength,
    );
    expect(new TextDecoder().decode(result.documents[0]?.sourceUtf8)).toContain(
      'Complete article.',
    );
    const blobs = new Map<string, Uint8Array>();
    const captures: EvidenceCaptureRepositoryRequest[] = [];
    const imported = await importSourceConnectorDocuments(
      {
        blobStore: {
          put: (bytes) => {
            const digest = createHash('sha256').update(bytes).digest('hex');
            blobs.set(digest, Uint8Array.from(bytes));
            return Promise.resolve({
              algorithm: 'sha256' as const,
              digest,
              byteLength: bytes.byteLength,
            });
          },
          read: (identity) => {
            const bytes = blobs.get(identity.digest);
            if (bytes === undefined)
              return Promise.reject(new Error('missing synthetic blob'));
            return Promise.resolve(bytes);
          },
        },
        evidenceRepository: {
          saveCapture: (capture) => {
            captures.push(capture);
            return Promise.resolve({status: 'created' as const});
          },
        },
      },
      {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        subscriptionId: SUBSCRIPTION_ID,
        connectorId: RSS_ATOM_SOURCE_CONNECTOR_ID,
        sourceAlias: 'Synthetic feed',
        isPrivate: false,
        capturedAt: '2026-08-27T08:00:00.000Z',
        result,
      },
    );
    expect(imported.status).toBe('complete');
    expect(captures).toHaveLength(1);
    const rawDigest = createHash('sha256').update(feedBytes).digest('hex');
    expect(new TextDecoder().decode(blobs.get(rawDigest))).toBe(feed);
  });

  it('rejects a declared feed length above the raw response limit', async () => {
    const connector = connectorWith(
      () =>
        Promise.resolve(
          new Response('<feed/>', {
            headers: {
              'content-type': 'application/atom+xml',
              'content-length': String(MAX_SOURCE_CONNECTOR_RAW_BYTES + 1),
            },
          }),
        ),
      '203.0.113.10',
    );
    await expect(connector.read(request())).rejects.toMatchObject({
      code: 'connector_too_large',
    });
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

  it.each([false, true])(
    'preserves RSS fields alongside Dublin Core metadata (extension first: %s)',
    async (extensionFirst) => {
      const primary =
        '<title><![CDATA[合成会议记录]]></title><description><![CDATA[<p>完整的合成正文与上下文。</p>]]></description>';
      const extension =
        '<dc:title>Metadata title</dc:title><dc:description>Metadata summary</dc:description>';
      const feed =
        '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><guid>synthetic-namespace</guid>' +
        (extensionFirst ? extension + primary : primary + extension) +
        '<link>https://example.invalid/article</link></item></channel></rss>';
      const connector = connectorWith(
        () => Promise.resolve(xmlResponse(feed, 'application/rss+xml')),
        '203.0.113.10',
      );
      const result = await connector.read(request());
      if (result.status !== 'changed') throw new Error('expected document');
      const document = result.documents[0];
      const text = new TextDecoder().decode(document?.sourceUtf8);
      expect(text).toContain('# 合成会议记录');
      expect(text).toContain('完整的合成正文与上下文。');
      expect(text).not.toContain('Metadata');
      expect(new TextDecoder().decode(document?.rawSourceBytes)).toBe(feed);
      await expect(
        connector.read(request(result.cursor)),
      ).resolves.toMatchObject({status: 'unchanged'});
    },
  );

  it('preserves prefixed Atom titles, links and content', async () => {
    const feed =
      '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:id>synthetic-prefixed</a:id><a:title type="html">First &lt;em&gt;middle&lt;/em&gt; last</a:title><a:link href="https://example.invalid/prefixed"/><a:content type="html">&lt;p&gt;Synthetic complete body.&lt;/p&gt;</a:content></a:entry></a:feed>';
    const result = await connectorWith(
      () => Promise.resolve(xmlResponse(feed, 'application/atom+xml')),
      '203.0.113.10',
    ).read(request());
    if (result.status !== 'changed') throw new Error('expected document');
    expect(result.documents[0]?.canonicalUri).toBe(
      'https://example.invalid/prefixed',
    );
    expect(new TextDecoder().decode(result.documents[0]?.sourceUtf8)).toContain(
      '# First middle last',
    );
    expect(new TextDecoder().decode(result.documents[0]?.sourceUtf8)).toContain(
      'Synthetic complete body.',
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
          new Response(new Uint8Array(MAX_SOURCE_CONNECTOR_RAW_BYTES + 1), {
            headers: {
              'content-type': 'application/rss+xml',
              'content-length': '32',
            },
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

  it.each([
    '<rss version="2.0"><channel><title>Synthetic feed</title></channel></rss>',
    atomFeed([]),
  ])(
    'keeps the previous item window across a valid empty feed',
    async (empty) => {
      const populated = atomFeed([atomEntry('synthetic-1', 'First', 'Alpha')]);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(xmlResponse(populated, 'application/atom+xml'))
        .mockResolvedValueOnce(xmlResponse(empty, 'application/xml'))
        .mockResolvedValueOnce(
          xmlResponse(
            populated.replace('Synthetic', 'Changed feed title'),
            'application/atom+xml',
          ),
        );
      const connector = connectorWith(fetcher, '203.0.113.15');
      const first = await connector.read(request());
      if (first.status !== 'changed') throw new Error('expected initial batch');
      const second = await connector.read(request(first.cursor));
      expect(second.status).toBe('unchanged');
      const third = await connector.read(request(second.cursor));
      expect(third.status).toBe('unchanged');
      await expect(
        connectorWith(
          () => Promise.resolve(xmlResponse(empty, 'application/xml')),
          '203.0.113.15',
        ).read(request()),
      ).resolves.toMatchObject({status: 'unchanged'});
    },
  );

  it('projects CDATA and Atom text constructs into plain ordered titles', async () => {
    const feed = [
      '<rss version="2.0"><channel><item><guid>synthetic-cdata</guid>',
      '<title><![CDATA[Alpha <em>Beta</em> &amp; Gamma]]></title>',
      '<description>Body</description></item></channel></rss>',
    ].join('');
    const atom = atomFeed([
      '<entry><id>synthetic-xhtml</id><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Alpha <em>Beta</em> Gamma</div></title><content>Body</content></entry>',
      '<entry><id>synthetic-html</id><title type="html">Alpha &lt;em&gt;Beta&lt;/em&gt; &amp;amp; Gamma</title><content>Body</content></entry>',
      '<entry><id>synthetic-text</id><title type="text">Literal &lt;em&gt; &amp;amp; text</title><content>Body</content></entry>',
    ]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(xmlResponse(feed, 'application/rss+xml'))
      .mockResolvedValueOnce(xmlResponse(atom, 'application/atom+xml'));
    const connector = connectorWith(fetcher, '203.0.113.16');
    const rss = await connector.read(request());
    const atomResult = await connector.read(request());
    if (rss.status !== 'changed' || atomResult.status !== 'changed') {
      throw new Error('expected projected titles');
    }
    expect(new TextDecoder().decode(rss.documents[0]?.sourceUtf8)).toContain(
      '# Alpha Beta & Gamma',
    );
    expect(
      atomResult.documents.map(
        (document) =>
          new TextDecoder().decode(document.sourceUtf8).split('\n')[0],
      ),
    ).toEqual([
      '# Alpha Beta Gamma',
      '# Alpha Beta & Gamma',
      '# Literal \\<em\\> &amp; text',
    ]);
    expect(rss.documents[0]?.rawSourceBytes).toEqual(
      new TextEncoder().encode(feed),
    );
  });

  it('keeps the request deadline active while the response body is streaming', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, milliseconds);
      return controller.signal;
    });
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<rss>'));
          requestSignal?.addEventListener(
            'abort',
            () => {
              controller.error(requestSignal?.reason);
            },
            {once: true},
          );
        },
      });
      return Promise.resolve(
        new Response(body, {headers: {'content-type': 'application/rss+xml'}}),
      );
    });
    try {
      const pending = connectorWith(fetcher, '203.0.113.17').read(request());
      const outcome = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(requestSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(requestSignal?.aborted).toBe(true);
      await expect(outcome).resolves.toMatchObject({
        code: 'connector_unavailable',
      });
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it.each([
    '<rss><channel>',
    '<unrelated><title>Not a feed</title></unrelated>',
    '<rss><channel><item /></channel></rss>',
  ])('rejects malformed or unsupported feed content', async (feed) => {
    const connector = connectorWith(
      () => Promise.resolve(xmlResponse(feed, 'application/xml')),
      '203.0.113.18',
    );
    await expect(connector.read(request())).rejects.toMatchObject({
      code: 'connector_result_invalid',
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

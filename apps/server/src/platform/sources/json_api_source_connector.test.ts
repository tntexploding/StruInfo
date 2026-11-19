import {describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';

import type {SourceConnectorError} from '../../modules/subscriptions/index.js';
import {
  JsonApiSourceConnector,
  JSON_API_SOURCE_CONNECTOR_ID,
  decodePublicJsonApiUrl,
} from './json_api_source_connector.js';

const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://api.example.invalid/entries';

describe('JsonApiSourceConnector', () => {
  it('resumes a burst at stable record boundaries, including arrivals while catching up', async () => {
    let latest = 3;
    let fail = false;
    const fetcher = vi.fn<typeof fetch>((input) => {
      if (fail) return Promise.reject(new Error('offline'));
      const before = Number(
        new URL(requestUrl(input)).searchParams.get('before') ?? latest + 1,
      );
      const ids = Array.from(
        {length: Math.max(0, Math.min(latest, before - 1))},
        (_, n) => Math.min(latest, before - 1) - n,
      ).slice(0, 3);
      return Promise.resolve(
        jsonResponse(
          JSON.stringify(
            ids.map((id) => ({
              id,
              title: `Update ${String(id)}`,
              body: `Content ${String(id)}`,
            })),
          ),
        ),
      );
    });
    const config = pollingConfiguration();
    const first = await connectorWith(fetcher).read(request(undefined, config));
    expect(
      first.status === 'changed' && first.documents.map((d) => d.externalId),
    ).toEqual(['3', '2', '1']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    latest = 11;
    const burst = await connectorWith(fetcher).read(
      request(first.cursor, config),
    );
    expect(burst.hasMore).toBe(true);
    expect(
      burst.status === 'changed' && burst.documents.map((d) => d.externalId),
    ).toEqual(['11', '10', '9']);
    expect(burst.cursor.length).toBeLessThanOrEqual(2048);
    fail = true;
    await expect(
      connectorWith(fetcher).read(request(burst.cursor, config)),
    ).rejects.toMatchObject({code: 'connector_unavailable'});
    fail = false;
    latest = 12;
    const next = await connectorWith(fetcher).read(
      request(burst.cursor, config),
    );
    expect(next.hasMore).toBe(true);
    expect(
      next.status === 'changed' && next.documents.map((d) => d.externalId),
    ).toEqual(['8', '7', '6']);
    const last = await connectorWith(fetcher).read(
      request(next.cursor, config),
    );
    expect(last.hasMore).toBeUndefined();
    expect(
      last.status === 'changed' && last.documents.map((d) => d.externalId),
    ).toEqual(['5', '4']);
    const current = await connectorWith(fetcher).read(
      request(last.cursor, config),
    );
    expect(
      current.status === 'changed' &&
        current.documents.map((d) => d.externalId),
    ).toEqual(['12']);
    expect(
      (await connectorWith(fetcher).read(request(current.cursor, config)))
        .status,
    ).toBe('unchanged');
  });
  it('continues numbered news pages with Ajax headers until the previous receipt', async () => {
    let latest = 3;
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(new Headers(init?.headers).get('X-Requested-With')).toBe(
        'XMLHttpRequest',
      );
      const page = Number(
        new URL(requestUrl(url)).searchParams.get('page') ?? 1,
      );
      const ids = Array.from({length: latest}, (_, i) => latest - i).slice(
        (page - 1) * 3,
        page * 3,
      );
      return Promise.resolve(
        jsonResponse(
          JSON.stringify({
            items: ids.map((id) => ({
              id,
              title: `News ${String(id)}`,
              body: 'A complete event.',
            })),
            next: page + 1,
          }),
        ),
      );
    });
    const config = {
      ...pollingConfiguration(),
      recordsPath: 'items',
      requestAsAjax: true,
      pollingCursor: {queryParameter: 'page', responsePath: 'next'},
    };
    const connector = connectorWith(fetcher);
    const first = await connector.read(request(undefined, config));
    latest = 8;
    const next = await connector.read(request(first.cursor, config));
    expect(
      next.status === 'changed' && next.documents.map((d) => d.externalId),
    ).toEqual(['8', '7', '6']);
    expect(next.hasMore).toBe(true);
    const end = await connector.read(request(next.cursor, config));
    expect(
      end.status === 'changed' && end.documents.map((d) => d.externalId),
    ).toEqual(['5', '4']);
    expect(end.hasMore).toBeUndefined();
  });
  it('keeps a missing checkpoint visible instead of treating a truncated upstream list as complete', async () => {
    let rows = [{id: 1, title: 'One', body: 'Original'}];
    const connector = connectorWith(
      vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse(JSON.stringify(rows))),
      ),
    );
    const config = pollingConfiguration();
    const first = await connector.read(request(undefined, config));
    rows = [];
    await expect(
      connector.read(request(first.cursor, config)),
    ).rejects.toMatchObject({code: 'connector_result_invalid'});
  });
  it('uses public query checksums, explicit local time and skips paid previews', async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = new URL(requestUrl(input));
      const signature = url.searchParams.get('sign');
      url.searchParams.delete('sign');
      const serialized = [...url.searchParams]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      expect(signature).toBe(
        createHash('md5')
          .update(createHash('sha1').update(serialized).digest('hex'))
          .digest('hex'),
      );
      return Promise.resolve(
        jsonResponse(
          JSON.stringify([
            {id: 2, title: 'Paid preview', body: '', paid: 1},
            {
              id: 1,
              title: 'Public update',
              body: 'Complete text',
              time: '2026-11-14T17:30:00',
              paid: 0,
            },
          ]),
        ),
      );
    });
    const result = await connectorWith(fetcher).read(
      request(undefined, {
        ...pollingConfiguration(),
        endpointUrl: ENDPOINT + '?app=web',
        querySignature: {algorithm: 'sha1_md5', parameter: 'sign'},
        timeZoneOffset: '+08:00',
        publishedAtPath: 'time',
        paidContentPath: 'paid',
      }),
    );
    expect(result.status === 'changed' && result.documents).toMatchObject([
      {externalId: '1', publication: {instant: '2026-11-14T09:30:00.000Z'}},
    ]);
  });
  it('reads unsigned bulletin JSON with request time, Unix dates and stable article links', async () => {
    let views = 1;
    const fetcher = vi.fn<typeof fetch>((url) => {
      expect(
        Number(new URL(requestUrl(url)).searchParams.get('lastTime')),
      ).toBeGreaterThan(1_700_000_000);
      return Promise.resolve(
        jsonResponse(
          JSON.stringify({
            items: [
              {
                id: 'bulletin-1',
                title: '',
                content: '<p>Complete bulletin.</p>',
                published: 1_700_000_000,
                views: views++,
              },
            ],
          }),
        ),
      );
    });
    const connector = connectorWith(fetcher);
    const config = {
      endpointUrl: ENDPOINT,
      recordsPath: 'items',
      externalIdPath: 'id',
      titlePath: 'title',
      bodyPath: 'content',
      bodyFormat: 'html',
      publishedAtPath: 'published',
      publishedAtFormat: 'unix_seconds',
      canonicalUriTemplate: 'https://example.invalid/articles/{id}',
      requestTimeParameter: 'lastTime',
      versionPath: 'published',
      recordLimit: 20,
      authentication: {kind: 'none'},
    };
    const first = await connector.read(request(undefined, config));
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('fixture');
    expect(first.documents[0]).toMatchObject({
      canonicalUri: 'https://example.invalid/articles/bulletin-1',
      publication: {instant: '2023-11-14T22:13:20.000Z'},
    });
    expect(new TextDecoder().decode(first.documents[0]?.sourceUtf8)).toContain(
      '# Complete bulletin.',
    );
    expect((await connector.read(request(first.cursor, config))).status).toBe(
      'unchanged',
    );
  });
  it('maps bounded records across pages and advances an incremental cursor', async () => {
    const requests: {url: string; headers: Headers}[] = [];
    const firstPage = JSON.stringify({
      data: {
        items: [
          {
            id: 'entry-1',
            title: 'First record',
            content: {body: 'Alpha'},
            url: '/entries/1',
            updated_at: '2026-08-27T08:00:00Z',
          },
        ],
      },
      next_cursor: 'page-2',
      checkpoint: 'checkpoint-1',
    });
    const secondPage = JSON.stringify({
      data: {
        items: [
          {
            id: 'entry-2',
            title: 'Second record',
            content: {body: 'Beta'},
            url: '/entries/2',
            updated_at: '2026-08-27T09:00:00Z',
          },
        ],
      },
      next_cursor: null,
      checkpoint: 'checkpoint-2',
    });
    const emptyPage = JSON.stringify({
      data: {items: []},
      next_cursor: null,
      checkpoint: 'checkpoint-2',
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((input, init) => {
        requests.push({
          url: requestUrl(input),
          headers: new Headers(init?.headers),
        });
        return Promise.resolve(jsonResponse(firstPage));
      })
      .mockImplementationOnce((input, init) => {
        requests.push({
          url: requestUrl(input),
          headers: new Headers(init?.headers),
        });
        return Promise.resolve(jsonResponse(secondPage));
      })
      .mockImplementationOnce((input, init) => {
        requests.push({
          url: requestUrl(input),
          headers: new Headers(init?.headers),
        });
        return Promise.resolve(jsonResponse(emptyPage));
      });
    const connector = connectorWith(fetcher, {
      STRUIINFO_SYNTHETIC_API_TOKEN: 'synthetic-secret',
    });

    expect(connector.connectorId).toBe(JSON_API_SOURCE_CONNECTOR_ID);
    const first = await connector.read(request());
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('expected changed result');
    expect(first.documents).toHaveLength(2);
    expect(first.documents[0]).toMatchObject({
      externalId: 'entry-1',
      canonicalUri: 'https://api.example.invalid/entries/1',
      mediaType: 'application/json',
      publication: {
        inferred: false,
        instant: '2026-08-27T08:00:00.000Z',
        precision: 'second',
      },
    });
    expect(new TextDecoder().decode(first.documents[0]?.sourceUtf8)).toContain(
      '# First record\n\nAlpha',
    );
    expect(first.documents[0]?.rawSourceBytes).toEqual(
      new TextEncoder().encode(firstPage),
    );
    expect(requests[0]?.headers.get('authorization')).toBe(
      'Bearer synthetic-secret',
    );
    expect(requests[1]?.url).toBe(ENDPOINT + '?cursor=page-2');

    const second = await connector.read(request(first.cursor));
    expect(second).toEqual({status: 'unchanged', cursor: first.cursor});
    expect(requests[2]?.url).toBe(ENDPOINT + '?since=checkpoint-2');
  });

  it('uses a mapped version and only returns revised records', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          JSON.stringify({
            items: [
              {id: 1, title: 'One', body: 'Alpha', revision: 1},
              {id: 2, title: 'Two', body: 'Beta', revision: 1},
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          JSON.stringify({
            items: [
              {id: 1, title: 'One', body: 'Alpha revised', revision: 2},
              {id: 2, title: 'Two', body: 'Beta', revision: 1},
            ],
          }),
        ),
      );
    const connector = connectorWith(fetcher);
    const configuration = {
      ...baseConfiguration(),
      recordsPath: 'items',
      bodyPath: 'body',
      versionPath: 'revision',
      pageCursor: undefined,
      incrementalCursor: undefined,
      authentication: {kind: 'none' as const},
    };
    const first = await connector.read(request(undefined, configuration));
    if (first.status !== 'changed') throw new Error('expected first batch');
    const second = await connector.read(request(first.cursor, configuration));
    if (second.status !== 'changed') throw new Error('expected revision');
    expect(second.documents.map((document) => document.externalId)).toEqual([
      '1',
    ]);
  });

  it('fails closed for local targets, missing secrets and unbounded pages', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const local = new JsonApiSourceConnector({
      fetch: fetcher,
      resolveAddresses: () => Promise.resolve(['127.0.0.1']),
    });
    await expect(local.read(request())).rejects.toMatchObject({
      code: 'connector_result_invalid',
    } satisfies Partial<SourceConnectorError>);
    expect(fetcher).not.toHaveBeenCalled();

    const missingSecret = connectorWith(fetcher);
    await expect(missingSecret.read(request())).rejects.toMatchObject({
      code: 'connector_unavailable',
    } satisfies Partial<SourceConnectorError>);

    const pages = connectorWith(
      vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            JSON.stringify({
              data: {items: []},
              next_cursor: 'same-page',
              checkpoint: 'checkpoint',
            }),
          ),
        ),
      ),
      {STRUIINFO_SYNTHETIC_API_TOKEN: 'synthetic-secret'},
    );
    await expect(pages.read(request())).rejects.toMatchObject({
      code: 'connector_too_large',
    } satisfies Partial<SourceConnectorError>);
  });

  it('admits only credential-free HTTPS endpoints', () => {
    expect(decodePublicJsonApiUrl(ENDPOINT)?.toString()).toBe(ENDPOINT);
    expect(
      decodePublicJsonApiUrl(' http://api.example.invalid/entries '),
    ).toBeUndefined();
    expect(
      decodePublicJsonApiUrl('https://user@api.example.invalid/entries'),
    ).toBeUndefined();
    expect(
      decodePublicJsonApiUrl('https://api.example.invalid/entries#records'),
    ).toBeUndefined();
  });
});

function pollingConfiguration() {
  return {
    endpointUrl: ENDPOINT,
    recordsPath: '',
    externalIdPath: 'id',
    titlePath: 'title',
    bodyPath: 'body',
    recordLimit: 4,
    pollingCursor: {queryParameter: 'before', recordPath: 'id'},
    authentication: {kind: 'none'},
  };
}

function connectorWith(
  fetcher: typeof fetch,
  environment: Readonly<Record<string, string>> = {},
) {
  return new JsonApiSourceConnector({
    fetch: fetcher,
    resolveAddresses: () => Promise.resolve(['203.0.113.20']),
    readEnvironment: (variable) => environment[variable],
  });
}

function request(
  previousCursor?: string,
  configuration: Readonly<Record<string, unknown>> = baseConfiguration(),
) {
  return Object.freeze({
    subscriptionId: SUBSCRIPTION_ID,
    configuration,
    ...(previousCursor === undefined ? {} : {previousCursor}),
  });
}

function baseConfiguration() {
  return Object.freeze({
    endpointUrl: ENDPOINT,
    recordsPath: 'data.items',
    externalIdPath: 'id',
    titlePath: 'title',
    bodyPath: 'content.body',
    canonicalUriPath: 'url',
    publishedAtPath: 'updated_at',
    recordLimit: 32,
    pageCursor: Object.freeze({
      queryParameter: 'cursor',
      responsePath: 'next_cursor',
    }),
    incrementalCursor: Object.freeze({
      queryParameter: 'since',
      responsePath: 'checkpoint',
    }),
    authentication: Object.freeze({
      kind: 'bearer_env' as const,
      variable: 'STRUIINFO_SYNTHETIC_API_TOKEN',
    }),
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: {'content-type': 'application/json; charset=utf-8'},
  });
}

import {describe, expect, it, vi} from 'vitest';

import type {SourceConnectorError} from '../../modules/subscriptions/index.js';
import {
  JsonApiSourceConnector,
  JSON_API_SOURCE_CONNECTOR_ID,
  decodePublicJsonApiUrl,
} from './json_api_source_connector.js';

const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://api.example.invalid/entries';

describe('JsonApiSourceConnector', () => {
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

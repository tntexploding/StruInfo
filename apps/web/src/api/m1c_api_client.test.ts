import {describe, expect, it} from 'vitest';

import {
  createM1cApiClient,
  type M1cApiFetch,
  M1cApiClientError,
} from './m1c_api_client.js';

describe('M1cApiClient', () => {
  it('uses only same-base product paths and preserves domain responses', async () => {
    const requests: Readonly<{url: string; init?: RequestInit}>[] = [];
    const fetchImplementation: M1cApiFetch = (input, init) => {
      requests.push({
        url: requestUrl(input),
        ...(init === undefined ? {} : {init}),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({status: 'rejected', issue: {code: 'synthetic'}}),
          {
            status: 422,
            headers: {'content-type': 'application/json; charset=utf-8'},
          },
        ),
      );
    };
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      fetchImplementation,
    );

    const result = await client.search({filters: {}, page: {limit: 25}});

    expect(result).toEqual({
      statusCode: 422,
      body: {status: 'rejected', issue: {code: 'synthetic'}},
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://127.0.0.1:3000/api/v1/search');
    expect(requests[0]?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'POST',
      redirect: 'error',
    });
  });

  it('encodes snapshot identity as one path segment', async () => {
    let requestedUrl = '';
    const client = createM1cApiClient('https://localhost:3000', (input) => {
      requestedUrl = requestUrl(input);
      return Promise.resolve(
        new Response(JSON.stringify({status: 'not_found'}), {
          status: 404,
          headers: {'content-type': 'application/json'},
        }),
      );
    });

    await client.loadEvidenceSnapshot('synthetic/id', {includePrivate: true});

    expect(requestedUrl).toBe(
      'https://localhost:3000/api/v1/evidence/snapshots/synthetic%2Fid?includePrivate=true',
    );
  });

  it('loads the current knowledge revision through one encoded path segment', async () => {
    let requestedUrl = '';
    const client = createM1cApiClient('https://localhost:3000', (input) => {
      requestedUrl = requestUrl(input);
      return Promise.resolve(
        new Response(JSON.stringify({status: 'not_found'}), {
          status: 404,
          headers: {'content-type': 'application/json'},
        }),
      );
    });

    await client.loadKnowledgeItem('synthetic/id', {includePrivate: true});

    expect(requestedUrl).toBe(
      'https://localhost:3000/api/v1/knowledge/items/synthetic%2Fid?includePrivate=true',
    );
  });

  it('uses dedicated export and restore routes without exposing filesystem paths', async () => {
    const requests: Readonly<{url: string; body: unknown}>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        if (typeof init?.body !== 'string') {
          throw new Error('Expected a JSON request body.');
        }
        requests.push({
          url: requestUrl(input),
          body: JSON.parse(init.body),
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'exported',
              fileName: 'synthetic.workspace-bundle.json',
              byteLength: 12,
              blobCount: 0,
              tableCounts: {workspace: 1},
            }),
            {headers: {'content-type': 'application/json'}},
          ),
        );
      },
    );

    await client.exportWorkspaceBundle();
    await client.restoreWorkspaceBundle('synthetic.workspace-bundle.json');

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/workspace-bundles/export',
        body: {},
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/workspace-bundles/restore',
        body: {fileName: 'synthetic.workspace-bundle.json'},
      },
    ]);
  });

  it('loads and saves external review preferences through the local API', async () => {
    const requests: Readonly<{
      url: string;
      method: string | undefined;
      body: BodyInit | null | undefined;
    }>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          method: init?.method,
          body: init?.body,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ok',
              workspaceId: 'synthetic-workspace',
              quickTags: [],
              automaticKeywords: {
                enabled: true,
                includeLinkDomains: false,
                excludedKeywords: [],
              },
              vocabulary: {aliases: [], links: [], knowledgeKinds: []},
            }),
            {headers: {'content-type': 'application/json'}},
          ),
        );
      },
    );

    await client.loadReviewPreferences();
    await client.saveReviewPreferences({
      quickTags: ['实用工具'],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['广告'],
      },
      vocabulary: {
        aliases: [{source: 'Synthetic CLI', canonical: '工具'}],
        links: [],
        knowledgeKinds: [{keyword: 'Synthetic Cover', knowledgeKind: 'work'}],
      },
    });

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/preferences/review',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/preferences/review',
        method: 'PUT',
        body: JSON.stringify({
          quickTags: ['实用工具'],
          automaticKeywords: {
            enabled: true,
            includeLinkDomains: false,
            excludedKeywords: ['广告'],
          },
          vocabulary: {
            aliases: [{source: 'Synthetic CLI', canonical: '工具'}],
            links: [],
            knowledgeKinds: [
              {keyword: 'Synthetic Cover', knowledgeKind: 'work'},
            ],
          },
        }),
      },
    ]);
  });

  it('rejects a stale server without the review-preferences route', async () => {
    const client = createM1cApiClient('http://127.0.0.1:3000/', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message: 'Cannot GET /api/v1/preferences/review',
            error: 'Not Found',
            statusCode: 404,
          }),
          {
            status: 404,
            headers: {'content-type': 'application/json'},
          },
        ),
      ),
    );

    await expect(client.loadReviewPreferences()).rejects.toBeInstanceOf(
      M1cApiClientError,
    );
  });

  it('fails visibly for unsafe configuration, network, or response shapes', async () => {
    expect(() => createM1cApiClient('ftp://localhost/')).toThrow(
      M1cApiClientError,
    );
    const unreachable = createM1cApiClient('http://localhost/', () =>
      Promise.reject(new Error('synthetic network error')),
    );
    await expect(unreachable.workspace()).rejects.toBeInstanceOf(
      M1cApiClientError,
    );

    const invalid = createM1cApiClient('http://localhost/', () =>
      Promise.resolve(
        new Response('not json', {
          status: 200,
          headers: {'content-type': 'text/plain'},
        }),
      ),
    );
    await expect(invalid.workspace()).rejects.toBeInstanceOf(M1cApiClientError);
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

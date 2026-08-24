import {describe, expect, it} from 'vitest';

import {DEFAULT_REVIEW_ASSOCIATION_POLICY} from './m1c_api_contract.js';
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

    const result = await client.searchInformationEntries({text: 'synthetic'});

    expect(result).toEqual({
      statusCode: 422,
      body: {status: 'rejected', issue: {code: 'synthetic'}},
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:3000/api/v1/entries/search',
    );
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

  it('uses narrow Entry, Document navigation, and document-tag routes', async () => {
    const requests: Readonly<{
      url: string;
      method: string | undefined;
      body?: string;
    }>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          method: init?.method,
          ...(typeof init?.body === 'string' ? {body: init.body} : {}),
        });
        return Promise.resolve(
          new Response(JSON.stringify({status: 'ok', items: []}), {
            headers: {'content-type': 'application/json'},
          }),
        );
      },
    );

    await client.materializeInformationEntries({
      snapshotId: 'synthetic-snapshot',
      chunkMode: 'split',
    });
    await client.reviseInformationEntry('synthetic/id', {
      expectedRevision: 1,
    });
    await client.searchInformationEntries({text: 'synthetic'});
    await client.readInformationEntryKnowledgeGraph({
      query: 'synthetic',
      includePrivate: true,
    });
    await client.reviseInformationEntryKnowledgeGraphEdge(
      'synthetic/entry',
      'related/id',
      {
        expectedRevision: 0,
        operation: 'edit',
        label: '相关',
        direction: 'symmetric',
        includePrivate: true,
      },
    );
    await client.rebuildInformationEntryAssociations({includePrivate: true});
    await client.reviseInformationEntryAssociationPolicy({
      expectedRevision: 0,
      contentWeight: 50,
      typeWeight: 25,
      domainWeight: 25,
      threshold: 2_000,
    });
    await client.listInformationEntryAssociations('synthetic/entry', {
      includePrivate: true,
    });
    await client.reviseInformationEntryAssociation(
      'synthetic/entry',
      'related/id',
      {expectedRevision: 0, action: 'block', includePrivate: true},
    );
    await client.listInformationEntryDocuments({includePrivate: true});
    await client.aggregateInformationDocumentTags('synthetic/id', {
      expectedRevision: 0,
    });
    await client.reviseInformationDocumentTags('synthetic/id', {
      expectedRevision: 1,
      tags: ['synthetic'],
    });
    await client.listAiTagProposals('synthetic/entry');
    await client.startAiTagProposal('synthetic/entry', 'synthetic-request');
    await client.acceptAiTagProposal('synthetic/entry', 'synthetic/proposal');
    await client.rejectAiTagProposal('synthetic/entry', 'synthetic/proposal');
    await client.listAiAssociationProposals('synthetic/entry', 'related/id');
    await client.startAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic-association-request',
    );
    await client.acceptAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic/proposal',
    );
    await client.rejectAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic/proposal',
    );
    await client.listProcessingRuns(12);
    await client.cancelProcessingRun('synthetic/run', 3);

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/materialize',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          chunkMode: 'split',
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fid',
        method: 'PUT',
        body: JSON.stringify({expectedRevision: 1}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/search',
        method: 'POST',
        body: JSON.stringify({text: 'synthetic'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/view',
        method: 'POST',
        body: JSON.stringify({
          query: 'synthetic',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          operation: 'edit',
          label: '相关',
          direction: 'symmetric',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/associations/rebuild',
        method: 'POST',
        body: JSON.stringify({includePrivate: true}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/associations/policy',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          contentWeight: 50,
          typeWeight: 25,
          domainWeight: 25,
          threshold: 2_000,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/associations?includePrivate=true',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/associations/related%2Fid',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          action: 'block',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents?includePrivate=true',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents/synthetic%2Fid/tags/aggregate',
        method: 'POST',
        body: JSON.stringify({expectedRevision: 0}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents/synthetic%2Fid/tags',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 1,
          tags: ['synthetic'],
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/start',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-request'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/synthetic%2Fproposal/accept',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/synthetic%2Fproposal/reject',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/start',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-association-request'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/synthetic%2Fproposal/accept',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/synthetic%2Fproposal/reject',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/processing-runs?limit=12',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/processing-runs/synthetic%2Frun/cancel',
        method: 'POST',
        body: JSON.stringify({expectedVersion: 3}),
      },
    ]);
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
              vocabulary: {aliases: []},
              associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
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

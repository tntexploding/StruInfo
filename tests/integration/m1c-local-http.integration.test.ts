import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  OperationalHealthService,
  ReadinessGate,
} from '../../apps/server/src/health/operational_health.js';
import {createNestRuntimeHttpApplication} from '../../apps/server/src/transport/nest_health_listener.js';
import type {
  M1cApiServicePort,
  M1cHttpResult,
} from '../../apps/server/src/transport/m1c_api_service.js';

describe('M1C local HTTP transport', () => {
  let application:
    Awaited<ReturnType<typeof createNestRuntimeHttpApplication>> | undefined;
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await application?.close();
    application = undefined;
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, {force: true, recursive: true})),
    );
  });

  it('serves health and product routes from the same loopback listener', async () => {
    const importedBodies: unknown[] = [];
    const documentBodies: unknown[] = [];
    const manualSplits: unknown[] = [];
    const entrySearches: unknown[] = [];
    const querySyntheses: unknown[] = [];
    const policyWrites: unknown[] = [];
    const api = stubApi({
      importMarkdown(body) {
        importedBodies.push(body);
        return Promise.resolve(result(201, {status: 'created'}));
      },
      importDocument(body) {
        documentBodies.push(body);
        return Promise.resolve(result(201, {status: 'created'}));
      },
      materializeManualInformationEntries(body) {
        manualSplits.push(body);
        return Promise.resolve(result(201, {status: 'created', entries: []}));
      },
      searchInformationEntries(body) {
        entrySearches.push(body);
        return Promise.resolve(result(200, {status: 'ok', items: []}));
      },
      synthesizeInformationEntryQuery(body) {
        querySyntheses.push(body);
        return Promise.resolve(
          result(200, {
            status: 'ok',
            requestId: 'query-synthesis:1',
            answer: 'Synthetic answer.',
          }),
        );
      },
      reviseInformationEntryAssociationPolicy(body) {
        policyWrites.push(body);
        return Promise.resolve(result(200, {status: 'applied'}));
      },
    });
    const gate = new ReadinessGate();
    gate.markInitialized();
    const health = new OperationalHealthService({
      role: 'api',
      gate,
      database: {check: () => Promise.resolve(true)},
    });
    application = await createNestRuntimeHttpApplication({health, api});
    const server = await application.listen(0, '127.0.0.1');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Synthetic HTTP listener did not expose a TCP address.');
    }
    const base = `http://127.0.0.1:${String(address.port)}`;

    const workspaceResponse = await fetch(`${base}/api/v1/workspace`);
    expect(workspaceResponse.status).toBe(200);
    expect(workspaceResponse.headers.get('cache-control')).toBe('no-store');
    await expect(workspaceResponse.json()).resolves.toEqual({
      status: 'ok',
      workspaceId: 'synthetic-workspace',
    });

    const sourceText = `# Synthetic\n\n${'x'.repeat(150_000)}`;
    const importResponse = await fetch(`${base}/api/v1/imports/markdown`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({sourceText}),
    });
    expect(importResponse.status).toBe(201);
    await expect(importResponse.json()).resolves.toEqual({status: 'created'});
    expect(importedBodies).toEqual([{sourceText}]);

    const documentBody = {
      documentFormat: 'html',
      sourceBase64: 'PHRpdGxlPlN5bnRoZXRpYzwvdGl0bGU+',
    };
    const documentResponse = await fetch(`${base}/api/v1/imports/document`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(documentBody),
    });
    expect(documentResponse.status).toBe(201);
    await expect(documentResponse.json()).resolves.toEqual({status: 'created'});
    expect(documentBodies).toEqual([documentBody]);

    const manualSplitBody = {
      snapshotId: '11111111-1111-4111-8111-111111111111',
      includePrivate: false,
      groups: [
        {
          titlePath: 'Synthetic group',
          fragmentIds: ['22222222-2222-4222-8222-222222222222'],
        },
      ],
    };
    const manualSplitResponse = await fetch(
      `${base}/api/v1/entries/materialize/manual`,
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(manualSplitBody),
      },
    );
    expect(manualSplitResponse.status).toBe(201);
    await expect(manualSplitResponse.json()).resolves.toEqual({
      status: 'created',
      entries: [],
    });
    expect(manualSplits).toEqual([manualSplitBody]);

    const entrySearchResponse = await fetch(`${base}/api/v1/entries/search`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({text: 'synthetic', includePrivate: true}),
    });
    expect(entrySearchResponse.status).toBe(200);
    await expect(entrySearchResponse.json()).resolves.toEqual({
      status: 'ok',
      items: [],
    });
    expect(entrySearches).toEqual([{text: 'synthetic', includePrivate: true}]);

    const synthesisBody = {
      requestId: 'query-synthesis:1',
      question: 'What does the public evidence show?',
      query: {text: 'synthetic', includePrivate: false},
    };
    const synthesisResponse = await fetch(
      `${base}/api/v1/entries/search/synthesize`,
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(synthesisBody),
      },
    );
    expect(synthesisResponse.status).toBe(200);
    await expect(synthesisResponse.json()).resolves.toEqual({
      status: 'ok',
      requestId: 'query-synthesis:1',
      answer: 'Synthetic answer.',
    });
    expect(querySyntheses).toEqual([synthesisBody]);

    const policyBody = {
      expectedRevision: 0,
      contentWeight: 50,
      typeWeight: 25,
      domainWeight: 25,
      threshold: 2_000,
    };
    const policyResponse = await fetch(
      `${base}/api/v1/entries/associations/policy`,
      {
        method: 'PUT',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(policyBody),
      },
    );
    expect(policyResponse.status).toBe(200);
    await expect(policyResponse.json()).resolves.toEqual({status: 'applied'});
    expect(policyWrites).toEqual([policyBody]);

    const healthResponse = await fetch(`${base}/health/ready`);
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      status: 'ready',
      role: 'api',
    });
  });

  it('serves the built Web workspace from the API origin', async () => {
    const webRoot = await mkdtemp(join(tmpdir(), 'struinfo-m1c-web-'));
    temporaryRoots.push(webRoot);
    await writeFile(
      join(webRoot, 'index.html'),
      '<!doctype html><title>synthetic M1C workspace</title>',
      'utf8',
    );
    const gate = new ReadinessGate();
    gate.markInitialized();
    const health = new OperationalHealthService({
      role: 'api',
      gate,
      database: {check: () => Promise.resolve(true)},
    });
    application = await createNestRuntimeHttpApplication({
      health,
      api: stubApi(),
      webRoot,
    });
    const server = await application.listen(0, '127.0.0.1');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Synthetic HTTP listener did not expose a TCP address.');
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toContain('synthetic M1C workspace');
  });
});

function stubApi(
  overrides: Partial<M1cApiServicePort> = {},
): M1cApiServicePort {
  return {
    workspace: () =>
      result(200, {status: 'ok', workspaceId: 'synthetic-workspace'}),
    listEvidence: () => Promise.resolve(result(200, {status: 'ok'})),
    loadEvidenceSnapshot: () =>
      Promise.resolve(result(404, {status: 'not_found'})),
    loadReviewPreferences: () =>
      Promise.resolve(result(200, {status: 'ok', quickTags: []})),
    saveReviewPreferences: () =>
      Promise.resolve(result(200, {status: 'ok', quickTags: []})),
    importMarkdown: () => Promise.resolve(result(201, {status: 'created'})),
    importDocument: () => Promise.resolve(result(201, {status: 'created'})),
    materializeInformationEntries: () =>
      Promise.resolve(result(201, {status: 'created'})),
    materializeManualInformationEntries: () =>
      Promise.resolve(result(201, {status: 'created'})),
    reviseInformationEntry: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    searchInformationEntries: () =>
      Promise.resolve(result(200, {status: 'ok', entries: []})),
    synthesizeInformationEntryQuery: () =>
      Promise.resolve(result(503, {status: 'rejected'})),
    readInformationEntryKnowledgeGraph: () =>
      Promise.resolve(result(200, {status: 'ok', candidates: [], graph: null})),
    reviseInformationEntryKnowledgeGraphEdge: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    rebuildInformationEntryAssociations: () =>
      Promise.resolve(result(200, {status: 'rebuilt'})),
    reviseInformationEntryAssociationPolicy: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    listInformationEntryAssociations: () =>
      Promise.resolve(result(200, {status: 'ok', associations: []})),
    reviseInformationEntryAssociation: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    listInformationEntryDocuments: () =>
      Promise.resolve(result(200, {status: 'ok', documents: []})),
    aggregateInformationDocumentTags: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    reviseInformationDocumentTags: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    listAiTagProposals: () =>
      Promise.resolve(result(200, {status: 'ok', proposals: []})),
    startAiTagProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    acceptAiTagProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    rejectAiTagProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    listAiSplitProposals: () =>
      Promise.resolve(result(200, {status: 'ok', proposals: []})),
    startAiSplitProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    acceptAiSplitProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    rejectAiSplitProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    listAiAssociationProposals: () =>
      Promise.resolve(result(200, {status: 'ok', proposals: []})),
    startAiAssociationProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    acceptAiAssociationProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    rejectAiAssociationProposal: () =>
      Promise.resolve(result(409, {status: 'rejected'})),
    listProcessingRuns: () =>
      Promise.resolve(result(200, {status: 'ok', runs: []})),
    cancelProcessingRun: () =>
      Promise.resolve(
        result(200, {
          status: 'cancelled',
          runId: '11111111-1111-4111-8111-111111111111',
          version: 2,
        }),
      ),
    exportWorkspaceBundle: () =>
      Promise.resolve(result(201, {status: 'exported'})),
    restoreWorkspaceBundle: () =>
      Promise.resolve(result(200, {status: 'restored'})),
    ...overrides,
  };
}

function result(statusCode: number, body: unknown): M1cHttpResult {
  return {statusCode, body};
}

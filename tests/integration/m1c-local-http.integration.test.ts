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
    const knowledgeReads: unknown[] = [];
    const api = stubApi({
      importMarkdown(body) {
        importedBodies.push(body);
        return Promise.resolve(result(201, {status: 'created'}));
      },
      loadKnowledgeItem(itemId, includePrivate) {
        knowledgeReads.push({itemId, includePrivate});
        return Promise.resolve(
          result(200, {status: 'ok', item: {itemId, revision: 2}}),
        );
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

    const knowledgeResponse = await fetch(
      `${base}/api/v1/knowledge/items/synthetic-item?includePrivate=true`,
    );
    expect(knowledgeResponse.status).toBe(200);
    await expect(knowledgeResponse.json()).resolves.toEqual({
      status: 'ok',
      item: {itemId: 'synthetic-item', revision: 2},
    });
    expect(knowledgeReads).toEqual([
      {itemId: 'synthetic-item', includePrivate: true},
    ]);

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
    loadCurationState: () => Promise.resolve(result(200, {status: 'ok'})),
    loadReviewPreferences: () =>
      Promise.resolve(result(200, {status: 'ok', quickTags: []})),
    saveReviewPreferences: () =>
      Promise.resolve(result(200, {status: 'ok', quickTags: []})),
    importMarkdown: () => Promise.resolve(result(201, {status: 'created'})),
    putCurationTerm: () => Promise.resolve(result(200, {status: 'applied'})),
    applyCuration: () => Promise.resolve(result(200, {status: 'applied'})),
    applyKnowledgeChangeSet: () =>
      Promise.resolve(result(200, {status: 'applied'})),
    loadKnowledgeItem: () =>
      Promise.resolve(result(404, {status: 'not_found'})),
    search: () => Promise.resolve(result(200, {status: 'ok'})),
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

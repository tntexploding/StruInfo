import {describe, expect, it, vi} from 'vitest';

import type {ImportMarkdownEvidenceInput} from '../evidence/index.js';
import {
  importSourceConnectorDocuments,
  SourceConnectorRegistry,
  type SourceConnectorError,
  type SourceConnectorReadResult,
} from './source_connector.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';

describe('SourceConnectorRegistry', () => {
  it('selects a built-in or plugin adapter and owns its bounded result', async () => {
    const projection = new TextEncoder().encode('# Synthetic item\n');
    const registry = new SourceConnectorRegistry([
      {
        connectorId: 'plugin.example.rss.v1',
        descriptor: Object.freeze({
          displayName: 'Synthetic RSS',
          origin: 'plugin' as const,
          configurationMode: 'external_reference' as const,
        }),
        read: vi.fn(() =>
          Promise.resolve({
            status: 'changed',
            cursor: 'feed-version-2',
            documents: [
              {
                externalId: 'item-1',
                version: 'revision-2',
                canonicalUri: 'https://example.invalid/items/1',
                mediaType: 'application/rss+xml',
                profile: 'commonmark-v1',
                sourceUtf8: projection,
                rawSourceBytes: new TextEncoder().encode(
                  '<item>synthetic</item>',
                ),
                publication: {
                  instant: '2026-08-27T08:00:00.000Z',
                  precision: 'second',
                  sourceText: '2026-08-27T08:00:00Z',
                  inferred: false,
                },
              },
            ],
          }),
        ),
      },
    ]);

    const result = await registry.read('plugin.example.rss.v1', {
      subscriptionId: SUBSCRIPTION_ID,
      configuration: Object.freeze({feed: 'synthetic'}),
    });
    expect(registry.connectorIds()).toEqual(['plugin.example.rss.v1']);
    expect(registry.capabilities()).toEqual([
      {
        connectorId: 'plugin.example.rss.v1',
        displayName: 'Synthetic RSS',
        origin: 'plugin',
        configurationMode: 'external_reference',
      },
    ]);
    expect(result).toMatchObject({
      status: 'changed',
      cursor: 'feed-version-2',
      documents: [{externalId: 'item-1', version: 'revision-2'}],
    });
    projection[0] = 0;
    expect(
      result.status === 'changed'
        ? new TextDecoder().decode(result.documents[0]?.sourceUtf8)
        : '',
    ).toBe('# Synthetic item\n');
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      result.status === 'changed' && Object.isFrozen(result.documents),
    ).toBe(true);
  });

  it('fails closed for missing, duplicate, oversized or malformed adapters', async () => {
    expect(
      () =>
        new SourceConnectorRegistry([
          {connectorId: 'builtin.rss.v1', read: () => Promise.resolve({})},
          {connectorId: 'builtin.rss.v1', read: () => Promise.resolve({})},
        ]),
    ).toThrow(
      expect.objectContaining<Partial<SourceConnectorError>>({
        code: 'connector_duplicate',
      }),
    );
    expect(
      () =>
        new SourceConnectorRegistry([
          {
            connectorId: 'plugin.bad.v1',
            descriptor: {
              displayName: 'Bad adapter',
              origin: 'plugin',
              configurationMode: 'internal',
            },
            read: () => Promise.resolve({}),
          },
        ]),
    ).toThrow(
      expect.objectContaining<Partial<SourceConnectorError>>({
        code: 'connector_result_invalid',
      }),
    );
    expect(
      () =>
        new SourceConnectorRegistry([
          {
            connectorId: 'builtin.forged-plugin.v1',
            descriptor: {
              displayName: 'Wrong namespace',
              origin: 'plugin',
              configurationMode: 'external_reference',
            },
            read: () => Promise.resolve({}),
          },
        ]),
    ).toThrow(
      expect.objectContaining<Partial<SourceConnectorError>>({
        code: 'connector_result_invalid',
      }),
    );

    const registry = new SourceConnectorRegistry([
      {
        connectorId: 'builtin.rss.v1',
        read: () =>
          Promise.resolve({
            status: 'changed',
            cursor: 'cursor',
            documents: [],
          }),
      },
    ]);
    await expect(
      registry.read('builtin.web.v1', {
        subscriptionId: SUBSCRIPTION_ID,
        configuration: {},
      }),
    ).rejects.toMatchObject({code: 'connector_not_available'});
    await expect(
      registry.read('builtin.rss.v1', {
        subscriptionId: SUBSCRIPTION_ID,
        configuration: {},
      }),
    ).rejects.toMatchObject({code: 'connector_result_invalid'});
  });
});

describe('importSourceConnectorDocuments', () => {
  it('maps connector documents into stable remote Evidence identities', async () => {
    const inputs: ImportMarkdownEvidenceInput[] = [];
    const importEvidence = vi.fn(
      (
        _dependencies: unknown,
        input: Readonly<ImportMarkdownEvidenceInput>,
      ) => {
        inputs.push(input);
        return Promise.resolve({
          status: 'created' as const,
          workspaceId: input.workspaceId,
          commandIdempotencyKey: input.commandIdempotencyKey,
          resourceId: input.resource.resourceId,
          snapshotId: input.snapshot.snapshotId,
          structureId: '33333333-3333-4333-8333-333333333333',
          fragmentIds: Object.freeze(['44444444-4444-4444-8444-444444444444']),
          mediaAssetIds: Object.freeze([]),
        });
      },
    );
    const changed: Extract<SourceConnectorReadResult, {status: 'changed'}> =
      Object.freeze({
        status: 'changed',
        cursor: 'cursor-2',
        documents: Object.freeze([
          Object.freeze({
            externalId: 'synthetic-item-1',
            version: 'revision-2',
            canonicalUri: 'https://example.invalid/items/1',
            mediaType: 'application/json',
            profile: 'commonmark-v1',
            sourceUtf8: new TextEncoder().encode(
              '# Synthetic API item\n\nBody.\n',
            ),
            rawSourceBytes: new TextEncoder().encode(
              '{"title":"Synthetic API item","body":"Body."}',
            ),
          }),
        ]),
      });
    const dependencies = {
      blobStore: {
        put: () => Promise.reject(new Error('not reached')),
        read: () => Promise.reject(new Error('not reached')),
      },
      evidenceRepository: {
        saveCapture: () => Promise.reject(new Error('not reached')),
      },
      importEvidence,
    };
    const request = Object.freeze({
      workspaceId: WORKSPACE_ID,
      subscriptionId: SUBSCRIPTION_ID,
      connectorId: 'builtin.json-api.v1',
      sourceAlias: 'Synthetic/API',
      isPrivate: false,
      capturedAt: '2026-08-27T08:00:00.000Z',
      result: changed,
    });

    const first = await importSourceConnectorDocuments(dependencies, request);
    const second = await importSourceConnectorDocuments(dependencies, request);

    expect(first.status).toBe('complete');
    expect(second.status).toBe('complete');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      resource: {
        resourceKind: 'remote_document',
        canonicalUri: 'https://example.invalid/items/1',
      },
      snapshot: {mediaType: 'application/json'},
      gitObservations: [],
      profile: 'commonmark-v1',
    });
    expect(inputs[0]?.resource.resourceId).toBe(inputs[1]?.resource.resourceId);
    expect(inputs[0]?.snapshot.snapshotId).toBe(inputs[1]?.snapshot.snapshotId);
    expect(inputs[0]?.commandIdempotencyKey).toBe(
      inputs[1]?.commandIdempotencyKey,
    );
    expect(inputs[0]?.resource.sourceKey).toMatch(
      /^Synthetic／API#[0-9a-f]{24}$/u,
    );
    expect(new TextDecoder().decode(inputs[0]?.rawSourceBytes)).toBe(
      '{"title":"Synthetic API item","body":"Body."}',
    );
  });

  it('does not report completion when any document import fails', async () => {
    const result = await importSourceConnectorDocuments(
      {
        blobStore: {
          put: () => Promise.reject(new Error('not reached')),
          read: () => Promise.reject(new Error('not reached')),
        },
        evidenceRepository: {
          saveCapture: () => Promise.reject(new Error('not reached')),
        },
        importEvidence: () =>
          Promise.resolve({
            status: 'validation_failed',
            code: 'invalid_resource',
            path: 'resource',
          }),
      },
      {
        workspaceId: WORKSPACE_ID,
        subscriptionId: SUBSCRIPTION_ID,
        connectorId: 'builtin.web.v1',
        sourceAlias: 'Synthetic page',
        isPrivate: true,
        capturedAt: '2026-08-27T08:00:00.000Z',
        result: {
          status: 'changed',
          cursor: 'cursor',
          documents: [
            {
              externalId: 'page',
              version: 'one',
              canonicalUri: 'https://example.invalid/page',
              mediaType: 'text/html',
              profile: 'commonmark-v1',
              sourceUtf8: new TextEncoder().encode('# Synthetic page\n'),
            },
          ],
        },
      },
    );
    expect(result).toEqual({
      status: 'failed',
      documentIndex: 0,
      code: 'validation_failed',
    });
  });
});

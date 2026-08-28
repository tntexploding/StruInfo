import {describe, expect, it} from 'vitest';

import {
  buildInformationEntryAssociationProjection,
  type CurrentInformationEntry,
  type CurrentInformationEntryAssociationOverride,
  type InformationEntryAssociationOverrideWrite,
} from '../modules/entries/index.js';
import {
  M1cApiService,
  type M1cApiServiceDependencies,
} from './m1c_api_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_A = '20000000-0000-4000-8000-000000000001';
const ENTRY_B = '20000000-0000-4000-8000-000000000002';
const ENTRY_PRIVATE = '20000000-0000-4000-8000-000000000003';

describe('M1E Knowledge graph local API', () => {
  it('reads automatic edges, persists user edits, and preserves privacy before traversal', async () => {
    const publicEntries = [entry(ENTRY_A, false), entry(ENTRY_B, false)];
    const privateEntry = entry(ENTRY_PRIVATE, true);
    const allEntries = [...publicEntries, privateEntry];
    const projection =
      buildInformationEntryAssociationProjection(publicEntries)[0];
    if (projection === undefined) throw new Error('Expected projection.');
    let overrides: readonly Readonly<CurrentInformationEntryAssociationOverride>[] =
      [];
    const writes: InformationEntryAssociationOverrideWrite[] = [];
    const service = new M1cApiService(
      dependencies({
        informationEntryRepository: {
          materializeEntries: () =>
            Promise.resolve({outcome: 'existing', createdCount: 0}),
          materializeEntriesIfSnapshotEmpty: () =>
            Promise.resolve({outcome: 'existing', createdCount: 0}),
          reviseEntry: () => Promise.resolve('not_found'),
          loadCurrentEntries: (_workspaceId, includePrivate) =>
            Promise.resolve(includePrivate ? allEntries : publicEntries),
        },
        informationEntryAssociationRepository: {
          replaceAssociationProjections: () => Promise.resolve(0),
          loadAssociationSnapshot: () =>
            Promise.resolve({projections: [projection], overrides}),
          writeAssociationOverride: (write) => {
            writes.push(write);
            const current = overrides.find(
              (candidate) =>
                candidate.entryLowId === write.entryLowId &&
                candidate.entryHighId === write.entryHighId,
            );
            if ((current?.revision ?? 0) !== write.expectedRevision) {
              return Promise.resolve('stale');
            }
            const next: Readonly<CurrentInformationEntryAssociationOverride> =
              Object.freeze({
                workspaceId: write.workspaceId,
                entryLowId: write.entryLowId,
                entryHighId: write.entryHighId,
                revision: write.expectedRevision + 1,
                revisionId: write.revisionId,
                value: write.value,
              });
            overrides = Object.freeze([
              ...overrides.filter(
                (candidate) =>
                  candidate.entryLowId !== write.entryLowId ||
                  candidate.entryHighId !== write.entryHighId,
              ),
              next,
            ]);
            return Promise.resolve('applied');
          },
        },
      }),
    );

    await expect(
      service.readInformationEntryKnowledgeGraph({
        centerEntryId: ENTRY_A,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        graph: {
          center: {entryId: ENTRY_A},
          edges: [
            {
              entryHighId: ENTRY_B,
              label: 'similarity',
              origin: 'automatically_calculated',
              semanticKind: 'similarity',
              verificationStatus: 'calculated',
              overrideRevision: 0,
            },
          ],
        },
      },
    });

    await expect(
      service.reviseInformationEntryKnowledgeGraphEdge(ENTRY_A, ENTRY_B, {
        expectedRevision: 0,
        includePrivate: false,
        operation: 'edit',
        label: '扩展自',
        direction: 'low_to_high',
        semanticKind: 'supports',
        verificationStatus: 'source_checked',
        note: '已核对两端原始来源',
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied'},
    });
    expect(writes[0]).toMatchObject({
      value: {
        isBlocked: false,
        graph: {
          origin: 'association',
          label: '扩展自',
          direction: 'low_to_high',
          semanticKind: 'supports',
          verificationStatus: 'source_checked',
          note: '已核对两端原始来源',
        },
      },
    });

    await expect(
      service.readInformationEntryKnowledgeGraph({
        centerEntryId: ENTRY_A,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      body: {
        graph: {
          edges: [
            {
              label: '扩展自',
              origin: 'user_edited',
              semanticKind: 'supports',
              verificationStatus: 'source_checked',
              note: '已核对两端原始来源',
              overrideRevision: 1,
            },
          ],
        },
      },
    });

    await expect(
      service.reviseInformationEntryKnowledgeGraphEdge(ENTRY_A, ENTRY_PRIVATE, {
        expectedRevision: 0,
        includePrivate: false,
        operation: 'edit',
        label: '私密关联',
        direction: 'symmetric',
      }),
    ).resolves.toMatchObject({statusCode: 404});
    await expect(
      service.reviseInformationEntryKnowledgeGraphEdge(ENTRY_A, ENTRY_PRIVATE, {
        expectedRevision: 0,
        includePrivate: true,
        operation: 'edit',
        label: '私密关联',
        direction: 'symmetric',
      }),
    ).resolves.toMatchObject({statusCode: 200, body: {status: 'applied'}});
    expect(writes.at(-1)).toMatchObject({
      includePrivate: true,
      value: {graph: {origin: 'user', label: '私密关联'}},
    });
    await expect(
      service.readInformationEntryKnowledgeGraph({
        centerEntryId: ENTRY_A,
        includePrivate: true,
        onlyPrivate: true,
      }),
    ).resolves.toMatchObject({statusCode: 404});
  });
});

function dependencies(
  overrides: Partial<M1cApiServiceDependencies>,
): M1cApiServiceDependencies {
  return {
    workspaceId: WORKSPACE_ID,
    blobStore: {
      put: () => Promise.reject(new Error('Unexpected Blob write.')),
      read: () => Promise.reject(new Error('Unexpected Blob read.')),
    },
    reviewPreferences: {
      load: () => Promise.reject(new Error('Unexpected preference read.')),
      save: () => Promise.reject(new Error('Unexpected preference write.')),
    },
    evidenceRepository: {
      saveCapture: () => Promise.reject(new Error('Unexpected capture.')),
    },
    evidenceReadRepository: {
      listSnapshots: () => Promise.resolve([]),
      loadSnapshot: () => Promise.resolve(undefined),
    },
    informationEntryRepository: {
      materializeEntries: () =>
        Promise.resolve({outcome: 'existing', createdCount: 0}),
      materializeEntriesIfSnapshotEmpty: () =>
        Promise.resolve({outcome: 'existing', createdCount: 0}),
      reviseEntry: () => Promise.resolve('not_found'),
      loadCurrentEntries: () => Promise.resolve([]),
    },
    informationDocumentTagRepository: {
      writeDocumentTags: () => Promise.resolve('stale'),
      loadCurrentDocumentTags: () => Promise.resolve([]),
    },
    informationDocumentWorkingCopyRepository: {
      load: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      save: () => Promise.resolve({outcome: 'stale'}),
      restore: () => Promise.resolve('not_found'),
      commit: () => Promise.resolve({outcome: 'not_found'}),
    },
    informationEntryAssociationRepository: {
      replaceAssociationProjections: () => Promise.resolve(0),
      loadAssociationSnapshot: () =>
        Promise.resolve({projections: [], overrides: []}),
      writeAssociationOverride: () => Promise.resolve('not_found'),
    },
    processingRunRepository: {
      listRecentRuns: () => Promise.resolve([]),
      createRun: () => Promise.resolve('not_found'),
      writeProgress: () => Promise.resolve('not_found'),
      cancelRun: () => Promise.resolve('not_found'),
      appendProposal: () => Promise.resolve('not_found'),
    },
    workspaceTransfer: {
      exportWorkspace: () =>
        Promise.reject(new Error('Unexpected workspace export.')),
      restoreWorkspace: () =>
        Promise.reject(new Error('Unexpected workspace restore.')),
    },
    ...overrides,
  };
}

function entry(
  entryId: string,
  isPrivate: boolean,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: '40000000-0000-4000-8000-000000000001',
    snapshotId: '50000000-0000-4000-8000-000000000001',
    revision: 1,
    revisionId: `60000000-0000-4000-8000-${entryId.slice(-12)}`,
    sourceKey: 'synthetic:m1e-graph',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: Number(entryId.slice(-1)) - 1,
      titlePath: `Graph Entry ${entryId.slice(-1)}`,
      body: '共享的知识图谱和本地关联说明',
      bodySha256: '0'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: '知识图谱',
          normalizedValue: '知识图谱',
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      fragmentIds: Object.freeze([
        `70000000-0000-4000-8000-${entryId.slice(-12)}`,
      ]),
    }),
  });
}

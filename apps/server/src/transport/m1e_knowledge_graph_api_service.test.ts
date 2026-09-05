import {describe, expect, it, vi} from 'vitest';

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
  it('loads only bounded candidates and the selected center neighborhood', async () => {
    const entries = [entry(ENTRY_A, false), entry(ENTRY_B, false)];
    const centerEntry = entries[0];
    const projection = buildInformationEntryAssociationProjection(entries)[0];
    if (centerEntry === undefined || projection === undefined) {
      throw new Error('Expected graph fixture.');
    }
    const loadAllEntries = vi.fn(() =>
      Promise.reject(new Error('unbounded Entry read')),
    );
    const loadAllAssociations = vi.fn(() =>
      Promise.reject(new Error('unbounded association read')),
    );
    const loadByIds = vi.fn(
      (
        _workspaceId: string,
        _includePrivate: boolean,
        entryIds: readonly string[],
      ) =>
        Promise.resolve(
          entries.filter((candidate) => entryIds.includes(candidate.entryId)),
        ),
    );
    const loadNeighborhood = vi.fn(() =>
      Promise.resolve({projections: [projection], overrides: []}),
    );
    const search = vi.fn(() =>
      Promise.resolve({
        querySha256: 'a'.repeat(64),
        totalCount: 14_910,
        items: [
          {
            entry: centerEntry,
            matchReasons: [],
            filterReasons: [],
          },
        ],
      }),
    );
    const service = new M1cApiService(
      dependencies({
        informationEntryRepository: {
          materializeEntries: () =>
            Promise.resolve({outcome: 'existing', createdCount: 0}),
          materializeEntriesIfSnapshotEmpty: () =>
            Promise.resolve({outcome: 'existing', createdCount: 0}),
          reviseEntry: () => Promise.resolve('not_found'),
          loadCurrentEntries: loadAllEntries,
          loadCurrentEntriesByIds: loadByIds,
        },
        informationEntryAssociationRepository: {
          replaceAssociationProjections: () => Promise.resolve(0),
          loadAssociationSnapshot: loadAllAssociations,
          loadAssociationSnapshotForEntries: loadNeighborhood,
          writeAssociationOverride: () => Promise.resolve('not_found'),
        },
        informationEntryRetrieval: {
          semanticSearchAvailable: false,
          search,
          status: () => Promise.reject(new Error('unexpected status')),
          refresh: () => Promise.reject(new Error('unexpected refresh')),
          rebuild: () => Promise.reject(new Error('unexpected rebuild')),
          evaluate: () => Promise.reject(new Error('unexpected evaluation')),
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
        candidateTotalCount: 14_910,
        graph: {center: {entryId: ENTRY_A}},
      },
    });
    expect(loadNeighborhood).toHaveBeenCalledWith(WORKSPACE_ID, false, [
      ENTRY_A,
    ]);
    expect(loadByIds).toHaveBeenCalledWith(WORKSPACE_ID, false, [
      ENTRY_A,
      ENTRY_B,
    ]);
    expect(loadAllEntries).not.toHaveBeenCalled();
    expect(loadAllAssociations).not.toHaveBeenCalled();
  });

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
        expectedEntryRevisions: {entryLowRevision: 1, entryHighRevision: 1},
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

describe('relationship source review API', () => {
  const review = {
    expectedRevision: 2,
    includePrivate: false,
    expectedEntryRevisions: {entryLowRevision: 1, entryHighRevision: 1},
    verificationStatus: 'source_checked',
    note: '  Synthetic review note  ',
  };
  it('uses the paged production read and rejects a scope-mismatched cursor before I/O', async () => {
    const harness = sourceReviewHarness();
    const loadSourceReviewPage = vi.fn(() =>
      Promise.resolve({totalCount: 7, items: []}),
    );
    const deps = harness.deps;
    const service = new M1cApiService({
      ...deps,
      informationEntryAssociationRepository: {
        ...deps.informationEntryAssociationRepository,
        loadSourceReviewPage,
      },
    });
    await expect(
      service.listInformationEntrySourceReviews({
        filter: 'needs_review',
        privacyScope: 'private_only',
        limit: 3,
      }),
    ).resolves.toMatchObject({statusCode: 200, body: {totalCount: 7}});
    expect(loadSourceReviewPage).toHaveBeenCalledWith(WORKSPACE_ID, {
      filter: 'needs_review',
      privacyScope: 'private_only',
      limit: 3,
    });
    await expect(
      service.listInformationEntrySourceReviews({
        filter: 'all',
        after: {
          version: 1,
          filter: 'pending',
          privacyScope: 'public',
          entryLowId: ENTRY_A,
          entryHighId: ENTRY_B,
        },
      }),
    ).resolves.toMatchObject({statusCode: 422});
    expect(loadSourceReviewPage).toHaveBeenCalledTimes(1);
    expect(harness.loadByIds).not.toHaveBeenCalled();
  });
  it('saves only the note/status with both Entry revisions and preserves relationship meaning and origin', async () => {
    const harness = sourceReviewHarness();
    await expect(
      harness.service.reviewInformationEntryGraphSources(
        ENTRY_B,
        ENTRY_A,
        review,
      ),
    ).resolves.toMatchObject({statusCode: 200, body: {status: 'applied'}});
    expect(harness.loadByIds).toHaveBeenCalledWith(WORKSPACE_ID, false, [
      ENTRY_A,
      ENTRY_B,
    ]);
    expect(harness.write).toHaveBeenCalledWith(
      expect.objectContaining({
        entryLowId: ENTRY_A,
        entryHighId: ENTRY_B,
        expectedRevision: 2,
        requireVisibleGraphEdge: true,
        expectedEntryRevisions: review.expectedEntryRevisions,
        value: {
          action: 'weaken',
          manualAdjustment: -1500,
          isBlocked: false,
          graph: {
            origin: 'ai',
            label: 'Synthetic relation',
            direction: 'high_to_low',
            semanticKind: 'contradicts',
            verificationStatus: 'source_checked',
            note: 'Synthetic review note',
            reviewedRevisions: review.expectedEntryRevisions,
          },
        },
      }),
    );
    await expect(
      harness.service.reviewInformationEntryGraphSources(ENTRY_A, ENTRY_B, {
        ...review,
        label: 'do not edit',
      }),
    ).resolves.toMatchObject({statusCode: 422});
    expect(harness.write).toHaveBeenCalledTimes(1);
  });
  it('rejects stale displayed Entry or override versions before writing and propagates a race detected inside the lock', async () => {
    const harness = sourceReviewHarness();
    for (const request of [
      {...review, expectedRevision: 1},
      {
        ...review,
        expectedEntryRevisions: {entryLowRevision: 2, entryHighRevision: 1},
      },
      {
        ...review,
        expectedEntryRevisions: {entryLowRevision: 1, entryHighRevision: 2},
      },
    ]) {
      await expect(
        harness.service.reviewInformationEntryGraphSources(
          ENTRY_A,
          ENTRY_B,
          request,
        ),
      ).resolves.toMatchObject({
        statusCode: 409,
        body: {issue: {code: 'stale_source_review'}},
      });
    }
    expect(harness.write).not.toHaveBeenCalled();
    harness.write.mockResolvedValueOnce('stale');
    await expect(
      harness.service.reviewInformationEntryGraphSources(
        ENTRY_A,
        ENTRY_B,
        review,
      ),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {issue: {code: 'stale_source_review'}},
    });
  });
  it('does not review blocked, retired or privacy-invisible edges, and requires explicit private scope', async () => {
    for (const options of [
      {blocked: true},
      {retired: true},
      {isPrivate: true},
    ]) {
      const harness = sourceReviewHarness(options);
      await expect(
        harness.service.reviewInformationEntryGraphSources(
          ENTRY_A,
          ENTRY_B,
          review,
        ),
      ).resolves.toMatchObject({statusCode: 404});
      expect(harness.write).not.toHaveBeenCalled();
    }
    const privateHarness = sourceReviewHarness({isPrivate: true});
    await expect(
      privateHarness.service.reviewInformationEntryGraphSources(
        ENTRY_A,
        ENTRY_B,
        {...review, includePrivate: true},
      ),
    ).resolves.toMatchObject({statusCode: 200});
    expect(privateHarness.write).toHaveBeenCalledWith(
      expect.objectContaining({includePrivate: true}),
    );
  });
  it('rejects source-checked graph edits without a displayed pair revision', async () => {
    const harness = sourceReviewHarness();
    await expect(
      harness.service.reviseInformationEntryKnowledgeGraphEdge(
        ENTRY_A,
        ENTRY_B,
        {
          operation: 'edit',
          expectedRevision: 2,
          includePrivate: false,
          label: 'Synthetic relation',
          direction: 'symmetric',
          verificationStatus: 'source_checked',
        },
      ),
    ).resolves.toMatchObject({statusCode: 422});
    expect(harness.write).not.toHaveBeenCalled();
  });
});

function sourceReviewHarness(
  options: {blocked?: boolean; retired?: boolean; isPrivate?: boolean} = {},
) {
  const all = [
    entry(ENTRY_A, false),
    entry(ENTRY_B, options.isPrivate ?? false),
  ];
  const loadByIds = vi.fn(
    (_workspaceId: string, includePrivate: boolean, ids: readonly string[]) =>
      Promise.resolve(
        all.filter(
          (row) =>
            ids.includes(row.entryId) &&
            (includePrivate || !row.value.isPrivate) &&
            !(options.retired === true && row.entryId === ENTRY_B),
        ),
      ),
  );
  const write = vi
    .fn<
      (
        write: Readonly<InformationEntryAssociationOverrideWrite>,
      ) => Promise<'applied' | 'stale' | 'not_found' | 'unchanged'>
    >()
    .mockResolvedValue('applied');
  const base = dependencies({});
  const deps: M1cApiServiceDependencies = {
    ...base,
    informationEntryRepository: {
      ...base.informationEntryRepository,
      loadCurrentEntries: () =>
        Promise.reject(new Error('Unbounded Entry read')),
      loadCurrentEntriesByIds: loadByIds,
    },
    informationEntryAssociationRepository: {
      ...base.informationEntryAssociationRepository,
      loadAssociationSnapshot: () =>
        Promise.reject(new Error('Unbounded association read')),
      loadAssociationSnapshotForEntries: () =>
        Promise.resolve({
          projections: [],
          overrides: [
            {
              workspaceId: WORKSPACE_ID,
              entryLowId: ENTRY_A,
              entryHighId: ENTRY_B,
              revision: 2,
              revisionId: '30000000-0000-4000-8000-000000000001',
              value: {
                action: 'weaken',
                manualAdjustment: -1500,
                isBlocked: options.blocked ?? false,
                graph: {
                  origin: 'ai',
                  label: 'Synthetic relation',
                  direction: 'high_to_low',
                  semanticKind: 'contradicts',
                  verificationStatus: 'needs_review',
                  note: 'Synthetic original note',
                },
              },
            },
          ],
        }),
      writeAssociationOverride: write,
    },
  };
  return {deps, loadByIds, write, service: new M1cApiService(deps)};
}

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

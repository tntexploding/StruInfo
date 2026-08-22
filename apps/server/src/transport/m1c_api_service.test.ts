import {createHash} from 'node:crypto';

import type {Response} from 'express';
import {describe, expect, it, vi} from 'vitest';

import type {
  ManualCurationRepositoryPort,
  ManualCurationTransactionPort,
} from '../modules/curation/index.js';
import type {
  EvidenceCaptureRepositoryRequest,
  EvidenceRepositoryPort,
} from '../modules/evidence/index.js';
import type {
  CurrentInformationDocumentTags,
  CurrentInformationEntry,
  InformationDocumentTagWrite,
  InformationEntryAssociationOverrideWrite,
  InformationEntryAssociationProjection,
  InformationEntryMaterializeRow,
  InformationEntrySearchCursor,
} from '../modules/entries/index.js';
import type {ManualKnowledgeRepositoryPort} from '../modules/knowledge/index.js';
import type {BlobIdentity, BlobStore} from '../storage/blob_store.js';
import {
  LOCAL_API_CACHE_CONTROL,
  LOCAL_API_CONTENT_TYPE,
  M1cApiController,
} from './m1c_api_controller.js';
import {
  M1cApiService,
  type M1cApiServiceDependencies,
} from './m1c_api_service.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';
const STRUCTURE_ID = '00000000-0000-4000-8000-000000000004';
const NODE_ID = '00000000-0000-4000-8000-000000000005';
const FRAGMENT_ID = '00000000-0000-4000-8000-000000000006';
const TERM_ID = '00000000-0000-4000-8000-000000000007';
const ITEM_ID = '00000000-0000-4000-8000-000000000008';
const REVISION_ID = '00000000-0000-4000-8000-000000000009';
const DERIVED_ITEM_ID = '00000000-0000-4000-8000-00000000000a';

class MemoryBlobStore implements BlobStore {
  readonly #values = new Map<string, Uint8Array>();

  public put(bytes: Uint8Array): Promise<Readonly<BlobIdentity>> {
    const digest = createHash('sha256').update(bytes).digest('hex');
    this.#values.set(digest, Uint8Array.from(bytes));
    return Promise.resolve(
      Object.freeze({algorithm: 'sha256', digest, byteLength: bytes.length}),
    );
  }

  public read(identity: Readonly<BlobIdentity>): Promise<Uint8Array> {
    const bytes = this.#values.get(identity.digest);
    return bytes === undefined
      ? Promise.reject(new Error('Synthetic Blob not found.'))
      : Promise.resolve(Uint8Array.from(bytes));
  }
}

describe('M1cApiService', () => {
  it('keeps the selected external workspace authoritative for reads', async () => {
    const listSnapshots = vi.fn(() => Promise.resolve([]));
    const loadCurrentCurationState = vi.fn(() =>
      Promise.resolve({
        terms: [],
        targets: [],
        assignments: [],
        decisions: [],
        assessments: [],
      }),
    );
    const service = createService({
      evidenceReadRepository: {
        listSnapshots,
        loadSnapshot: () => Promise.resolve(undefined),
      },
      curationReadRepository: {loadCurrentCurationState},
    });

    expect(service.workspace().body).toMatchObject({
      status: 'ok',
      workspaceId: WORKSPACE_ID,
    });
    await expect(service.listEvidence()).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', snapshots: []},
    });
    await expect(service.loadCurationState()).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok'},
    });
    expect(listSnapshots).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
    expect(loadCurrentCurationState).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
    );
  });

  it('loads and saves workspace-scoped review quick tags', async () => {
    let quickTags: readonly string[] = [];
    let automaticKeywords = {
      enabled: true,
      includeLinkDomains: false,
      excludedKeywords: [] as readonly string[],
    };
    let vocabulary = {
      aliases: [] as readonly Readonly<{
        source: string;
        canonical: string;
      }>[],
      links: [] as readonly Readonly<{
        left: string;
        right: string;
        kind: 'related' | 'translation';
      }>[],
      knowledgeKinds: [] as readonly Readonly<{
        keyword: string;
        knowledgeKind: 'work';
      }>[],
    };
    const load = vi.fn((workspaceId: string) =>
      Promise.resolve({
        format: 'struinfo.review-preferences' as const,
        version: 1 as const,
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
      }),
    );
    const save = vi.fn(
      (
        workspaceId: string,
        next: readonly string[],
        nextAutomaticKeywords: typeof automaticKeywords,
        nextVocabulary: typeof vocabulary,
      ) => {
        quickTags = next;
        automaticKeywords = nextAutomaticKeywords;
        vocabulary = nextVocabulary;
        return Promise.resolve({
          format: 'struinfo.review-preferences' as const,
          version: 1 as const,
          workspaceId,
          quickTags,
          automaticKeywords,
          vocabulary,
        });
      },
    );
    const service = createService({reviewPreferences: {load, save}});

    await expect(service.loadReviewPreferences()).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        quickTags: [],
        automaticKeywords: {
          enabled: true,
          includeLinkDomains: false,
          excludedKeywords: [],
        },
        vocabulary: {aliases: [], links: [], knowledgeKinds: []},
      },
    });
    await expect(
      service.saveReviewPreferences({
        quickTags: ['实用工具', '命令行'],
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
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {quickTags: ['实用工具', '命令行']},
    });
    expect(load).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      ['实用工具', '命令行'],
      {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['广告'],
      },
      {
        aliases: [{source: 'Synthetic CLI', canonical: '工具'}],
        links: [],
        knowledgeKinds: [{keyword: 'Synthetic Cover', knowledgeKind: 'work'}],
      },
    );
  });

  it('rejects invalid quick tags without touching personal storage', async () => {
    const save = vi.fn(() => Promise.reject(new Error('unexpected save')));
    const service = createService({
      reviewPreferences: {
        load: () => Promise.reject(new Error('unexpected load')),
        save,
      },
    });

    await expect(
      service.saveReviewPreferences({quickTags: ['duplicate', 'DUPLICATE']}),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {issue: {path: 'body.quickTags'}},
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('imports JSON Markdown into the selected workspace without accepting a path', async () => {
    const blobs = new MemoryBlobStore();
    const captures: EvidenceCaptureRepositoryRequest[] = [];
    const evidenceRepository: EvidenceRepositoryPort = {
      saveCapture(request) {
        captures.push(request);
        return Promise.resolve(Object.freeze({status: 'created'}));
      },
    };
    const service = createService({blobStore: blobs, evidenceRepository});

    const result = await service.importMarkdown({
      commandIdempotencyKey: 'local-api-import-1',
      resource: {
        resourceId: RESOURCE_ID,
        resourceKind: 'git_file',
        sourceKey: 'git:synthetic/weekly/issue.md',
        canonicalUri: 'https://example.invalid/weekly/issue.md',
        isPrivate: true,
      },
      gitResource: {
        resourceId: RESOURCE_ID,
        canonicalRepositoryUri: 'https://example.invalid/weekly.git',
        repositoryRelativePath: 'docs/issue.md',
      },
      snapshot: {
        snapshotId: SNAPSHOT_ID,
        resourceId: RESOURCE_ID,
        capturedAt: '2040-01-02T03:04:05Z',
        mediaType: 'text/markdown',
      },
      gitObservations: [
        {
          observationId: '00000000-0000-4000-8000-000000000008',
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          repositoryRef: 'refs/heads/main',
          commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
          observedAt: '2040-01-02T03:04:05Z',
        },
      ],
      profile: 'ruanyf-weekly-v1',
      sourceText: '# Synthetic\n\n## 工具\n\n1、Entry\n\nBody.\n',
    });

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({
      status: 'created',
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      isPrivate: true,
    });
    expect(captures).toHaveLength(1);
    expect(captures[0]?.capture.workspaceId).toBe(WORKSPACE_ID);
    expect(captures[0]?.capture.resource.workspaceId).toBe(WORKSPACE_ID);
    expect(captures[0]?.capture.snapshot.workspaceId).toBe(WORKSPACE_ID);
    expect(captures[0]?.capture.resource.isPrivate).toBe(true);
  });

  it('reads normalized evidence and verifies the returned excerpt', async () => {
    const blobs = new MemoryBlobStore();
    const normalizedText = 'Synthetic evidence\n';
    const identity = await blobs.put(new TextEncoder().encode(normalizedText));
    const selectedText = 'Synthetic';
    const service = createService({
      blobStore: blobs,
      evidenceReadRepository: {
        listSnapshots: () => Promise.resolve([]),
        loadSnapshot: () =>
          Promise.resolve({
            workspaceId: WORKSPACE_ID,
            snapshotId: SNAPSHOT_ID,
            resourceId: RESOURCE_ID,
            resourceKind: 'manual_text',
            sourceKey: 'manual:synthetic',
            capturedAt: '2040-01-02T03:04:05.000Z',
            fragmentCount: 1,
            rawSha256: 'a'.repeat(64),
            canonicalContentSha256: identity.digest,
            canonicalizationVersion: 'utf8-lf-v1',
            structures: [
              {
                structureId: STRUCTURE_ID,
                parserName: 'struinfo-commonmark',
                parserVersion: '1',
                textNormalizationVersion: 'utf8-lf-v1',
                structureSha256: 'b'.repeat(64),
                textBlob: identity,
                fragments: [
                  {
                    fragmentId: FRAGMENT_ID,
                    structureId: STRUCTURE_ID,
                    nodeId: NODE_ID,
                    nodeKind: 'section',
                    codePointRange: {start: 0, end: 9},
                    lineRange: {start: 1, end: 1},
                    selectedTextSha256: createHash('sha256')
                      .update(selectedText)
                      .digest('hex'),
                  },
                ],
              },
            ],
          }),
      },
    });

    const result = await service.loadEvidenceSnapshot(SNAPSHOT_ID);

    expect(result).toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        snapshot: {
          structures: [
            {
              normalizedText,
              fragments: [
                {fragmentId: FRAGMENT_ID, nodeKind: 'section', selectedText},
              ],
            },
          ],
        },
      },
    });
  });

  it('materializes a source-bound Entry and requires privacy opt-in before returning it', async () => {
    const blobs = new MemoryBlobStore();
    const selectedText = '## Synthetic Entry\n\nPrivate source body.';
    const identity = await blobs.put(new TextEncoder().encode(selectedText));
    let materialized: readonly Readonly<InformationEntryMaterializeRow>[] = [];
    const materializeEntries = vi.fn(
      (entries: readonly Readonly<InformationEntryMaterializeRow>[]) => {
        materialized = entries;
        return Promise.resolve({
          outcome: 'created' as const,
          createdCount: entries.length,
        });
      },
    );
    const loadCurrentEntries = vi.fn(
      (_workspaceId: string, includePrivate: boolean) =>
        Promise.resolve(
          includePrivate
            ? materialized.map((entry) => ({
                workspaceId: entry.workspaceId,
                entryId: entry.entryId,
                resourceId: entry.resourceId,
                snapshotId: entry.snapshotId,
                revision: 1,
                revisionId: entry.revisionId,
                sourceKey: 'manual:private-entry',
                capturedAt: '2040-01-02T03:04:05.000Z',
                value: entry.value,
              }))
            : [],
        ),
    );
    const service = createService({
      blobStore: blobs,
      evidenceReadRepository: {
        listSnapshots: () => Promise.resolve([]),
        loadSnapshot: () =>
          Promise.resolve({
            workspaceId: WORKSPACE_ID,
            snapshotId: SNAPSHOT_ID,
            resourceId: RESOURCE_ID,
            resourceKind: 'manual_text',
            sourceKey: 'manual:private-entry',
            capturedAt: '2040-01-02T03:04:05.000Z',
            fragmentCount: 1,
            rawSha256: identity.digest,
            canonicalContentSha256: identity.digest,
            canonicalizationVersion: 'utf8-lf-v1',
            isPrivate: true,
            structures: [
              {
                structureId: STRUCTURE_ID,
                parserName: 'struinfo-commonmark',
                parserVersion: '1',
                textNormalizationVersion: 'utf8-lf-v1',
                structureSha256: 'b'.repeat(64),
                textBlob: identity,
                fragments: [
                  {
                    fragmentId: FRAGMENT_ID,
                    structureId: STRUCTURE_ID,
                    nodeId: NODE_ID,
                    nodeKind: 'section',
                    codePointRange: {
                      start: 0,
                      end: Array.from(selectedText).length,
                    },
                    lineRange: {start: 1, end: 3},
                    selectedTextSha256: createHash('sha256')
                      .update(selectedText)
                      .digest('hex'),
                  },
                ],
              },
            ],
          }),
      },
      informationEntryRepository: {
        materializeEntries,
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries,
      },
    });

    await expect(
      service.materializeInformationEntries({
        snapshotId: SNAPSHOT_ID,
        chunkMode: 'split',
      }),
    ).resolves.toMatchObject({
      statusCode: 404,
      body: {status: 'not_found'},
    });
    await expect(
      service.materializeInformationEntries({
        snapshotId: SNAPSHOT_ID,
        chunkMode: 'split',
        includePrivate: true,
      }),
    ).resolves.toMatchObject({
      statusCode: 201,
      body: {
        status: 'created',
        createdCount: 1,
        entries: [
          {
            sourceKey: 'manual:private-entry',
            value: {
              titlePath: 'Synthetic Entry',
              isPrivate: true,
              fragmentIds: [FRAGMENT_ID],
            },
          },
        ],
      },
    });
    expect(materializeEntries).toHaveBeenCalledTimes(1);
    expect(loadCurrentEntries).toHaveBeenCalledWith(WORKSPACE_ID, true);
  });

  it('binds structural Entry filters, association traversal, and pagination to the public search cursor', async () => {
    const entryAId = '00000000-0000-4000-8000-000000000011';
    const entryBId = '00000000-0000-4000-8000-000000000013';
    const entryCId = '00000000-0000-4000-8000-000000000015';
    const makeEntry = (
      entryId: string,
      revisionId: string,
      documentOrder: number,
    ): Readonly<CurrentInformationEntry> =>
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryId,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        revisionId,
        sourceKey: 'manual:m1d4-search',
        capturedAt: '2040-01-03T03:04:05.000Z',
        publishedAt: '2040-01-02T00:00:00.000Z',
        value: Object.freeze({
          documentOrder,
          titlePath: 'Entry ' + documentOrder.toString(),
          body: 'PostgreSQL transaction notes',
          bodySha256: 'a'.repeat(64),
          chunkMode: 'split' as const,
          splitRuleVersion: 'struinfo.entry-split.section.v1',
          isPrivate: false,
          typeKeyword: 'knowledge_explanation' as const,
          contentKeywords: Object.freeze([
            Object.freeze({
              displayValue: 'PostgreSQL',
              normalizedValue: 'postgresql',
              origin: 'manual' as const,
              originVersion: 'manual-entry-editor.v1',
            }),
          ]),
          domains: Object.freeze([
            Object.freeze({
              keyword: 'engineering_computing' as const,
              origin: 'manual' as const,
              originVersion: 'manual-entry-editor.v1',
            }),
          ]),
          fragmentIds: Object.freeze([FRAGMENT_ID]),
        }),
      });
    const entries = Object.freeze([
      makeEntry(entryAId, '00000000-0000-4000-8000-000000000012', 0),
      makeEntry(entryBId, '00000000-0000-4000-8000-000000000014', 1),
      makeEntry(entryCId, '00000000-0000-4000-8000-000000000016', 2),
    ]);
    const [entryA, entryB, entryC] = entries;
    if (entryA === undefined || entryB === undefined || entryC === undefined) {
      throw new Error('Expected three synthetic Entry fixtures.');
    }
    const projections: readonly Readonly<InformationEntryAssociationProjection>[] =
      Object.freeze([
        Object.freeze({
          workspaceId: WORKSPACE_ID,
          entryLowId: entryAId,
          entryHighId: entryBId,
          entryLowRevision: 1,
          entryLowRevisionId: entryA.revisionId,
          entryHighRevision: 1,
          entryHighRevisionId: entryB.revisionId,
          contentSimilarity: 8_000,
          typeSimilarity: 10_000,
          domainSimilarity: 10_000,
          baseScore: 8_500,
          algorithmVersion: 'struinfo.entry-association.score.v1',
          candidateBasis: Object.freeze(['content_keyword' as const]),
          candidateRank: 0,
        }),
        Object.freeze({
          workspaceId: WORKSPACE_ID,
          entryLowId: entryBId,
          entryHighId: entryCId,
          entryLowRevision: 1,
          entryLowRevisionId: entryB.revisionId,
          entryHighRevision: 1,
          entryHighRevisionId: entryC.revisionId,
          contentSimilarity: 7_000,
          typeSimilarity: 10_000,
          domainSimilarity: 10_000,
          baseScore: 7_500,
          algorithmVersion: 'struinfo.entry-association.score.v1',
          candidateBasis: Object.freeze(['content_keyword' as const]),
          candidateRank: 0,
        }),
      ]);
    const loadAssociationSnapshot = vi.fn(() =>
      Promise.resolve({projections, overrides: []}),
    );
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () => Promise.resolve(entries),
      },
      informationEntryAssociationRepository: {
        replaceAssociationProjections: () => Promise.resolve(0),
        loadAssociationSnapshot,
        writeAssociationOverride: () => Promise.resolve('not_found'),
      },
    });
    const request = {
      text: '   ',
      contentKeyword: 'PostgreSQL',
      sourceKey: 'manual:m1d4-search',
      snapshotId: SNAPSHOT_ID,
      typeKeyword: 'knowledge_explanation',
      domainKeyword: 'engineering_computing',
      domainScope: 'primary',
      chunkMode: 'split',
      time: {field: 'published', from: '2040-01-01', to: '2040-01-31'},
      association: {
        entryId: entryAId,
        maximumDepth: 2,
        minimumScore: 0,
      },
      includePrivate: false,
      limit: 1,
    };

    const first = await service.searchInformationEntries(request);
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({
      status: 'ok',
      totalCount: 2,
      items: [
        {
          entry: {entryId: entryBId},
          filterReasons: [
            'content_keyword',
            'source',
            'document',
            'type',
            'domain',
            'chunk_mode',
            'published_time',
          ],
          association: {depth: 1, effectiveScore: 8_500},
        },
      ],
    });
    const firstBody = first.body as Readonly<{
      status: string;
      nextCursor?: Readonly<InformationEntrySearchCursor>;
    }>;
    if (firstBody.status !== 'ok' || firstBody.nextCursor === undefined) {
      throw new Error('Expected the first public Entry page to continue.');
    }
    const nextCursor = firstBody.nextCursor;

    const second = await service.searchInformationEntries({
      ...request,
      after: nextCursor,
    });
    expect(second.body).toMatchObject({
      status: 'ok',
      totalCount: 2,
      items: [
        {
          entry: {entryId: entryCId},
          association: {depth: 2, effectiveScore: 7_500},
        },
      ],
    });
    await expect(
      service.searchInformationEntries({
        ...request,
        includePrivate: true,
        after: nextCursor,
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {
        status: 'rejected',
        issue: {
          code: 'invalid_entry_search_cursor',
          path: 'body.after',
        },
      },
    });
    expect(loadAssociationSnapshot).toHaveBeenCalledTimes(3);
  });

  it('rebuilds selective Entry associations and preserves a separate manual override command', async () => {
    const entryLowId = '00000000-0000-4000-8000-000000000011';
    const entryHighId = '00000000-0000-4000-8000-000000000013';
    const sharedValue = Object.freeze({
      documentOrder: 0,
      body: 'PostgreSQL transaction notes',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'manual-entry-editor.v1',
        }),
      ]),
      fragmentIds: Object.freeze([FRAGMENT_ID]),
    });
    const entries: readonly Readonly<CurrentInformationEntry>[] = [
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryId: entryLowId,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        revisionId: '00000000-0000-4000-8000-000000000012',
        sourceKey: 'manual:association-a',
        capturedAt: '2040-01-02T03:04:05.000Z',
        value: Object.freeze({...sharedValue, titlePath: 'Transaction A'}),
      }),
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryId: entryHighId,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        revisionId: '00000000-0000-4000-8000-000000000014',
        sourceKey: 'manual:association-b',
        capturedAt: '2040-01-02T03:04:06.000Z',
        value: Object.freeze({...sharedValue, titlePath: 'Transaction B'}),
      }),
    ];
    let projections: readonly Readonly<InformationEntryAssociationProjection>[] =
      [];
    let overrideWrite:
      Readonly<InformationEntryAssociationOverrideWrite> | undefined;
    const replaceAssociationProjections = vi.fn(
      (
        workspaceId: string,
        next: readonly Readonly<InformationEntryAssociationProjection>[],
        includePrivate: boolean,
      ) => {
        expect(workspaceId).toBe(WORKSPACE_ID);
        expect(includePrivate).toBe(false);
        projections = next;
        return Promise.resolve(next.length);
      },
    );
    const writeAssociationOverride = vi.fn(
      (write: Readonly<InformationEntryAssociationOverrideWrite>) => {
        overrideWrite = write;
        return Promise.resolve('applied' as const);
      },
    );
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () => Promise.resolve(entries),
      },
      informationEntryAssociationRepository: {
        replaceAssociationProjections,
        loadAssociationSnapshot: () =>
          Promise.resolve({projections, overrides: []}),
        writeAssociationOverride,
      },
    });

    await expect(
      service.rebuildInformationEntryAssociations({includePrivate: false}),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'rebuilt',
        entryCount: 2,
        projectedCount: 1,
        policy: {version: 'struinfo.entry-association.local-index.v1'},
      },
    });
    await expect(
      service.listInformationEntryAssociations(entryLowId),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        totalCount: 1,
        associations: [
          {
            relatedEntry: {entryId: entryHighId},
            effectiveScore: 10_000,
            isBlocked: false,
          },
        ],
      },
    });
    await expect(
      service.reviseInformationEntryAssociation(entryLowId, entryHighId, {
        expectedRevision: 0,
        action: 'block',
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied'},
    });
    expect(overrideWrite).toMatchObject({
      workspaceId: WORKSPACE_ID,
      entryLowId,
      entryHighId,
      expectedRevision: 0,
      includePrivate: false,
      value: {action: 'block', manualAdjustment: 0, isBlocked: true},
    });
  });

  it('requires explicit privacy opt-in for full documents and private search', async () => {
    const blobs = new MemoryBlobStore();
    const normalizedText = 'Private complete document\n';
    const identity = await blobs.put(new TextEncoder().encode(normalizedText));
    const privateSnapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      resourceKind: 'manual_text' as const,
      sourceKey: 'manual:private-synthetic',
      capturedAt: '2040-01-02T03:04:05.000Z',
      fragmentCount: 0,
      rawSha256: 'a'.repeat(64),
      canonicalContentSha256: identity.digest,
      canonicalizationVersion: 'utf8-lf-v1',
      isPrivate: true as const,
      structures: Object.freeze([
        Object.freeze({
          structureId: STRUCTURE_ID,
          parserName: 'struinfo-commonmark',
          parserVersion: '1',
          textNormalizationVersion: 'utf8-lf-v1',
          structureSha256: 'b'.repeat(64),
          textBlob: identity,
          fragments: Object.freeze([]),
        }),
      ]),
    });
    const service = createService({
      blobStore: blobs,
      evidenceReadRepository: {
        listSnapshots: () =>
          Promise.resolve([
            {
              workspaceId: WORKSPACE_ID,
              snapshotId: SNAPSHOT_ID,
              resourceId: RESOURCE_ID,
              resourceKind: 'manual_text',
              sourceKey: 'manual:private-synthetic',
              capturedAt: '2040-01-02T03:04:05.000Z',
              fragmentCount: 0,
              isPrivate: true,
            },
          ]),
        loadSnapshot: () => Promise.resolve(privateSnapshot),
      },
    });

    await expect(
      service.loadEvidenceSnapshot(SNAPSHOT_ID),
    ).resolves.toMatchObject({
      statusCode: 403,
      body: {
        status: 'rejected',
        issue: {code: 'private_content_requires_opt_in'},
      },
    });
    await expect(
      service.loadEvidenceSnapshot(SNAPSHOT_ID, true),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        snapshot: {structures: [{normalizedText}]},
      },
    });

    const publicSearch = await service.search(searchRequest());
    expect(publicSearch).toMatchObject({
      statusCode: 200,
      body: {includePrivate: false, privateDocuments: []},
    });
    const privateSearch = await service.search({
      includePrivate: true,
      request: searchRequest(),
    });
    expect(privateSearch).toMatchObject({
      statusCode: 200,
      body: {
        includePrivate: true,
        privateDocumentTotalCount: 1,
        privateDocuments: [
          {
            snapshotId: SNAPSHOT_ID,
            isPrivate: true,
            excerpt: 'Private complete document',
          },
        ],
      },
    });
  });

  it('aggregates versioned Document tags and exposes Document to Entry navigation counts', async () => {
    const blobs = new MemoryBlobStore();
    const normalizedText = 'PostgreSQL PostgreSQL and TypeScript\n';
    const identity = await blobs.put(new TextEncoder().encode(normalizedText));
    const snapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      resourceKind: 'manual_text' as const,
      sourceKey: 'manual:document-tags',
      capturedAt: '2040-01-02T03:04:05.000Z',
      fragmentCount: 0,
      rawSha256: identity.digest,
      canonicalContentSha256: identity.digest,
      canonicalizationVersion: 'utf8-lf-v1',
      structures: Object.freeze([
        Object.freeze({
          structureId: STRUCTURE_ID,
          parserName: 'struinfo-commonmark',
          parserVersion: '1',
          textNormalizationVersion: 'utf8-lf-v1',
          structureSha256: 'b'.repeat(64),
          textBlob: identity,
          fragments: Object.freeze([]),
        }),
      ]),
    });
    const entry: Readonly<CurrentInformationEntry> = Object.freeze({
      workspaceId: WORKSPACE_ID,
      entryId: '00000000-0000-4000-8000-000000000011',
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      revision: 2,
      revisionId: '00000000-0000-4000-8000-000000000012',
      sourceKey: snapshot.sourceKey,
      capturedAt: snapshot.capturedAt,
      value: Object.freeze({
        documentOrder: 0,
        titlePath: 'Synthetic database note',
        body: normalizedText,
        bodySha256: identity.digest,
        chunkMode: 'split' as const,
        splitRuleVersion: 'struinfo.entry-split.section.v1',
        isPrivate: false,
        typeKeyword: 'knowledge_explanation' as const,
        contentKeywords: Object.freeze([
          Object.freeze({
            displayValue: 'PostgreSQL',
            normalizedValue: 'postgresql',
            origin: 'manual' as const,
            originVersion: 'manual-entry-editor.v1',
          }),
          Object.freeze({
            displayValue: 'TypeScript',
            normalizedValue: 'typescript',
            origin: 'manual' as const,
            originVersion: 'manual-entry-editor.v1',
          }),
        ]),
        domains: Object.freeze([
          Object.freeze({
            keyword: 'engineering_computing' as const,
            origin: 'manual' as const,
            originVersion: 'manual-entry-editor.v1',
          }),
        ]),
        fragmentIds: Object.freeze([]),
      }),
    });
    let currentTags: Readonly<CurrentInformationDocumentTags> | undefined;
    const writeDocumentTags = vi.fn(
      (write: Readonly<InformationDocumentTagWrite>) => {
        currentTags = Object.freeze({
          workspaceId: write.workspaceId,
          resourceId: write.resourceId,
          snapshotId: write.snapshotId,
          revision: write.expectedRevision + 1,
          revisionId: write.revisionId,
          value: write.value,
        });
        return Promise.resolve('applied' as const);
      },
    );
    const service = createService({
      blobStore: blobs,
      evidenceReadRepository: {
        listSnapshots: () => Promise.resolve([snapshot]),
        loadSnapshot: () => Promise.resolve(snapshot),
      },
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () => Promise.resolve([entry]),
      },
      informationDocumentTagRepository: {
        writeDocumentTags,
        loadCurrentDocumentTags: () =>
          Promise.resolve(currentTags === undefined ? [] : [currentTags]),
      },
    });

    await expect(
      service.aggregateInformationDocumentTags(SNAPSHOT_ID, {
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        documentTags: {
          revision: 1,
          value: {
            revisionKind: 'aggregate',
            entryCount: 1,
            tags: [
              {
                displayValue: 'PostgreSQL',
                fullTextOccurrences: 2,
                entryCoverageCount: 1,
              },
              {
                displayValue: 'TypeScript',
                fullTextOccurrences: 1,
                entryCoverageCount: 1,
              },
            ],
          },
        },
      },
    });
    await expect(
      service.listInformationEntryDocuments(),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        documents: [
          {
            snapshotId: SNAPSHOT_ID,
            entryCount: 1,
            annotatedEntryCount: 1,
            currentTags: {revision: 1},
          },
        ],
      },
    });
    await expect(
      service.reviseInformationDocumentTags(SNAPSHOT_ID, {
        expectedRevision: 1,
        tags: ['Database systems'],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        documentTags: {
          revision: 2,
          value: {
            revisionKind: 'manual',
            tags: [
              {
                displayValue: 'Database systems',
                fullTextOccurrences: 0,
                entryCoverageCount: 0,
              },
            ],
          },
        },
      },
    });
    expect(writeDocumentTags).toHaveBeenCalledTimes(2);
  });

  it('reports an unavailable private-document read without throwing', async () => {
    const service = createService({
      evidenceReadRepository: {
        listSnapshots: () => Promise.reject(new Error('synthetic unavailable')),
        loadSnapshot: () => Promise.resolve(undefined),
      },
    });

    await expect(
      service.search({includePrivate: true, request: searchRequest()}),
    ).resolves.toEqual({
      statusCode: 503,
      body: {
        status: 'failed',
        issue: {code: 'evidence_read_failed'},
      },
    });
  });

  it('loads the complete current knowledge item for revision editing', async () => {
    const loadCurrentKnowledgeItem = vi.fn(() =>
      Promise.resolve({
        workspaceId: WORKSPACE_ID,
        itemId: ITEM_ID,
        revision: 3,
        revisionId: REVISION_ID,
        value: {
          knowledgeKind: 'method' as const,
          epistemicRole: 'summary' as const,
          reviewState: 'confirmed' as const,
          title: 'Synthetic existing judgment',
          body: 'Existing body retained for editing.',
        },
        provenance: {
          citations: [FRAGMENT_ID],
          fragmentDerivations: [],
          knowledgeDerivations: [
            {kind: 'item' as const, itemId: DERIVED_ITEM_ID, revision: 2},
          ],
        },
      }),
    );
    const service = createService({
      knowledgeReadRepository: {loadCurrentKnowledgeItem},
    });

    await expect(service.loadKnowledgeItem(ITEM_ID)).resolves.toEqual({
      statusCode: 200,
      body: {
        status: 'ok',
        item: {
          itemId: ITEM_ID,
          revision: 3,
          revisionId: REVISION_ID,
          value: {
            knowledgeKind: 'method',
            epistemicRole: 'summary',
            reviewState: 'confirmed',
            title: 'Synthetic existing judgment',
            body: 'Existing body retained for editing.',
          },
          provenance: {
            citations: [FRAGMENT_ID],
            fragmentDerivations: [],
            knowledgeDerivations: [
              {kind: 'item', itemId: DERIVED_ITEM_ID, revision: 2},
            ],
          },
        },
      },
    });
    expect(loadCurrentKnowledgeItem).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      ITEM_ID,
    );
  });

  it('requires an explicit opt-in before loading a private knowledge item', async () => {
    const service = createService({
      knowledgeReadRepository: {
        loadCurrentKnowledgeItem: () =>
          Promise.resolve({
            workspaceId: WORKSPACE_ID,
            itemId: ITEM_ID,
            revision: 1,
            revisionId: REVISION_ID,
            value: {
              knowledgeKind: 'assertion',
              epistemicRole: 'source_claim',
              reviewState: 'confirmed',
              title: 'Synthetic private judgment',
            },
            provenance: {
              citations: [FRAGMENT_ID],
              fragmentDerivations: [],
              knowledgeDerivations: [],
            },
            isPrivate: true,
          }),
      },
    });

    await expect(service.loadKnowledgeItem(ITEM_ID)).resolves.toMatchObject({
      statusCode: 403,
      body: {
        status: 'rejected',
        issue: {code: 'private_content_requires_opt_in'},
      },
    });
    await expect(
      service.loadKnowledgeItem(ITEM_ID, true),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', item: {itemId: ITEM_ID, isPrivate: true}},
    });
  });

  it('injects the workspace and command key into a manual term command', async () => {
    let query: unknown;
    const transaction = {
      lockAndLoadTermCommandSnapshot(value: unknown) {
        query = value;
        return Promise.resolve(emptyCurationSnapshot());
      },
      insertVocabularyTerm: () => Promise.resolve(),
      insertVocabularyTermRevision: () => Promise.resolve(),
      compareAndSetVocabularyTermCurrent: () => Promise.resolve(),
      insertCurationCommand: () => Promise.resolve(),
    } as unknown as ManualCurationTransactionPort;
    const curationRepository: ManualCurationRepositoryPort = {
      runCommandTransaction: (work) => work(transaction),
    };
    const service = createService({curationRepository});

    const result = await service.putCurationTerm({
      commandIdempotencyKey: 'local-term-1',
      request: {
        termId: TERM_ID,
        expectedRevision: 0,
        value: {displayName: 'Synthetic', lifecycle: 'active'},
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({status: 'applied'});
    expect(query).toMatchObject({
      workspaceId: WORKSPACE_ID,
      commandIdempotencyKey: 'local-term-1',
      termId: TERM_ID,
    });
  });

  it('runs deterministic search through the public read port', async () => {
    const loadCurrentKnowledgeSearchSnapshot = vi.fn(() =>
      Promise.resolve({
        items: [],
        revisions: [],
        fragmentInputs: [],
        relations: [],
        relationRevisions: [],
      }),
    );
    const service = createService({
      retrievalRepository: {loadCurrentKnowledgeSearchSnapshot},
    });

    const result = await service.search(searchRequest());

    expect(result).toMatchObject({
      statusCode: 200,
      body: {status: 'ok', totalCount: 0, items: []},
    });
    expect(loadCurrentKnowledgeSearchSnapshot).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      {includePrivate: false},
    );
  });

  it('exports and restores the selected workspace through the external Bundle boundary', async () => {
    const summary = Object.freeze({
      fileName: 'synthetic.workspace-bundle.json',
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      blobCount: 2,
      tableCounts: Object.freeze({workspace: 1, snapshot: 10}),
    });
    const exportWorkspace = vi.fn(() => Promise.resolve(summary));
    const restoreWorkspace = vi.fn(() => Promise.resolve(summary));
    const service = createService({
      workspaceTransfer: {exportWorkspace, restoreWorkspace},
    });

    await expect(service.exportWorkspaceBundle()).resolves.toMatchObject({
      statusCode: 201,
      body: {status: 'exported', fileName: summary.fileName, blobCount: 2},
    });
    await expect(
      service.restoreWorkspaceBundle({fileName: summary.fileName}),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'restored', fileName: summary.fileName, blobCount: 2},
    });
    expect(exportWorkspace).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
    expect(restoreWorkspace).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      summary.fileName,
    );
  });

  it('rejects a restore request that does not name an external Bundle file', async () => {
    const restoreWorkspace = vi.fn(() => Promise.reject(new Error('unused')));
    const service = createService({
      workspaceTransfer: {
        exportWorkspace: () => Promise.reject(new Error('unused')),
        restoreWorkspace,
      },
    });

    await expect(service.restoreWorkspaceBundle({})).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected', issue: {path: 'body.fileName'}},
    });
    expect(restoreWorkspace).not.toHaveBeenCalled();
  });
});

describe('M1cApiController', () => {
  it('writes local API responses as no-store JSON', () => {
    const service = createService();
    const controller = new M1cApiController(service);
    const {response, recording} = responseRecorder();

    controller.workspace(response);

    expect(recording.statusCode).toBe(200);
    expect(recording.headers).toEqual({
      'Content-Type': LOCAL_API_CONTENT_TYPE,
      'Cache-Control': LOCAL_API_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    });
    expect(JSON.parse(recording.body ?? '')).toMatchObject({
      status: 'ok',
      workspaceId: WORKSPACE_ID,
    });
  });
});

function createService(
  overrides: Partial<M1cApiServiceDependencies> = {},
): M1cApiService {
  const dependencies: M1cApiServiceDependencies = {
    workspaceId: WORKSPACE_ID,
    blobStore: new MemoryBlobStore(),
    reviewPreferences: {
      load: (workspaceId) =>
        Promise.resolve({
          format: 'struinfo.review-preferences',
          version: 1,
          workspaceId,
          quickTags: [],
        }),
      save: (workspaceId, quickTags) =>
        Promise.resolve({
          format: 'struinfo.review-preferences',
          version: 1,
          workspaceId,
          quickTags,
        }),
    },
    evidenceRepository: {
      saveCapture: () => Promise.reject(new Error('Unexpected capture.')),
    },
    evidenceReadRepository: {
      listSnapshots: () => Promise.resolve([]),
      loadSnapshot: () => Promise.resolve(undefined),
    },
    curationRepository: {
      runCommandTransaction: () =>
        Promise.reject(new Error('Unexpected curation command.')),
    },
    curationReadRepository: {
      loadCurrentCurationState: () => Promise.resolve(emptyCurationSnapshot()),
    },
    knowledgeRepository: {
      runCommandTransaction: () =>
        Promise.reject(new Error('Unexpected knowledge command.')),
    } as ManualKnowledgeRepositoryPort,
    knowledgeReadRepository: {
      loadCurrentKnowledgeItem: () => Promise.resolve(undefined),
    },
    retrievalRepository: {
      loadCurrentKnowledgeSearchSnapshot: () =>
        Promise.resolve({
          items: [],
          revisions: [],
          fragmentInputs: [],
          relations: [],
          relationRevisions: [],
        }),
    },
    informationEntryRepository: {
      materializeEntries: () =>
        Promise.resolve({outcome: 'existing', createdCount: 0}),
      reviseEntry: () => Promise.resolve('not_found'),
      loadCurrentEntries: () => Promise.resolve([]),
    },
    informationDocumentTagRepository: {
      writeDocumentTags: () => Promise.resolve('stale'),
      loadCurrentDocumentTags: () => Promise.resolve([]),
    },
    informationEntryAssociationRepository: {
      replaceAssociationProjections: (_workspaceId, projections) =>
        Promise.resolve(projections.length),
      loadAssociationSnapshot: () =>
        Promise.resolve({projections: [], overrides: []}),
      writeAssociationOverride: () => Promise.resolve('not_found'),
    },
    workspaceTransfer: {
      exportWorkspace: () =>
        Promise.reject(new Error('Unexpected workspace export.')),
      restoreWorkspace: () =>
        Promise.reject(new Error('Unexpected workspace restore.')),
    },
    ...overrides,
  };
  return new M1cApiService(dependencies);
}

function emptyCurationSnapshot() {
  return Object.freeze({
    evidenceTargets: Object.freeze([]),
    terms: Object.freeze([]),
    targets: Object.freeze([]),
    assignments: Object.freeze([]),
    decisions: Object.freeze([]),
    assessments: Object.freeze([]),
    commands: Object.freeze([]),
  });
}

function searchRequest() {
  return {
    filters: {
      knowledgeKinds: [],
      epistemicRoles: [],
      reviewStates: [],
      source: {kind: 'any' as const},
      relation: {kind: 'any' as const},
    },
    page: {limit: 25},
  };
}

function responseRecorder(): Readonly<{
  response: Response;
  recording: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
  };
}> {
  const recording: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
  } = {headers: {}};
  const response = {
    status(statusCode: number) {
      recording.statusCode = statusCode;
      return response;
    },
    setHeader(name: string, value: string) {
      recording.headers[name] = value;
      return response;
    },
    end(body: string) {
      recording.body = body;
      return response;
    },
  } as unknown as Response;
  return {response, recording};
}

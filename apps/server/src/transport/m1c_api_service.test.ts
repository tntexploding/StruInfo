import {createHash} from 'node:crypto';

import type {Response} from 'express';
import {describe, expect, it, vi} from 'vitest';

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
import type {BlobIdentity, BlobStore} from '../storage/blob_store.js';
import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewAssociationPolicyPreferences,
  type ReviewAutomaticKeywordPreferences,
  type ReviewVocabularyPreferences,
} from '../storage/review_preferences_store.js';
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
    const service = createService({
      evidenceReadRepository: {
        listSnapshots,
        loadSnapshot: () => Promise.resolve(undefined),
      },
    });

    expect(service.workspace().body).toMatchObject({
      status: 'ok',
      workspaceId: WORKSPACE_ID,
    });
    await expect(service.listEvidence()).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', snapshots: []},
    });
    expect(listSnapshots).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
  });

  it('loads and saves workspace-scoped review quick tags', async () => {
    let quickTags: readonly string[] = [];
    let automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences> = {
      enabled: true,
      includeLinkDomains: false,
      excludedKeywords: [],
    };
    let vocabulary: Readonly<ReviewVocabularyPreferences> = {aliases: []};
    let associationPolicy: Readonly<ReviewAssociationPolicyPreferences> =
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
    const load = vi.fn((workspaceId: string) =>
      Promise.resolve({
        format: 'struinfo.review-preferences' as const,
        version: 1 as const,
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        associationPolicy,
      }),
    );
    const save = vi.fn(
      (
        workspaceId: string,
        next: readonly string[],
        nextAutomaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>,
        nextVocabulary: Readonly<ReviewVocabularyPreferences>,
        nextAssociationPolicy: Readonly<ReviewAssociationPolicyPreferences> = associationPolicy,
      ) => {
        quickTags = next;
        automaticKeywords = nextAutomaticKeywords;
        vocabulary = nextVocabulary;
        associationPolicy = nextAssociationPolicy;
        return Promise.resolve({
          format: 'struinfo.review-preferences' as const,
          version: 1 as const,
          workspaceId,
          quickTags,
          automaticKeywords,
          vocabulary,
          associationPolicy,
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
        vocabulary: {aliases: []},
        associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
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
        },
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {quickTags: ['实用工具', '命令行']},
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(1, WORKSPACE_ID);
    expect(load).toHaveBeenNthCalledWith(2, WORKSPACE_ID);
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
      },
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
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

  it('versions association weights in external personal preferences and rejects stale writes', async () => {
    let policy: Readonly<ReviewAssociationPolicyPreferences> =
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
    const save = vi.fn(
      (
        workspaceId: string,
        quickTags: readonly string[],
        automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences> = DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary: Readonly<ReviewVocabularyPreferences> = DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        associationPolicy: Readonly<ReviewAssociationPolicyPreferences> = policy,
      ) => {
        policy = associationPolicy;
        return Promise.resolve({
          format: 'struinfo.review-preferences' as const,
          version: 1 as const,
          workspaceId,
          quickTags,
          automaticKeywords,
          vocabulary,
          associationPolicy: policy,
        });
      },
    );
    const service = createService({
      reviewPreferences: {
        load: (workspaceId) =>
          Promise.resolve({
            format: 'struinfo.review-preferences' as const,
            version: 1 as const,
            workspaceId,
            quickTags: ['保留标签'],
            automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
            vocabulary: DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
            associationPolicy: policy,
          }),
        save,
      },
    });

    await expect(
      service.reviseInformationEntryAssociationPolicy({
        expectedRevision: 0,
        contentWeight: 50,
        typeWeight: 25,
        domainWeight: 25,
        threshold: 2_000,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        policy: {
          revision: 1,
          contentWeight: 50,
          typeWeight: 25,
          domainWeight: 25,
          threshold: 2_000,
        },
      },
    });
    expect(save).toHaveBeenCalledWith(
      WORKSPACE_ID,
      ['保留标签'],
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      {
        revision: 1,
        contentWeight: 50,
        typeWeight: 25,
        domainWeight: 25,
        threshold: 2_000,
      },
    );
    await expect(
      service.reviseInformationEntryAssociationPolicy({
        expectedRevision: 0,
        contentWeight: 60,
        typeWeight: 20,
        domainWeight: 20,
        threshold: 1_100,
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {issue: {code: 'stale_association_policy_revision'}},
    });
    await expect(
      service.rebuildInformationEntryAssociations({includePrivate: false}),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'rebuilt', policy: {revision: 1, threshold: 2_000}},
    });
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
    const materializeEntriesIfSnapshotEmpty = vi.fn(
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
        materializeEntries: () =>
          Promise.reject(new Error('Unexpected legacy materialization.')),
        materializeEntriesIfSnapshotEmpty,
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
    expect(materializeEntriesIfSnapshotEmpty).toHaveBeenCalledTimes(1);
    expect(loadCurrentEntries).toHaveBeenCalledWith(WORKSPACE_ID, true);
  });

  it('materializes one complete manual Fragment grouping through the public service', async () => {
    const blobs = new MemoryBlobStore();
    const firstId = FRAGMENT_ID;
    const secondId = '00000000-0000-4000-8000-000000000007';
    const firstText = '## First section\n\nFirst body.';
    const secondText = '## Second section\n\nSecond body.';
    const normalizedText = `${firstText}\n\n${secondText}`;
    const identity = await blobs.put(new TextEncoder().encode(normalizedText));
    let materialized: readonly Readonly<InformationEntryMaterializeRow>[] = [];
    const materializeEntriesIfSnapshotEmpty = vi.fn(
      (entries: readonly Readonly<InformationEntryMaterializeRow>[]) => {
        materialized = entries;
        return Promise.resolve({
          outcome: 'created' as const,
          createdCount: entries.length,
        });
      },
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
            resourceKind: 'manual_text' as const,
            sourceKey: 'manual:synthetic-split',
            capturedAt: '2040-01-02T03:04:05.000Z',
            fragmentCount: 2,
            rawSha256: identity.digest,
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
                    fragmentId: firstId,
                    structureId: STRUCTURE_ID,
                    nodeId: NODE_ID,
                    nodeKind: 'section' as const,
                    codePointRange: {start: 0, end: firstText.length},
                    selectedTextSha256: createHash('sha256')
                      .update(firstText)
                      .digest('hex'),
                  },
                  {
                    fragmentId: secondId,
                    structureId: STRUCTURE_ID,
                    nodeId: '00000000-0000-4000-8000-000000000008',
                    nodeKind: 'section' as const,
                    codePointRange: {
                      start: firstText.length + 2,
                      end: normalizedText.length,
                    },
                    selectedTextSha256: createHash('sha256')
                      .update(secondText)
                      .digest('hex'),
                  },
                ],
              },
            ],
          }),
      },
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.reject(new Error('Unexpected legacy materialization.')),
        materializeEntriesIfSnapshotEmpty,
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () =>
          Promise.resolve(
            materialized.map((entry) => ({
              workspaceId: entry.workspaceId,
              entryId: entry.entryId,
              resourceId: entry.resourceId,
              snapshotId: entry.snapshotId,
              revision: 1,
              revisionId: entry.revisionId,
              sourceKey: 'manual:synthetic-split',
              capturedAt: '2040-01-02T03:04:05.000Z',
              value: entry.value,
            })),
          ),
      },
    });

    await expect(
      service.materializeManualInformationEntries({
        snapshotId: SNAPSHOT_ID,
        groups: [
          {
            titlePath: 'Combined entry',
            fragments: [
              {
                fragmentId: firstId,
                startCodePoint: 0,
                endCodePoint: Array.from(firstText).length,
              },
              {
                fragmentId: secondId,
                startCodePoint: 0,
                endCodePoint: Array.from(secondText).length,
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({
      statusCode: 201,
      body: {
        status: 'created',
        createdCount: 1,
        entries: [
          {
            value: {
              titlePath: 'Combined entry',
              body: `${firstText}\n\n${secondText}`,
              splitRuleVersion: 'struinfo.entry-split.manual-range.v1',
              fragmentIds: [firstId, secondId],
              fragmentRanges: [
                {startCodePoint: 0, endCodePoint: Array.from(firstText).length},
                {
                  startCodePoint: 0,
                  endCodePoint: Array.from(secondText).length,
                },
              ],
            },
          },
        ],
      },
    });
    await expect(
      service.materializeManualInformationEntries({
        snapshotId: SNAPSHOT_ID,
        groups: [
          {
            titlePath: 'Wrong order',
            fragments: [
              {
                fragmentId: secondId,
                startCodePoint: 0,
                endCodePoint: Array.from(secondText).length,
              },
              {
                fragmentId: firstId,
                startCodePoint: 0,
                endCodePoint: Array.from(firstText).length,
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected', issue: {code: 'manual_split_invalid'}},
    });
    expect(materializeEntriesIfSnapshotEmpty).toHaveBeenCalledTimes(1);
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
        materializeEntriesIfSnapshotEmpty: () =>
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

    await expect(
      service.searchInformationEntries({...request, onlyPrivate: true}),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected', issue: {path: 'body'}},
    });
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
        materializeEntriesIfSnapshotEmpty: () =>
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

  it('requires explicit privacy opt-in for complete source documents', async () => {
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
    const loadSnapshot = vi.fn(() => Promise.resolve(privateSnapshot));
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
        loadSnapshot,
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
    const loadCountBeforePublicSearch = loadSnapshot.mock.calls.length;
    await expect(
      service.searchInformationEntries({
        text: 'complete document',
        includePrivate: false,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        totalCount: 0,
        privateDocuments: {totalCount: 0, items: []},
      },
    });
    expect(loadSnapshot).toHaveBeenCalledTimes(loadCountBeforePublicSearch);
    await expect(
      service.searchInformationEntries({
        text: 'complete document',
        includePrivate: true,
        onlyPrivate: true,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        totalCount: 0,
        privateDocuments: {
          totalCount: 1,
          items: [
            {
              snapshot: {snapshotId: SNAPSHOT_ID, isPrivate: true},
              matchReasons: ['body'],
              entryMatchCount: 0,
              excerpt: 'Private complete document',
            },
          ],
        },
      },
    });
    await expect(
      service.searchInformationEntries({
        text: 'does not occur',
        includePrivate: true,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      body: {privateDocuments: {totalCount: 0, items: []}},
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
        materializeEntriesIfSnapshotEmpty: () =>
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

  it('exports and restores the selected workspace through the external Bundle boundary', async () => {
    const summary = Object.freeze({
      fileName: 'synthetic.workspace-bundle.json',
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      blobCount: 2,
      personalDataIncluded: true,
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

describe('M1E provider-neutral processing API', () => {
  it('lists real task state without exposing idempotency internals', async () => {
    const service = createService({
      processingRunRepository: {
        listRecentRuns: () =>
          Promise.resolve([
            {
              workspaceId: WORKSPACE_ID,
              runId: '22222222-2222-4222-8222-222222222222',
              idempotencyKey: 'internal-command-key',
              origin: 'deterministic',
              status: 'running',
              privacyScope: 'public_only',
              currentStage: 'tags',
              currentStep: '生成标签提案',
              completedUnits: 1,
              totalUnits: 3,
              attempt: 1,
              version: 2,
              createdAt: '2040-01-02T03:04:05.000Z',
              startedAt: '2040-01-02T03:04:06.000Z',
              updatedAt: '2040-01-02T03:04:07.000Z',
              proposals: [],
            },
          ]),
        createRun: () => Promise.resolve('not_found'),
        writeProgress: () => Promise.resolve('not_found'),
        cancelRun: () => Promise.resolve('not_found'),
        appendProposal: () => Promise.resolve('not_found'),
      },
    });

    const response = await service.listProcessingRuns(20);
    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        runs: [
          {
            origin: 'deterministic',
            status: 'running',
            currentStage: 'tags',
            version: 2,
          },
        ],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('internal-command-key');
  });

  it('cancels only the expected non-terminal run version', async () => {
    const cancelRun = vi.fn(() => Promise.resolve('applied' as const));
    const service = createService({
      processingRunRepository: {
        listRecentRuns: () => Promise.resolve([]),
        createRun: () => Promise.resolve('not_found'),
        writeProgress: () => Promise.resolve('not_found'),
        cancelRun,
        appendProposal: () => Promise.resolve('not_found'),
      },
    });

    await expect(
      service.cancelProcessingRun('22222222-2222-4222-8222-222222222222', {
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'cancelled', version: 3},
    });
    expect(cancelRun).toHaveBeenCalledWith(
      WORKSPACE_ID,
      '22222222-2222-4222-8222-222222222222',
      2,
    );
  });

  it('exposes configured tag proposals while keeping acceptance explicit', async () => {
    const proposal = Object.freeze({
      workspaceId: WORKSPACE_ID,
      proposalId: '33333333-3333-4333-8333-333333333333',
      runId: '22222222-2222-4222-8222-222222222222',
      ordinal: 0,
      stage: 'tags' as const,
      kind: 'tags' as const,
      targetEntryId: '44444444-4444-4444-8444-444444444444',
      status: 'pending_review' as const,
      summary: 'Synthetic proposal',
      fragmentIds: Object.freeze(['55555555-5555-4555-8555-555555555555']),
      tagPayload: Object.freeze({
        expectedEntryRevision: 1,
        providerModel: 'gpt-5-mini',
        promptVersion: 'struinfo.openai-entry-tags.v1',
        contentKeywords: Object.freeze([
          Object.freeze({
            displayValue: 'Synthetic',
            normalizedValue: 'synthetic',
          }),
        ]),
        typeKeyword: 'knowledge_explanation' as const,
        domains: Object.freeze([
          Object.freeze({keyword: 'engineering_computing' as const}),
        ]),
      }),
      createdAt: '2040-01-02T03:04:05.000Z',
    });
    const listForEntry = vi.fn(() => Promise.resolve([proposal]));
    const accept = vi.fn(() =>
      Promise.resolve({outcome: 'accepted' as const, proposal}),
    );
    const service = createService({
      aiTagProposals: {
        providerKey: 'openai-responses-v1',
        model: 'gpt-5-mini',
        listForEntry,
        start: () => Promise.reject(new Error('unused')),
        accept,
        reject: () => Promise.reject(new Error('unused')),
      },
    });

    const workspace = service.workspace().body as Readonly<{
      status: 'ok';
      capabilities: readonly string[];
    }>;
    expect(workspace.status).toBe('ok');
    expect(workspace.capabilities).toContain('ai_tags');
    await expect(
      service.listAiTagProposals('44444444-4444-4444-8444-444444444444'),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        proposals: [{tagPayload: {providerModel: 'gpt-5-mini'}}],
      },
    });
    await expect(
      service.acceptAiTagProposal(
        '44444444-4444-4444-8444-444444444444',
        proposal.proposalId,
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'accepted'},
    });
    expect(listForEntry).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(accept).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      proposal.proposalId,
    );
  });

  it('exposes configured split proposals without materializing on list or start', async () => {
    const proposal = Object.freeze({
      workspaceId: WORKSPACE_ID,
      proposalId: '33333333-3333-4333-8333-333333333333',
      runId: '22222222-2222-4222-8222-222222222222',
      ordinal: 0,
      stage: 'split' as const,
      kind: 'split' as const,
      targetSnapshotId: SNAPSHOT_ID,
      status: 'pending_review' as const,
      summary: 'Synthetic split proposal',
      fragmentIds: Object.freeze([FRAGMENT_ID]),
      splitPayload: Object.freeze({
        providerModel: 'gpt-5-mini',
        promptVersion: 'struinfo.openai-entry-split.v1',
        splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
        entries: Object.freeze([
          Object.freeze({
            titlePath: 'Synthetic group',
            fragmentIds: Object.freeze([FRAGMENT_ID]),
          }),
        ]),
      }),
      createdAt: '2040-01-02T03:04:05.000Z',
    });
    const listForSnapshot = vi.fn(() => Promise.resolve([proposal]));
    const accept = vi.fn(() =>
      Promise.resolve({outcome: 'accepted' as const, proposal, entries: []}),
    );
    const service = createService({
      aiSplitProposals: {
        providerKey: 'openai-responses-v1',
        model: 'gpt-5-mini',
        listForSnapshot,
        start: () => Promise.reject(new Error('unused')),
        accept,
        reject: () => Promise.reject(new Error('unused')),
      },
    });

    const workspace = service.workspace().body as Readonly<{
      status: 'ok';
      capabilities: readonly string[];
    }>;
    expect(workspace.capabilities).toContain('ai_split');
    await expect(
      service.listAiSplitProposals(SNAPSHOT_ID),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        proposals: [{splitPayload: {providerModel: 'gpt-5-mini'}}],
      },
    });
    await expect(
      service.acceptAiSplitProposal(SNAPSHOT_ID, proposal.proposalId),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'accepted'},
    });
    expect(listForSnapshot).toHaveBeenCalledWith(SNAPSHOT_ID);
    expect(accept).toHaveBeenCalledWith(SNAPSHOT_ID, proposal.proposalId);
  });

  it('keeps AI tag routes visibly unavailable without Provider configuration', async () => {
    const service = createService();
    const workspace = service.workspace().body as Readonly<{
      status: 'ok';
      capabilities: readonly string[];
    }>;
    expect(workspace.status).toBe('ok');
    expect(workspace.capabilities).not.toContain('ai_tags');
    await expect(
      service.startAiTagProposal('44444444-4444-4444-8444-444444444444', {
        requestKey: 'synthetic-request',
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {status: 'rejected', issue: {code: 'ai_provider_not_configured'}},
    });
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
    informationEntryAssociationRepository: {
      replaceAssociationProjections: (_workspaceId, projections) =>
        Promise.resolve(projections.length),
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
  return new M1cApiService(dependencies);
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

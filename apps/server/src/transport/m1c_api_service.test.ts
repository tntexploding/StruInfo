import {DEFAULT_ENTRY_SAVED_QUERIES} from '../modules/entries/information_entry_saved_queries.js';
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
  InformationDocumentWorkingCopy,
  InformationDocumentTagWrite,
  InformationEntryAssociationOverrideWrite,
  InformationEntryAssociationProjection,
  InformationEntryMaterializeRow,
  InformationEntryQuerySynthesisServicePort,
  InformationEntryRestructureWrite,
  InformationEntrySearchCursor,
} from '../modules/entries/index.js';
import {
  InformationEntryRetrievalServiceError,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
} from '../modules/entries/index.js';
import type {
  EntryAutomationClaim,
  EntryAutomationExecution,
  EntryAutomationExecutionInitialize,
  EntryAutomationExecutionRepositoryPort,
  EntryAutomationExecutionSettle,
  EntryAutomationWorkItem,
  EntryAutomationWorkItemState,
  EntryAutomationWorkQueueRepositoryPort,
  ProcessingRun,
  ProcessingRunWriteOutcome,
} from '../modules/processing/index.js';
import type {BlobIdentity, BlobStore} from '../storage/blob_store.js';
import {
  createReviewPreferences,
  DEFAULT_ENTRY_AUTOMATION_POLICY,
  DEFAULT_ENTRY_PREFERENCE_PROFILE,
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type EntryAutomationPolicy,
  type EntryPreferenceProfile,
  type ReviewPreferences,
  type ReviewAssociationPolicyPreferences,
  type ReviewAutomaticKeywordPreferences,
  type ReviewExplorationPolicyPreferences,
  type ReviewPreferencesStore,
  type ReviewPreferencesUpdater,
  type ReviewPreferencesUpdateResult,
  type ReviewSourceSubscriptionPreferences,
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
  it('exposes explicit Markdown export status codes and forwards only the submitted request to its narrow service', async () => {
    const body = {title: 'Synthetic export', entries: []};
    const preview = vi.fn(() =>
      Promise.resolve({
        status: 'rejected' as const,
        issue: {code: 'input_invalid' as const},
      }),
    );
    const generate = vi.fn(() =>
      Promise.resolve({
        status: 'rejected' as const,
        issue: {code: 'preview_stale' as const},
      }),
    );
    const service = createService({entryMarkdownExports: {preview, generate}});
    expect(
      (service.workspace().body as {capabilities: readonly string[]})
        .capabilities,
    ).toContain('entry_markdown_export');
    expect(await service.previewEntryMarkdownExport(body)).toMatchObject({
      statusCode: 400,
      body: {issue: {code: 'input_invalid'}},
    });
    expect(await service.generateEntryMarkdownExport(body)).toMatchObject({
      statusCode: 409,
      body: {issue: {code: 'preview_stale'}},
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith(body);
    expect(generate).toHaveBeenCalledExactlyOnceWith(body);
    expect(
      await createService().generateEntryMarkdownExport(body),
    ).toMatchObject({statusCode: 503});
  });

  it('manages saved queries by expected revision without writing Entry state', async () => {
    let preferences = createReviewPreferences(WORKSPACE_ID, [
      'Synthetic sibling',
    ]);
    const store: ReviewPreferencesStore = {
      load: () => Promise.resolve(preferences),
      save: () => Promise.reject(new Error('Unexpected positional save.')),
      update: <T>(_workspace: string, updater: ReviewPreferencesUpdater<T>) => {
        const result = updater(preferences);
        preferences = result.next;
        return Promise.resolve({preferences, result: result.result});
      },
    };
    const service = createService({reviewPreferences: store});
    expect((await service.loadEntrySavedQueries()).body).toMatchObject({
      savedQueries: {revision: 0, views: []},
    });
    const query = {includePrivate: true, onlyPrivate: true, text: 'Synthetic'};
    const write = {
      operation: 'save',
      expectedRevision: 0,
      viewId: RESOURCE_ID,
      name: 'Synthetic query',
      query,
      selectedEntryId: NODE_ID,
    };
    expect(await service.writeEntrySavedQuery(write)).toMatchObject({
      statusCode: 200,
      body: {status: 'applied', savedQueries: {revision: 1}},
    });
    expect(
      await service.writeEntrySavedQuery({...write, name: 'Stale'}),
    ).toMatchObject({statusCode: 409});
    expect(
      await service.saveReviewPreferences({
        quickTags: ['Synthetic changed sibling'],
      }),
    ).toMatchObject({statusCode: 200});
    expect((await service.loadEntrySavedQueries()).body).toMatchObject({
      savedQueries: {revision: 1, views: [{name: write.name, query}]},
    });
    expect(
      await service.writeEntrySavedQuery({
        operation: 'rename',
        expectedRevision: 1,
        viewId: RESOURCE_ID,
        name: 'Synthetic renamed',
      }),
    ).toMatchObject({statusCode: 200});
    expect(
      await service.writeEntrySavedQuery({
        operation: 'delete',
        expectedRevision: 2,
        viewId: RESOURCE_ID,
      }),
    ).toMatchObject({statusCode: 200, body: {savedQueries: {views: []}}});
    expect(
      await service.writeEntrySavedQuery({
        ...write,
        query: {...query, after: {}},
      }),
    ).toMatchObject({statusCode: 422});
  });

  it('restores only a current Entry in the explicit workspace and privacy scope', async () => {
    const base = currentRestructureEntry(
      NODE_ID,
      STRUCTURE_ID,
      0,
      'Synthetic selection',
      'Synthetic current body',
      FRAGMENT_ID,
    );
    let rows: readonly Readonly<CurrentInformationEntry>[] = [
      base,
      {...base, entryId: RESOURCE_ID, value: {...base.value, isPrivate: true}},
    ];
    const bounded = vi.fn(
      (_workspace: string, _include: boolean, ids: readonly string[]) =>
        Promise.resolve(rows.filter((row) => ids.includes(row.entryId))),
    );
    const full = vi.fn(() =>
      Promise.reject(new Error('Unexpected full read.')),
    );
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.reject(new Error('Unexpected write.')),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.reject(new Error('Unexpected write.')),
        reviseEntry: () => Promise.reject(new Error('Unexpected write.')),
        loadCurrentEntries: full,
        loadCurrentEntriesByIds: bounded,
      },
    });
    expect(
      await service.readEntryQueryContext({
        entryId: NODE_ID,
        includePrivate: false,
      }),
    ).toMatchObject({
      statusCode: 200,
      body: {entry: {revision: 1, value: {body: base.value.body}}},
    });
    expect(bounded).toHaveBeenLastCalledWith(WORKSPACE_ID, false, [NODE_ID]);
    expect(
      await service.readEntryQueryContext({
        entryId: RESOURCE_ID,
        includePrivate: false,
      }),
    ).toMatchObject({statusCode: 404});
    expect(
      await service.readEntryQueryContext({
        entryId: RESOURCE_ID,
        includePrivate: true,
        onlyPrivate: true,
      }),
    ).toMatchObject({statusCode: 200});
    expect(
      await service.readEntryQueryContext({
        entryId: NODE_ID,
        includePrivate: true,
        onlyPrivate: true,
      }),
    ).toMatchObject({statusCode: 404});
    rows = [{...base, workspaceId: RESOURCE_ID}];
    expect(
      await service.readEntryQueryContext({
        entryId: NODE_ID,
        includePrivate: false,
      }),
    ).toMatchObject({statusCode: 404});
    rows = [];
    expect(
      await service.readEntryQueryContext({
        entryId: NODE_ID,
        includePrivate: false,
      }),
    ).toMatchObject({statusCode: 404});
    const calls = bounded.mock.calls.length;
    expect(
      await service.readEntryQueryContext({
        entryId: NODE_ID,
        includePrivate: false,
        onlyPrivate: true,
      }),
    ).toMatchObject({statusCode: 422});
    expect(bounded).toHaveBeenCalledTimes(calls);
  });

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

  it('uses bounded evidence pages and returns the total document count', async () => {
    const listSnapshotPage = vi.fn(() =>
      Promise.resolve({
        items: [],
        totalCount: 407,
        nextCursor: {
          capturedAt: '2040-01-02T03:04:05.000Z',
          snapshotId: SNAPSHOT_ID,
        },
      }),
    );
    const service = createService({
      evidenceReadRepository: {
        listSnapshots: () => Promise.resolve([]),
        listSnapshotPage,
        loadSnapshot: () => Promise.resolve(undefined),
      },
    });

    await expect(service.listEvidence('200')).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        totalCount: 407,
        nextCursor: {
          capturedAt: '2040-01-02T03:04:05.000Z',
          snapshotId: SNAPSHOT_ID,
        },
      },
    });
    expect(listSnapshotPage).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID, {
      limit: 200,
    });
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
      DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      DEFAULT_ENTRY_PREFERENCE_PROFILE,
      DEFAULT_ENTRY_AUTOMATION_POLICY,
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      DEFAULT_ENTRY_SAVED_QUERIES,
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

  it('serves the versioned Entry preference profile, suggestions and read-only trial', async () => {
    let profile: Readonly<EntryPreferenceProfile> =
      DEFAULT_ENTRY_PREFERENCE_PROFILE;
    const entries = Object.freeze([
      syntheticPreferenceServiceEntry(71),
      syntheticPreferenceServiceEntry(72),
      syntheticPreferenceServiceEntry(73),
    ]);
    const privateEntry = syntheticPreferenceServiceEntry(74);
    const privateEntries = Object.freeze([
      ...entries,
      Object.freeze({
        ...privateEntry,
        value: Object.freeze({...privateEntry.value, isPrivate: true}),
      }),
    ]);
    const loadCurrentEntries = vi.fn(
      (_workspaceId: string, includePrivate: boolean) =>
        Promise.resolve(includePrivate ? privateEntries : entries),
    );
    const load = vi.fn((workspaceId: string) =>
      Promise.resolve({
        format: 'struinfo.review-preferences' as const,
        version: 1 as const,
        workspaceId,
        quickTags: ['保留快捷标记'],
        automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary: DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
        explorationPolicy: DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
        sourceSubscriptions: DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
        entryPreferenceProfile: profile,
      }),
    );
    const save = vi.fn(
      (
        workspaceId: string,
        quickTags: readonly string[],
        automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>,
        vocabulary: Readonly<ReviewVocabularyPreferences>,
        associationPolicy: Readonly<ReviewAssociationPolicyPreferences>,
        explorationPolicy: Readonly<ReviewExplorationPolicyPreferences>,
        sourceSubscriptions: Readonly<ReviewSourceSubscriptionPreferences>,
        nextProfile: Readonly<EntryPreferenceProfile>,
      ) => {
        profile = nextProfile;
        return Promise.resolve({
          format: 'struinfo.review-preferences' as const,
          version: 1 as const,
          workspaceId,
          quickTags,
          automaticKeywords,
          vocabulary,
          associationPolicy,
          explorationPolicy,
          sourceSubscriptions,
          entryPreferenceProfile: nextProfile,
        });
      },
    );
    const service = createService({
      reviewPreferences: {load, save},
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries,
      },
    });
    const rule = Object.freeze({
      ruleId: '77777777-7777-4777-8777-777777777777',
      dimension: 'usefulness' as const,
      featureKind: 'content_keyword' as const,
      featureIdentity: 'postgresql',
      displayValue: 'PostgreSQL',
      effect: 'prefer' as const,
      weight: 4 as const,
    });

    await expect(
      service.loadInformationEntryPreferenceProfile(),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', profile: {revision: 0, enabled: false, rules: []}},
    });
    await expect(
      service.saveInformationEntryPreferenceProfile({
        expectedRevision: 0,
        enabled: true,
        rules: [rule],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        profile: {revision: 1, enabled: true, rules: [rule]},
      },
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      ['保留快捷标记'],
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
      DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      {revision: 1, enabled: true, rules: [rule]},
      DEFAULT_ENTRY_AUTOMATION_POLICY,
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      DEFAULT_ENTRY_SAVED_QUERIES,
    );
    await expect(
      service.saveInformationEntryPreferenceProfile({
        expectedRevision: 0,
        enabled: false,
        rules: [],
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {
        status: 'rejected',
        issue: {code: 'stale_entry_preference_profile_revision'},
      },
    });
    expect(save).toHaveBeenCalledTimes(1);

    await expect(
      service.suggestInformationEntryPreferenceProfile({
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        visibleEntryCount: 3,
        totalCandidateCount: 6,
        candidates: [
          {
            dimension: 'usefulness',
            featureKind: 'content_keyword',
            featureIdentity: 'postgresql',
            positiveCount: 3,
          },
          {
            dimension: 'usefulness',
            featureKind: 'type',
            featureIdentity: 'knowledge_explanation',
          },
          {
            dimension: 'usefulness',
            featureKind: 'domain',
            featureIdentity: 'engineering_computing',
          },
          {
            dimension: 'interest',
            featureKind: 'content_keyword',
            featureIdentity: 'postgresql',
          },
          {
            dimension: 'interest',
            featureKind: 'type',
            featureIdentity: 'knowledge_explanation',
          },
          {
            dimension: 'interest',
            featureKind: 'domain',
            featureIdentity: 'engineering_computing',
          },
        ],
      },
    });
    await expect(
      service.trialInformationEntryPreferenceProfile({
        includePrivate: false,
        expectedProfileRevision: 1,
        profile,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'complete',
        visibleEntryCount: 3,
        evaluatedEntryCount: 3,
        items: [
          {totals: {usefulness: 4, interest: 0}},
          {totals: {usefulness: 4, interest: 0}},
          {totals: {usefulness: 4, interest: 0}},
        ],
      },
    });
    await expect(
      service.suggestInformationEntryPreferenceProfile({
        includePrivate: true,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        includePrivate: true,
        visibleEntryCount: 4,
      },
    });
    expect(loadCurrentEntries).toHaveBeenCalledTimes(3);
    expect(loadCurrentEntries).toHaveBeenNthCalledWith(1, WORKSPACE_ID, false);
    expect(loadCurrentEntries).toHaveBeenNthCalledWith(2, WORKSPACE_ID, false);
    expect(loadCurrentEntries).toHaveBeenNthCalledWith(3, WORKSPACE_ID, true);
  });

  it('serves owner-controlled automation policy, trial, execution and audit through the public service', async () => {
    const profile: Readonly<EntryPreferenceProfile> = Object.freeze({
      revision: 1,
      enabled: true,
      rules: Object.freeze([
        Object.freeze({
          ruleId: '77777777-7777-4777-8777-777777777777',
          dimension: 'usefulness' as const,
          featureKind: 'content_keyword' as const,
          featureIdentity: 'postgresql',
          displayValue: 'PostgreSQL',
          effect: 'prefer' as const,
          weight: 5 as const,
        }),
      ]),
    });
    const preferences = new MemoryAutomationPreferences(
      createReviewPreferences(
        WORKSPACE_ID,
        ['保留快捷标记'],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        profile,
      ),
    );
    const entries = Object.freeze([
      syntheticPreferenceServiceEntry(81),
      syntheticPreferenceServiceEntry(82),
    ]);
    const executions = new MemoryAutomationExecutionRepository();
    const service = createService({
      reviewPreferences: preferences,
      entryAutomationExecutionRepository: executions,
      entryAutomationWorkQueueRepository: executions,
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () => Promise.resolve(entries),
      },
      processingRunRepository: {
        listRecentRuns: () =>
          Promise.resolve(
            executions.current === undefined
              ? []
              : [automationProcessingRun(executions.current)],
          ),
        createRun: () => Promise.resolve('not_found'),
        writeProgress: () => Promise.resolve('not_found'),
        cancelRun: () => Promise.resolve('not_found'),
        appendProposal: () => Promise.resolve('not_found'),
      },
    });

    await expect(
      service.loadInformationEntryAutomationPolicy(),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        policy: {revision: 0, enabled: false, paused: false},
        profile: {revision: 1, enabled: true, ruleCount: 1},
      },
    });

    const policyDraft = automationPolicyDraft(1);
    const saved = await service.saveInformationEntryAutomationPolicy({
      expectedRevision: 0,
      ...policyDraft,
    });
    expect(saved).toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        policy: {revision: 1, enabled: true, profileRevision: 1},
      },
    });
    const policy = preferences.value.entryAutomationPolicy;
    expect(policy).toBeDefined();

    await expect(
      service.trialInformationEntryAutomationPolicy({
        includePrivate: false,
        expectedPolicyRevision: 1,
        expectedProfileRevision: 1,
        policy,
        manualTakeoverEntryIds: [entries[0]?.entryId],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'complete',
        dryRunOnly: true,
        activation: 'ready',
        counts: {advance_candidate: 1, manual_review: 1, defer_candidate: 0},
        items: [
          {route: 'manual_review', reason: 'manual_takeover'},
          {route: 'advance_candidate', reason: 'advance_threshold_met'},
        ],
      },
    });

    const executed = await service.executeInformationEntryAutomation({
      idempotencyKey: 'm1g-4c-synthetic-run',
      includePrivate: false,
      expectedPolicyRevision: 1,
      expectedProfileRevision: 1,
      manualTakeoverEntryIds: [entries[0]?.entryId],
    });
    expect(executed).toMatchObject({
      statusCode: 200,
      body: {
        status: 'succeeded',
        replayed: false,
        counts: {advance_candidate: 1, manual_review: 1, defer_candidate: 0},
        execution: {
          status: 'succeeded',
          policyRevision: 1,
          profileRevision: 1,
          claims: [
            {route: 'manual_review', status: 'completed'},
            {route: 'advance_candidate', status: 'completed'},
          ],
        },
      },
    });
    expect(executions.current?.runId).toBeDefined();

    await expect(
      service.listInformationEntryAutomationExecutions(10),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        executions: [{status: 'succeeded', claims: [{}, {}]}],
      },
    });
    await expect(
      service.loadInformationEntryAutomationExecution(
        executions.current?.runId ?? '',
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', execution: {status: 'succeeded'}},
    });
    await expect(
      service.listInformationEntryAutomationWorkQueue(false),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        items: [
          {state: 'pending', route: 'manual_review', stale: false},
          {state: 'pending', route: 'advance_candidate', stale: false},
        ],
      },
    });
    await expect(
      service.updateInformationEntryAutomationWorkItem(
        executions.current?.runId ?? '',
        '0',
        {
          expectedVersion: 1,
          state: 'completed',
          includePrivate: false,
        },
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied', item: {state: 'completed', version: 2}},
    });

    await expect(
      service.saveInformationEntryAutomationPolicy({
        expectedRevision: 0,
        ...policyDraft,
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {
        status: 'rejected',
        issue: {code: 'stale_entry_automation_policy_revision'},
      },
    });
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
      DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      DEFAULT_ENTRY_PREFERENCE_PROFILE,
      DEFAULT_ENTRY_AUTOMATION_POLICY,
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      DEFAULT_ENTRY_SAVED_QUERIES,
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

  it('versions the external exploration policy and preserves it across unrelated preference writes', async () => {
    let explorationPolicy: Readonly<ReviewExplorationPolicyPreferences> =
      DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES;
    const entryPreferenceProfile = Object.freeze({
      revision: 2,
      enabled: true,
      rules: Object.freeze([
        Object.freeze({
          ruleId: '44444444-4444-4444-8444-444444444444',
          dimension: 'usefulness' as const,
          featureKind: 'content_keyword' as const,
          featureIdentity: 'postgresql',
          displayValue: 'PostgreSQL',
          effect: 'prefer' as const,
          weight: 5 as const,
        }),
      ]),
    });
    const load = vi.fn((workspaceId: string) =>
      Promise.resolve({
        format: 'struinfo.review-preferences' as const,
        version: 1 as const,
        workspaceId,
        quickTags: ['保留标签'],
        automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary: DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
        explorationPolicy,
        entryPreferenceProfile,
      }),
    );
    const save = vi.fn(
      (
        workspaceId: string,
        quickTags: readonly string[],
        automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>,
        vocabulary: Readonly<ReviewVocabularyPreferences>,
        associationPolicy: Readonly<ReviewAssociationPolicyPreferences>,
        nextExplorationPolicy: Readonly<ReviewExplorationPolicyPreferences>,
        sourceSubscriptions: Readonly<ReviewSourceSubscriptionPreferences> = DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
        nextEntryPreferenceProfile: Readonly<EntryPreferenceProfile> = DEFAULT_ENTRY_PREFERENCE_PROFILE,
      ) => {
        explorationPolicy = nextExplorationPolicy;
        return Promise.resolve({
          format: 'struinfo.review-preferences' as const,
          version: 1 as const,
          workspaceId,
          quickTags,
          automaticKeywords,
          vocabulary,
          associationPolicy,
          explorationPolicy,
          sourceSubscriptions,
          entryPreferenceProfile: nextEntryPreferenceProfile,
        });
      },
    );
    const service = createService({reviewPreferences: {load, save}});

    await expect(
      service.reviseInformationEntryExplorationPolicy({
        expectedRevision: 0,
        enabled: true,
        resultShare: 30,
        neighborExpansion: true,
        crossDomain: false,
        serendipity: true,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        policy: {
          revision: 1,
          enabled: true,
          resultShare: 30,
          crossDomain: false,
        },
      },
    });
    expect(save).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      ['保留标签'],
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
      {
        revision: 1,
        enabled: true,
        resultShare: 30,
        neighborExpansion: true,
        crossDomain: false,
        serendipity: true,
      },
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      entryPreferenceProfile,
      DEFAULT_ENTRY_AUTOMATION_POLICY,
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      DEFAULT_ENTRY_SAVED_QUERIES,
    );

    await expect(
      service.reviseInformationEntryExplorationPolicy({
        expectedRevision: 1,
        enabled: true,
        resultShare: 30,
        neighborExpansion: true,
        crossDomain: false,
        serendipity: true,
      }),
    ).resolves.toMatchObject({statusCode: 200, body: {status: 'unchanged'}});
    expect(save).toHaveBeenCalledTimes(1);
    await expect(
      service.reviseInformationEntryExplorationPolicy({
        expectedRevision: 0,
        enabled: false,
        resultShare: 20,
        neighborExpansion: true,
        crossDomain: true,
        serendipity: true,
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {issue: {code: 'stale_exploration_policy_revision'}},
    });
    await expect(
      service.reviseInformationEntryExplorationPolicy({
        expectedRevision: 1,
        enabled: true,
        resultShare: 51,
        neighborExpansion: true,
        crossDomain: true,
        serendipity: true,
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {issue: {path: 'body'}},
    });

    await expect(
      service.saveReviewPreferences({
        quickTags: ['新快捷标记'],
        automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        vocabulary: DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {explorationPolicy: {revision: 1, resultShare: 30}},
    });
    expect(save).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      ['新快捷标记'],
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
      explorationPolicy,
      DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      entryPreferenceProfile,
      DEFAULT_ENTRY_AUTOMATION_POLICY,
      DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      DEFAULT_ENTRY_SAVED_QUERIES,
    );
  });

  it('loads and saves one versioned external Entry split rule profile', async () => {
    const preferences = new MemoryAutomationPreferences(
      createReviewPreferences(WORKSPACE_ID, []),
    );
    const service = createService({reviewPreferences: preferences});

    await expect(
      service.loadInformationEntrySplitRuleProfile(),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', profile: DEFAULT_ENTRY_SPLIT_RULE_PROFILE},
    });
    await expect(
      service.saveInformationEntrySplitRuleProfile({
        expectedRevision: 0,
        mode: 'merge_short_adjacent',
        minimumGroupCodePoints: 250,
        maximumGroupCodePoints: 2500,
        maximumFragmentsPerGroup: 6,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        profile: {
          revision: 1,
          mode: 'merge_short_adjacent',
          minimumGroupCodePoints: 250,
          maximumGroupCodePoints: 2500,
          maximumFragmentsPerGroup: 6,
        },
      },
    });
    await expect(
      service.saveInformationEntrySplitRuleProfile({
        expectedRevision: 0,
        mode: 'one_section',
        minimumGroupCodePoints: 400,
        maximumGroupCodePoints: 4000,
        maximumFragmentsPerGroup: 8,
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {
        status: 'rejected',
        issue: {code: 'stale_entry_split_rule_profile_revision'},
      },
    });
  });

  it('serves explainable exploration candidates through the public application boundary', async () => {
    const anchor = syntheticExplorationEntry(21, SNAPSHOT_ID);
    const candidate = syntheticExplorationEntry(
      22,
      '00000000-0000-4000-8000-000000000023',
    );
    const entries = Object.freeze([anchor, candidate]);
    const projection: Readonly<InformationEntryAssociationProjection> =
      Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryLowId: anchor.entryId,
        entryHighId: candidate.entryId,
        entryLowRevision: anchor.revision,
        entryLowRevisionId: anchor.revisionId,
        entryHighRevision: candidate.revision,
        entryHighRevisionId: candidate.revisionId,
        contentSimilarity: 0,
        typeSimilarity: 10_000,
        domainSimilarity: 10_000,
        baseScore: 7_000,
        algorithmVersion: 'synthetic.v1',
        candidateBasis: Object.freeze(['text_term' as const]),
        candidateRank: 1,
      });
    const loadCurrentEntries = vi.fn(() => Promise.resolve(entries));
    const loadAssociationSnapshot = vi.fn(() =>
      Promise.resolve({projections: [projection], overrides: []}),
    );
    const service = createService({
      reviewPreferences: {
        load: (workspaceId) =>
          Promise.resolve({
            format: 'struinfo.review-preferences' as const,
            version: 1 as const,
            workspaceId,
            quickTags: [],
            explorationPolicy: {
              revision: 2,
              enabled: true,
              resultShare: 50,
              neighborExpansion: true,
              crossDomain: true,
              serendipity: true,
            },
          }),
        save: () => Promise.reject(new Error('Unexpected preference write.')),
      },
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries,
      },
      informationEntryAssociationRepository: {
        replaceAssociationProjections: () => Promise.resolve(0),
        loadAssociationSnapshot,
        writeAssociationOverride: () => Promise.resolve('not_found'),
      },
    });

    const workspace = service.workspace().body as Readonly<{
      capabilities: readonly string[];
    }>;
    expect(workspace.capabilities).toContain('information_entry_exploration');
    await expect(
      service.exploreInformationEntries({
        anchorEntryId: 'not-a-uuid',
        excludeEntryIds: [],
        pageResultCount: 20,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {issue: {path: 'body'}},
    });
    expect(loadCurrentEntries).not.toHaveBeenCalled();

    await expect(
      service.exploreInformationEntries({
        anchorEntryId: '00000000-0000-4000-8000-000000000099',
        excludeEntryIds: [],
        pageResultCount: 20,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 404,
      body: {issue: {code: 'information_entry_not_found'}},
    });
    await expect(
      service.exploreInformationEntries({
        anchorEntryId: anchor.entryId,
        excludeEntryIds: [],
        pageResultCount: 2,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        policy: {revision: 2},
        candidateLimit: 1,
        totalEligibleCount: 1,
        items: [
          {
            entry: {entryId: candidate.entryId},
            reason: 'serendipity',
            effectiveScore: 7_000,
            differentSnapshot: true,
          },
        ],
      },
    });
    expect(loadCurrentEntries).toHaveBeenLastCalledWith(WORKSPACE_ID, false);
    expect(loadAssociationSnapshot).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      false,
    );
  });

  it('reports exploration repository failures without changing ordinary search', async () => {
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () =>
          Promise.reject(new Error('Synthetic repository failure.')),
      },
    });

    await expect(
      service.exploreInformationEntries({
        anchorEntryId: '00000000-0000-4000-8000-000000000021',
        excludeEntryIds: [],
        pageResultCount: 20,
        includePrivate: false,
      }),
    ).resolves.toMatchObject({
      statusCode: 503,
      body: {status: 'failed'},
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

  it('imports canonical Base64 upload bytes without changing their raw identity', async () => {
    const blobs = new MemoryBlobStore();
    const captures: EvidenceCaptureRepositoryRequest[] = [];
    const service = createService({
      blobStore: blobs,
      evidenceRepository: {
        saveCapture(request) {
          captures.push(request);
          return Promise.resolve(Object.freeze({status: 'created'}));
        },
      },
    });
    const sourceBytes = new TextEncoder().encode(
      '# Synthetic upload\r\n\r\nPlain body.\r\n',
    );
    const rawSha256 = createHash('sha256').update(sourceBytes).digest('hex');

    const result = await service.importMarkdown({
      commandIdempotencyKey: 'local-api-upload-1',
      resource: {
        resourceId: RESOURCE_ID,
        resourceKind: 'uploaded_file',
        sourceKey: `synthetic.txt#sha256:${rawSha256}`,
      },
      snapshot: {
        snapshotId: SNAPSHOT_ID,
        resourceId: RESOURCE_ID,
        capturedAt: '2040-01-02T03:04:05Z',
        mediaType: 'text/plain',
      },
      gitObservations: [],
      profile: 'commonmark-v1',
      sourceBase64: Buffer.from(sourceBytes).toString('base64'),
    });

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({
      status: 'created',
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
    });
    expect(captures).toHaveLength(1);
    expect(captures[0]?.capture.resource.resourceKind).toBe('uploaded_file');
    expect(captures[0]?.capture.snapshot.rawSha256).toBe(rawSha256);
    expect(captures[0]?.capture.snapshot.mediaType).toBe('text/plain');
    await expect(
      blobs.read({
        algorithm: 'sha256',
        digest: rawSha256,
        byteLength: sourceBytes.byteLength,
      }),
    ).resolves.toEqual(sourceBytes);
  });

  it('imports HTML through a textual projection while retaining exact raw bytes', async () => {
    const blobs = new MemoryBlobStore();
    const captures: EvidenceCaptureRepositoryRequest[] = [];
    const service = createService({
      blobStore: blobs,
      evidenceRepository: {
        saveCapture(request) {
          captures.push(request);
          return Promise.resolve(Object.freeze({status: 'created'}));
        },
      },
    });
    const sourceBytes = new TextEncoder().encode(
      '<!doctype html><html><head><title>Synthetic</title></head><body><main><h1>Heading</h1><p>Body.</p></main></body></html>',
    );
    const rawSha256 = createHash('sha256').update(sourceBytes).digest('hex');

    const result = await service.importDocument({
      commandIdempotencyKey: 'local-api-html-upload-1',
      documentFormat: 'html',
      resource: {
        resourceId: RESOURCE_ID,
        resourceKind: 'uploaded_file',
        sourceKey: `synthetic.html#sha256:${rawSha256}`,
      },
      snapshot: {
        snapshotId: SNAPSHOT_ID,
        resourceId: RESOURCE_ID,
        capturedAt: '2040-01-02T03:04:05Z',
        mediaType: 'text/html',
      },
      gitObservations: [],
      profile: 'commonmark-v1',
      sourceBase64: Buffer.from(sourceBytes).toString('base64'),
      sourcePreface: '# Imported HTML',
    });

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({status: 'created'});
    expect(captures).toHaveLength(1);
    expect(captures[0]?.capture.snapshot.rawSha256).toBe(rawSha256);
    expect(captures[0]?.capture.snapshot.mediaType).toBe('text/html');
    expect(captures[0]?.capture.snapshot.canonicalContentSha256).not.toBe(
      rawSha256,
    );
    await expect(
      blobs.read({
        algorithm: 'sha256',
        digest: rawSha256,
        byteLength: sourceBytes.byteLength,
      }),
    ).resolves.toEqual(sourceBytes);
  });

  it('rejects malformed or non-upload Base64 import requests before persistence', async () => {
    const saveCapture = vi.fn(() =>
      Promise.resolve(Object.freeze({status: 'created' as const})),
    );
    const service = createService({evidenceRepository: {saveCapture}});
    const base = {
      commandIdempotencyKey: 'local-api-upload-invalid',
      resource: {
        resourceId: RESOURCE_ID,
        resourceKind: 'uploaded_file',
        sourceKey: 'synthetic-upload',
      },
      snapshot: {
        snapshotId: SNAPSHOT_ID,
        resourceId: RESOURCE_ID,
        capturedAt: '2040-01-02T03:04:05Z',
        mediaType: 'text/markdown',
      },
      gitObservations: [],
      profile: 'commonmark-v1',
    } as const;

    await expect(
      service.importMarkdown({...base, sourceBase64: 'not canonical'}),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {issue: {code: 'invalid_http_input', path: 'body'}},
    });
    await expect(
      service.importMarkdown({
        ...base,
        resource: {...base.resource, resourceKind: 'manual_text'},
        sourceBase64: Buffer.from('# Synthetic').toString('base64'),
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {issue: {code: 'invalid_http_input', path: 'body'}},
    });
    expect(saveCapture).not.toHaveBeenCalled();
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

  it('saves one private pre-split draft and confirms it through the existing Evidence importer', async () => {
    const blobs = new MemoryBlobStore();
    const originalText = '# Original\n\nSynthetic source.\n';
    const originalIdentity = await blobs.put(
      new TextEncoder().encode(originalText),
    );
    const captures: EvidenceCaptureRepositoryRequest[] = [];
    let workingCopy: Readonly<InformationDocumentWorkingCopy> | undefined;
    const snapshot = Object.freeze({
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      resourceKind: 'uploaded_file' as const,
      sourceKey: 'synthetic-private.md',
      capturedAt: '2040-01-02T03:04:05.000Z',
      fragmentCount: 1,
      rawSha256: originalIdentity.digest,
      canonicalContentSha256: originalIdentity.digest,
      canonicalizationVersion: 'utf8-lf-v1',
      isPrivate: true,
      structures: Object.freeze([
        Object.freeze({
          structureId: STRUCTURE_ID,
          parserName: 'struinfo-commonmark',
          parserVersion: '1',
          textNormalizationVersion: 'utf8-lf-v1',
          structureSha256: 'b'.repeat(64),
          textBlob: originalIdentity,
          fragments: Object.freeze([
            Object.freeze({
              fragmentId: FRAGMENT_ID,
              structureId: STRUCTURE_ID,
              nodeId: NODE_ID,
              nodeKind: 'section' as const,
              codePointRange: Object.freeze({
                start: 0,
                end: Array.from(originalText).length,
              }),
              lineRange: Object.freeze({start: 1, end: 3}),
              selectedTextSha256: createHash('sha256')
                .update(originalText)
                .digest('hex'),
            }),
          ]),
        }),
      ]),
    });
    const service = createService({
      blobStore: blobs,
      evidenceRepository: {
        saveCapture(request) {
          captures.push(request);
          return Promise.resolve(Object.freeze({status: 'created'}));
        },
      },
      evidenceReadRepository: {
        listSnapshots: () => Promise.resolve([snapshot]),
        loadSnapshot: (_workspaceId, snapshotId) =>
          Promise.resolve(snapshotId === SNAPSHOT_ID ? snapshot : undefined),
      },
      informationDocumentWorkingCopyRepository: {
        load: () => Promise.resolve(workingCopy),
        list: () => Promise.resolve([]),
        save: (write) => {
          if (write.expectedRevision !== (workingCopy?.revision ?? 0)) {
            return Promise.resolve(Object.freeze({outcome: 'stale' as const}));
          }
          workingCopy = Object.freeze({
            workspaceId: write.workspaceId,
            sourceSnapshotId: write.sourceSnapshotId,
            revision: (workingCopy?.revision ?? 0) + 1,
            state: 'editing' as const,
            draftBody: write.draftBody,
            bodySha256: write.bodySha256,
          });
          return Promise.resolve(
            Object.freeze({outcome: 'applied' as const, value: workingCopy}),
          );
        },
        restore: () => Promise.resolve('not_found'),
        commit: (write) => {
          if (
            workingCopy?.state !== 'editing' ||
            workingCopy.revision !== write.expectedRevision
          ) {
            return Promise.resolve(
              Object.freeze({
                outcome: 'stale' as const,
                ...(workingCopy === undefined ? {} : {value: workingCopy}),
              }),
            );
          }
          workingCopy = Object.freeze({
            workspaceId: write.workspaceId,
            sourceSnapshotId: write.sourceSnapshotId,
            revision: write.expectedRevision,
            state: 'committed' as const,
            bodySha256: write.bodySha256,
            derivedResourceId: write.derivedResourceId,
            derivedSnapshotId: write.derivedSnapshotId,
          });
          return Promise.resolve(
            Object.freeze({outcome: 'committed' as const, value: workingCopy}),
          );
        },
      },
    });

    await expect(
      service.loadInformationDocumentWorkingCopy(SNAPSHOT_ID, false),
    ).resolves.toMatchObject({
      statusCode: 403,
      body: {issue: {code: 'private_content_requires_opt_in'}},
    });
    await expect(
      service.loadInformationDocumentWorkingCopy(SNAPSHOT_ID, true),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        workingCopy: {
          state: 'original',
          revision: 0,
          currentText: originalText,
        },
      },
    });

    const editedText = '# Edited\n\nSynthetic final source.\n';
    await expect(
      service.saveInformationDocumentWorkingCopy(SNAPSHOT_ID, {
        expectedRevision: 0,
        includePrivate: true,
        text: editedText,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'applied',
        workingCopy: {state: 'editing', revision: 1, currentText: editedText},
      },
    });
    const committed = await service.commitInformationDocumentWorkingCopy(
      SNAPSHOT_ID,
      {expectedRevision: 1, includePrivate: true},
    );

    expect(committed).toMatchObject({
      statusCode: 200,
      body: {
        status: 'committed',
        sourceSnapshotId: SNAPSHOT_ID,
      },
    });
    expect(committed.body).not.toMatchObject({derivedSnapshotId: SNAPSHOT_ID});
    expect(captures).toHaveLength(1);
    expect(captures[0]?.capture.resource).toMatchObject({
      resourceKind: 'manual_text',
      isPrivate: true,
    });
    expect(captures[0]?.capture.snapshot).toMatchObject({
      mediaType: 'text/markdown; charset=utf-8',
      capturedAt: snapshot.capturedAt,
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

  it('previews and atomically applies a post-materialization Entry merge', async () => {
    const blobs = new MemoryBlobStore();
    const secondFragmentId = '00000000-0000-4000-8000-000000000007';
    const firstText = 'Alpha source.';
    const secondText = 'Beta source.';
    const normalizedText = `${firstText}\n\n${secondText}`;
    const identity = await blobs.put(new TextEncoder().encode(normalizedText));
    const currentEntries: readonly Readonly<CurrentInformationEntry>[] = [
      currentRestructureEntry(
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000012',
        0,
        'Alpha',
        firstText,
        FRAGMENT_ID,
      ),
      currentRestructureEntry(
        '00000000-0000-4000-8000-000000000013',
        '00000000-0000-4000-8000-000000000014',
        1,
        'Beta',
        secondText,
        secondFragmentId,
      ),
    ];
    const applyEntryRestructure = vi.fn(
      (write: Readonly<InformationEntryRestructureWrite>) => {
        expect(write.workspaceId).toBe(WORKSPACE_ID);
        return Promise.resolve('applied' as const);
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
            sourceKey: 'manual:synthetic-restructure',
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
                    fragmentId: FRAGMENT_ID,
                    structureId: STRUCTURE_ID,
                    nodeId: NODE_ID,
                    nodeKind: 'section' as const,
                    codePointRange: {start: 0, end: firstText.length},
                    selectedTextSha256: createHash('sha256')
                      .update(firstText)
                      .digest('hex'),
                  },
                  {
                    fragmentId: secondFragmentId,
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
          Promise.resolve({outcome: 'existing' as const, createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing' as const, createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found' as const),
        loadCurrentEntries: () => Promise.resolve(currentEntries),
      },
      informationEntryRestructureRepository: {applyEntryRestructure},
    });
    const groups = [
      {
        titlePath: 'Merged Entry',
        fragments: [
          {
            fragmentId: FRAGMENT_ID,
            startCodePoint: 0,
            endCodePoint: firstText.length,
          },
          {
            fragmentId: secondFragmentId,
            startCodePoint: 0,
            endCodePoint: secondText.length,
          },
        ],
      },
    ];

    const preview = await service.previewInformationEntryRestructure({
      snapshotId: SNAPSHOT_ID,
      includePrivate: false,
      groups,
    });
    expect(preview).toMatchObject({
      statusCode: 200,
      body: {
        status: 'preview',
        currentEntryCount: 2,
        resultingEntryCount: 1,
        retiredEntryCount: 2,
      },
    });
    const previewBody = preview.body as Readonly<{
      status: string;
      planSha256: string;
    }>;
    const applied = await service.applyInformationEntryRestructure({
      snapshotId: SNAPSHOT_ID,
      includePrivate: false,
      groups,
      planSha256: previewBody.planSha256,
      acknowledgeAnnotationChanges: false,
      acknowledgeRelationshipChanges: false,
    });

    expect(applied).toMatchObject({statusCode: 200, body: {status: 'applied'}});
    expect(applyEntryRestructure).toHaveBeenCalledTimes(1);
    expect(applyEntryRestructure.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      includePrivate: false,
      expectedEntries: [{revision: 1}, {revision: 1}],
      successors: [{operation: 'insert'}],
      retiredEntryIds: [
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000013',
      ],
    });
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

  it('routes public lexical and semantic search through the retrieval service without duplicate loads', async () => {
    const loadCurrentEntries = vi.fn(() => Promise.resolve([]));
    const retrievalSearch = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          querySha256: '0'.repeat(64),
          retrievalMode: 'semantic' as const,
          totalCount: 0,
          items: Object.freeze([]),
        }),
      ),
    );
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries,
      },
      informationEntryRetrieval: {
        semanticSearchAvailable: true,
        search: retrievalSearch,
        status: () => Promise.reject(new Error('Unexpected status read.')),
        refresh: () => Promise.reject(new Error('Unexpected index refresh.')),
        rebuild: () => Promise.reject(new Error('Unexpected index rebuild.')),
        evaluate: () =>
          Promise.reject(new Error('Unexpected retrieval evaluation.')),
      },
    });

    await expect(
      service.searchInformationEntries({
        text: 'synthetic',
        retrievalMode: 'lexical',
        includePrivate: false,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', privateDocuments: {totalCount: 0, items: []}},
    });
    expect(loadCurrentEntries).not.toHaveBeenCalled();
    expect(retrievalSearch).toHaveBeenCalledTimes(1);

    await expect(
      service.searchInformationEntries({
        text: 'synthetic',
        retrievalMode: 'semantic',
        includePrivate: false,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        retrievalMode: 'semantic',
        privateDocuments: {totalCount: 0, items: []},
      },
    });
    expect(retrievalSearch).toHaveBeenCalledTimes(2);
    expect(loadCurrentEntries).not.toHaveBeenCalled();
  });

  it('accepts only bounded incremental index requests and reports busy maintenance', async () => {
    const index = {
      indexVersion: 'struinfo.entry-search-index.v1' as const,
      tokenizerVersion: 'struinfo.entry-terms.unicode-v1' as const,
      publicEntryCount: 3,
      currentProjectionCount: 3,
      embeddedProjectionCount: 0,
      staleProjectionCount: 0,
      postingCount: 12,
      semanticSearchAvailable: false,
      semanticSearchReady: false,
    };
    const progress = {
      outcome: 'complete' as const,
      loadedEntryCount: 1,
      updatedEntryCount: 1,
      staleEntryCount: 0,
      removedProjectionCount: 0,
      reusedEmbeddingCount: 0,
      embeddingInputCount: 0,
      remainingEntryCount: 0,
      remainingObsoleteCount: 0,
    };
    const refresh = vi.fn<
      (
        limit: number,
      ) => Promise<{index: typeof index; progress: typeof progress}>
    >(() => Promise.resolve({index, progress}));
    const service = createService({
      informationEntryRetrieval: {
        semanticSearchAvailable: false,
        incrementalRefreshAvailable: true,
        refresh,
        status: () => Promise.resolve(index),
        rebuild: () => Promise.reject(new Error('Unexpected complete rebuild')),
        search: () => Promise.reject(new Error('Unexpected search')),
        evaluate: () => Promise.reject(new Error('Unexpected evaluation')),
      },
    });
    for (const body of [
      null,
      [],
      {limit: 0},
      {limit: 33},
      {limit: 1.5},
      {limit: null},
      {includePrivate: true},
      {limit: 1, model: 'injected'},
    ]) {
      await expect(
        service.refreshInformationEntrySearchIndex(body),
      ).resolves.toMatchObject({statusCode: 422});
    }
    expect(refresh).not.toHaveBeenCalled();
    await expect(
      service.refreshInformationEntrySearchIndex({}),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'ok', index, progress},
    });
    expect(refresh).toHaveBeenLastCalledWith(32);
    await service.refreshInformationEntrySearchIndex({limit: 7});
    expect(refresh).toHaveBeenLastCalledWith(7);
    refresh.mockRejectedValueOnce(
      new InformationEntryRetrievalServiceError(
        'search_index_maintenance_busy',
      ),
    );
    await expect(
      service.refreshInformationEntrySearchIndex({limit: 7}),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {issue: {code: 'search_index_maintenance_busy'}},
    });
  });

  it('closes text mode and field scope at the HTTP boundary', async () => {
    const service = createService();
    for (const body of [
      {textMode: 'fuzzy', includePrivate: false, limit: 20},
      {
        text: 'synthetic',
        textMode: 'semantic',
        textFields: ['body'],
        includePrivate: false,
        limit: 20,
      },
      {
        text: 'synthetic',
        textMode: 'fuzzy',
        textFields: [],
        includePrivate: false,
        limit: 20,
      },
      {
        text: 'synthetic',
        textMode: 'fuzzy',
        textFields: ['body', 'body'],
        includePrivate: false,
        limit: 20,
      },
    ]) {
      await expect(
        service.searchInformationEntries(body),
      ).resolves.toMatchObject({
        statusCode: 422,
        body: {status: 'rejected', issue: {path: 'body'}},
      });
    }

    const first = await service.searchInformationEntries({
      text: 'synthetic',
      textMode: 'fuzzy',
      textFields: ['tags', 'title'],
      includePrivate: false,
      limit: 20,
    });
    const second = await service.searchInformationEntries({
      text: 'synthetic',
      textMode: 'fuzzy',
      textFields: ['title', 'tags'],
      includePrivate: false,
      limit: 20,
    });
    expect(first).toMatchObject({statusCode: 200, body: {status: 'ok'}});
    expect(second).toMatchObject({statusCode: 200, body: {status: 'ok'}});
    expect((first.body as {querySha256?: string}).querySha256).toBe(
      (second.body as {querySha256?: string}).querySha256,
    );
  });

  it('publishes and executes the closed public-only query synthesis boundary', async () => {
    const synthesize = vi.fn<
      InformationEntryQuerySynthesisServicePort['synthesize']
    >(() =>
      Promise.resolve(
        Object.freeze({
          requestId: 'query-synthesis:1',
          querySha256: 'a'.repeat(64),
          providerKey: 'openai-responses-v1' as const,
          model: 'gpt-5-mini',
          promptVersion: 'synthetic-query-v1',
          answer: '合成回答',
          evidenceStatus: 'supported' as const,
          claims: Object.freeze([
            Object.freeze({
              statement: '合成事实',
              evidenceRefs: Object.freeze(['E01']),
            }),
          ]),
          limitations: Object.freeze([]),
          evidence: Object.freeze([]),
        }),
      ),
    );
    const service = createService({
      aiQuerySynthesis: {
        providerKey: 'openai-responses-v1',
        model: 'gpt-5-mini',
        promptVersion: 'synthetic-query-v1',
        synthesize,
      },
    });

    const workspaceBody = service.workspace().body;
    if (
      typeof workspaceBody !== 'object' ||
      workspaceBody === null ||
      !('capabilities' in workspaceBody)
    )
      throw new Error('Expected a workspace capability response.');
    const capabilities: unknown = workspaceBody.capabilities;
    if (!Array.isArray(capabilities))
      throw new Error('Expected workspace capabilities.');
    expect(
      capabilities.some(
        (capability: unknown) => capability === 'ai_query_synthesis',
      ),
    ).toBe(true);
    await expect(
      service.synthesizeInformationEntryQuery({
        requestId: 'query-synthesis:1',
        question: '这些公开结果说明什么？',
        query: {
          text: '合成',
          textMode: 'substring',
          textFields: ['title', 'body'],
          includePrivate: false,
          onlyPrivate: false,
        },
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        requestId: 'query-synthesis:1',
        answer: '合成回答',
      },
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
    const synthesisRequest = synthesize.mock.calls[0]?.[0];
    expect(synthesisRequest?.requestId).toBe('query-synthesis:1');
    expect(synthesisRequest?.question).toBe('这些公开结果说明什么？');
    expect(synthesisRequest?.query.includePrivate).toBe(false);
    expect(synthesisRequest?.query.onlyPrivate).toBe(false);
    expect(synthesisRequest?.query.limit).toBe(8);
  });

  it('rejects private synthesis scope before the service and never accepts caller pagination', async () => {
    const synthesize = vi.fn(() => Promise.reject(new Error('unexpected')));
    const service = createService({
      aiQuerySynthesis: {
        providerKey: 'openai-responses-v1',
        model: 'gpt-5-mini',
        promptVersion: 'synthetic-query-v1',
        synthesize,
      },
    });

    await expect(
      service.synthesizeInformationEntryQuery({
        requestId: 'query-synthesis:private',
        question: '不应外发',
        query: {includePrivate: true, onlyPrivate: false},
      }),
    ).resolves.toMatchObject({
      statusCode: 409,
      body: {
        status: 'rejected',
        issue: {code: 'ai_query_private_scope_forbidden'},
      },
    });
    await expect(
      service.synthesizeInformationEntryQuery({
        requestId: 'query-synthesis:cursor',
        question: '不接受分页',
        query: {includePrivate: false, limit: 1},
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected', issue: {path: 'body'}},
    });
    expect(synthesize).not.toHaveBeenCalled();
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
        text: 'complete documemt',
        textMode: 'fuzzy',
        textFields: ['body'],
        includePrivate: true,
        onlyPrivate: true,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        privateDocuments: {
          totalCount: 1,
          items: [
            {
              matchReasons: ['body'],
              textMatch: {mode: 'fuzzy'},
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

  it('exposes versioned source subscriptions and explicit run-now', async () => {
    const subscription = Object.freeze({
      subscriptionId: '22222222-2222-4222-8222-222222222222',
      label: 'Synthetic source',
      enabled: false,
      repositoryUri: 'https://github.com/example/project',
      repositoryRef: 'main',
      repositoryPath: 'docs/source.md',
      profile: 'commonmark-v1' as const,
      sourceAlias: 'synthetic-source',
      isPrivate: false,
      routeAfterImport: false,
      intervalMinutes: 1_440,
    });
    const rssSubscription = Object.freeze({
      kind: 'rss_atom' as const,
      subscriptionId: '44444444-4444-4444-8444-444444444444',
      label: 'Synthetic Feed',
      enabled: true,
      feedUrl: 'https://example.invalid/feed.xml',
      itemLimit: 10,
      sourceAlias: 'synthetic-feed',
      isPrivate: false,
      routeAfterImport: false,
      intervalMinutes: 60,
    });
    const jsonSubscription = Object.freeze({
      kind: 'json_api' as const,
      subscriptionId: '55555555-5555-4555-8555-555555555555',
      label: 'Synthetic JSON API',
      enabled: false,
      endpointUrl: 'https://api.example.invalid/records',
      recordsPath: 'data.items',
      externalIdPath: 'id',
      titlePath: 'title',
      bodyPath: 'content.body',
      canonicalUriPath: 'url',
      publishedAtPath: 'published_at',
      versionPath: 'revision',
      recordLimit: 24,
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
      sourceAlias: 'synthetic-json',
      isPrivate: false,
      routeAfterImport: false,
      intervalMinutes: 60,
    });
    const webSubscription = Object.freeze({
      kind: 'web' as const,
      subscriptionId: '66666666-6666-4666-8666-666666666666',
      label: 'Synthetic Web',
      enabled: false,
      pageUrl: 'https://example.invalid/articles',
      additionalPaths: Object.freeze(['/about']),
      sourceAlias: 'synthetic-web',
      isPrivate: false,
      routeAfterImport: false,
      intervalMinutes: 60,
    });
    const pluginSubscription = Object.freeze({
      kind: 'plugin' as const,
      subscriptionId: '77777777-7777-4777-8777-777777777777',
      label: 'Synthetic plugin',
      enabled: false,
      connectorId: 'plugin.synthetic.v1',
      configurationRef: 'profile.default',
      sourceAlias: 'synthetic-plugin',
      isPrivate: true,
      routeAfterImport: false,
      intervalMinutes: 120,
    });
    const replace = vi.fn(() =>
      Promise.resolve({
        outcome: 'applied' as const,
        value: Object.freeze({
          revision: 1,
          subscriptions: Object.freeze([subscription]),
        }),
      }),
    );
    const runNow = vi.fn(() =>
      Promise.resolve({
        outcome: 'unchanged' as const,
        runId: '33333333-3333-4333-8333-333333333333',
        subscriptionId: subscription.subscriptionId,
      }),
    );
    const service = createService({
      sourceSubscriptions: {
        list: () =>
          Promise.resolve(
            Object.freeze({
              revision: 1,
              subscriptions: Object.freeze([subscription]),
            }),
          ),
        connectorCapabilities: () =>
          Object.freeze([
            Object.freeze({
              connectorId: 'plugin.synthetic.v1',
              displayName: 'Synthetic plugin',
              origin: 'plugin' as const,
              configurationMode: 'external_reference' as const,
            }),
          ]),
        replace,
        runNow,
        runDue: () => Promise.resolve([]),
      },
    });

    const workspaceBody = service.workspace().body as {
      readonly capabilities: readonly string[];
    };
    expect(workspaceBody.capabilities).toContain('source_subscriptions');
    await expect(service.listSourceSubscriptions()).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        revision: 1,
        connectors: [{connectorId: 'plugin.synthetic.v1', origin: 'plugin'}],
      },
    });
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [subscription],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied', revision: 1},
    });
    expect(replace).toHaveBeenCalledWith(1, [
      {...subscription, kind: 'github_markdown'},
    ]);
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [rssSubscription],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied'},
    });
    expect(replace).toHaveBeenLastCalledWith(1, [rssSubscription]);
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [jsonSubscription],
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'applied'},
    });
    expect(replace).toHaveBeenLastCalledWith(1, [jsonSubscription]);
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [webSubscription],
      }),
    ).resolves.toMatchObject({statusCode: 200, body: {status: 'applied'}});
    expect(replace).toHaveBeenLastCalledWith(1, [webSubscription]);
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [pluginSubscription],
      }),
    ).resolves.toMatchObject({statusCode: 200, body: {status: 'applied'}});
    expect(replace).toHaveBeenLastCalledWith(1, [pluginSubscription]);
    await expect(
      service.replaceSourceSubscriptions({
        expectedRevision: 1,
        subscriptions: [
          {
            ...jsonSubscription,
            authentication: {
              kind: 'bearer_env',
              variable: 'not-lowercase',
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected'},
    });
    await expect(
      service.runSourceSubscription(subscription.subscriptionId, {
        requestKey: 'synthetic-check',
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {status: 'unchanged'},
    });
    expect(runNow).toHaveBeenCalledWith(
      subscription.subscriptionId,
      'synthetic-check',
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
describe('M2-P2F type review API', () => {
  it('validates the closed request and returns the scale-aware repository page', async () => {
    const reviewCurrentEntryTypes = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          coverage: Object.freeze({
            totalCount: 12,
            classifiedCount: 7,
            missingCount: 5,
            byType: Object.freeze([]),
          }),
          items: Object.freeze([]),
        }),
      ),
    );
    const service = createService({
      informationEntryRepository: {
        materializeEntries: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        materializeEntriesIfSnapshotEmpty: () =>
          Promise.resolve({outcome: 'existing', createdCount: 0}),
        reviseEntry: () => Promise.resolve('not_found'),
        loadCurrentEntries: () =>
          Promise.reject(new Error('optimized review path was not used')),
        reviewCurrentEntryTypes,
      },
    });

    await expect(
      service.reviewInformationEntryTypes({
        includePrivate: false,
        filter: 'missing',
        limit: 20,
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: 'ok',
        coverage: {
          totalCount: 12,
          classifiedCount: 7,
          missingCount: 5,
          byType: [],
        },
        items: [],
      },
    });
    expect(reviewCurrentEntryTypes).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      includePrivate: false,
      filter: 'missing',
      limit: 20,
    });
    await expect(
      service.reviewInformationEntryTypes({
        includePrivate: false,
        filter: 'invented_type',
        limit: 20,
      }),
    ).resolves.toMatchObject({
      statusCode: 422,
      body: {status: 'rejected', issue: {path: 'body'}},
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
    informationDocumentWorkingCopyRepository: {
      load: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      save: () => Promise.resolve({outcome: 'stale'}),
      restore: () => Promise.resolve('not_found'),
      commit: () => Promise.resolve({outcome: 'not_found'}),
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

function currentRestructureEntry(
  entryId: string,
  revisionId: string,
  documentOrder: number,
  titlePath: string,
  body: string,
  fragmentId: string,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    revisionId,
    sourceKey: 'manual:synthetic-restructure',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder,
      titlePath,
      body,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'struinfo.entry-split.manual-range.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([fragmentId]),
      fragmentRanges: Object.freeze([
        Object.freeze({
          startCodePoint: 0,
          endCodePoint: Array.from(body).length,
        }),
      ]),
    }),
  });
}

class MemoryAutomationPreferences implements ReviewPreferencesStore {
  public value: Readonly<ReviewPreferences>;

  public constructor(value: Readonly<ReviewPreferences>) {
    this.value = value;
  }

  public load(): Promise<Readonly<ReviewPreferences>> {
    return Promise.resolve(this.value);
  }

  public save(): Promise<Readonly<ReviewPreferences>> {
    return Promise.reject(new Error('Atomic update is required.'));
  }

  public update<T>(
    _workspaceId: string,
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<Readonly<ReviewPreferencesUpdateResult<T>>> {
    const update = updater(this.value);
    this.value = update.next;
    return Promise.resolve(
      Object.freeze({preferences: this.value, result: update.result}),
    );
  }
}

class MemoryAutomationExecutionRepository
  implements
    EntryAutomationExecutionRepositoryPort,
    EntryAutomationWorkQueueRepositoryPort
{
  public current: Readonly<EntryAutomationExecution> | undefined;
  public workItems: EntryAutomationWorkItem[] = [];

  public loadExecution(
    _workspaceId: string,
    runId: string,
  ): Promise<Readonly<EntryAutomationExecution> | undefined> {
    return Promise.resolve(
      this.current?.runId === runId ? this.current : undefined,
    );
  }

  public initializeExecution(
    initialize: Readonly<EntryAutomationExecutionInitialize>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current !== undefined) {
      return Promise.resolve(
        this.current.requestSha256 === initialize.requestSha256 &&
          this.current.planSha256 === initialize.planSha256
          ? 'unchanged'
          : 'conflict',
      );
    }
    this.current = Object.freeze({
      workspaceId: initialize.workspaceId,
      runId: initialize.runId,
      idempotencyKey: initialize.idempotencyKey,
      requestSha256: initialize.requestSha256,
      planSha256: initialize.planSha256,
      policyRevision: initialize.policyRevision,
      profileRevision: initialize.profileRevision,
      includePrivate: initialize.includePrivate,
      status: 'queued',
      version: 1,
      claims: Object.freeze(
        initialize.claims.map((claim) => automationClaim(initialize, claim)),
      ),
    });
    return Promise.resolve('applied');
  }

  public startExecution(
    _workspaceId: string,
    _runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current === undefined) return Promise.resolve('not_found');
    if (this.current.status !== 'queued') return Promise.resolve('terminal');
    if (this.current.version !== expectedVersion)
      return Promise.resolve('stale');
    this.current = Object.freeze({
      ...this.current,
      status: 'running',
      version: 2,
    });
    return Promise.resolve('applied');
  }

  public settleExecution(
    settle: Readonly<EntryAutomationExecutionSettle>,
  ): Promise<ProcessingRunWriteOutcome> {
    if (this.current === undefined) return Promise.resolve('not_found');
    if (this.current.version !== settle.expectedVersion) {
      return Promise.resolve('stale');
    }
    const claimStatus =
      settle.status === 'succeeded' ? 'completed' : 'compensated';
    this.current = Object.freeze({
      ...this.current,
      status: settle.status,
      version: this.current.version + 1,
      ...(settle.errorCode === undefined ? {} : {errorCode: settle.errorCode}),
      claims: Object.freeze(
        this.current.claims.map((claim) =>
          Object.freeze({
            ...claim,
            status: claimStatus,
            ...(settle.errorCode === undefined
              ? {}
              : {errorCode: settle.errorCode}),
            finishedAt: '2040-01-02T03:04:06.000Z',
          }),
        ),
      ),
    });
    if (settle.status === 'succeeded') {
      this.workItems = this.current.claims.map((claim) => ({
        workspaceId: claim.workspaceId,
        runId: claim.runId,
        claimOrdinal: claim.ordinal,
        entryId: claim.entryId,
        entryRevision: claim.entryRevision,
        entryRevisionId: claim.entryRevisionId,
        route: claim.route,
        reason: claim.reason,
        state: 'pending',
        version: 1,
        createdAt: '2040-01-02T03:04:06.000Z',
        updatedAt: '2040-01-02T03:04:06.000Z',
      }));
    }
    return Promise.resolve('applied');
  }

  public listWorkItems(): Promise<
    readonly Readonly<EntryAutomationWorkItem>[]
  > {
    return Promise.resolve(Object.freeze([...this.workItems]));
  }

  public loadWorkItem(
    _workspaceId: string,
    runId: string,
    claimOrdinal: number,
  ): Promise<Readonly<EntryAutomationWorkItem> | undefined> {
    return Promise.resolve(
      this.workItems.find(
        (item) => item.runId === runId && item.claimOrdinal === claimOrdinal,
      ),
    );
  }

  public updateWorkItem(
    _workspaceId: string,
    runId: string,
    claimOrdinal: number,
    expectedVersion: number,
    state: EntryAutomationWorkItemState,
  ): Promise<ProcessingRunWriteOutcome> {
    const index = this.workItems.findIndex(
      (item) => item.runId === runId && item.claimOrdinal === claimOrdinal,
    );
    const current = this.workItems[index];
    if (current === undefined) return Promise.resolve('not_found');
    if (current.version !== expectedVersion) return Promise.resolve('stale');
    if (current.state === state) return Promise.resolve('unchanged');
    const withoutResolution = {...current};
    delete withoutResolution.resolvedAt;
    this.workItems[index] = {
      ...withoutResolution,
      state,
      version: current.version + 1,
      updatedAt: '2040-01-02T04:00:00.000Z',
      ...(state === 'pending' ? {} : {resolvedAt: '2040-01-02T04:00:00.000Z'}),
    };
    return Promise.resolve('applied');
  }
}

function automationPolicyDraft(
  profileRevision: number,
): Omit<EntryAutomationPolicy, 'revision'> {
  return Object.freeze({
    enabled: true,
    paused: false,
    profileRevision,
    minimumMatchedRuleCount: 1,
    advanceThresholds: Object.freeze({
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    }),
    deferThresholds: Object.freeze({
      usefulness: 3,
      interest: 3,
      requiredDimensions: 1,
    }),
    budgets: Object.freeze({
      maximumEntriesPerRun: 10,
      maximumAdvanceCandidatesPerRun: 10,
      maximumDeferCandidatesPerRun: 10,
    }),
    failureMode: 'pause',
  });
}

function automationClaim(
  initialize: Readonly<EntryAutomationExecutionInitialize>,
  claim: Readonly<EntryAutomationExecutionInitialize['claims'][number]>,
): Readonly<EntryAutomationClaim> {
  return Object.freeze({
    workspaceId: initialize.workspaceId,
    runId: initialize.runId,
    ...claim,
    status: 'claimed',
    createdAt: '2040-01-02T03:04:05.000Z',
  });
}

function automationProcessingRun(
  execution: Readonly<EntryAutomationExecution>,
): Readonly<ProcessingRun> {
  return Object.freeze({
    workspaceId: execution.workspaceId,
    runId: execution.runId,
    idempotencyKey: execution.idempotencyKey,
    origin: 'deterministic',
    status: execution.status,
    privacyScope: execution.includePrivate ? 'include_private' : 'public_only',
    currentStage: 'tags',
    currentStep:
      execution.status === 'succeeded'
        ? 'automation_complete'
        : 'automation_routing',
    completedUnits:
      execution.status === 'succeeded' ? execution.claims.length : 0,
    totalUnits: execution.claims.length,
    attempt: 1,
    version: execution.version,
    createdAt: '2040-01-02T03:04:05.000Z',
    updatedAt: '2040-01-02T03:04:06.000Z',
    ...(execution.status === 'succeeded'
      ? {finishedAt: '2040-01-02T03:04:06.000Z'}
      : {}),
    proposals: Object.freeze([]),
  });
}

function syntheticExplorationEntry(
  ordinal: number,
  snapshotId: string,
): Readonly<CurrentInformationEntry> {
  const entryId = `00000000-0000-4000-8000-${ordinal
    .toString()
    .padStart(12, '0')}`;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId,
    resourceId: RESOURCE_ID,
    snapshotId,
    revision: 1,
    revisionId: `10000000-0000-4000-8000-${ordinal
      .toString()
      .padStart(12, '0')}`,
    sourceKey: 'synthetic:exploration-service',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: ordinal,
      titlePath: `Synthetic exploration ${ordinal.toString()}`,
      body: 'Synthetic exploration service body',
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split' as const,
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      typeKeyword: 'knowledge_explanation' as const,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing' as const,
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
      fragmentIds: Object.freeze([FRAGMENT_ID]),
    }),
  });
}

function syntheticPreferenceServiceEntry(
  ordinal: number,
): Readonly<CurrentInformationEntry> {
  const base = syntheticExplorationEntry(ordinal, SNAPSHOT_ID);
  return Object.freeze({
    ...base,
    value: Object.freeze({
      ...base.value,
      usefulnessScore: 5 as const,
      interestScore: 4 as const,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: 'PostgreSQL',
          normalizedValue: 'postgresql',
          origin: 'manual' as const,
          originVersion: 'synthetic.v1',
        }),
      ]),
    }),
  });
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

import type {
  AnnotationVocabulary,
  AnnotationDraft,
} from '../../apps/web/src/api/annotation_contract.js';
import type {
  SourceSplitCatalogView,
  SourceSplitDefinition,
} from '../../apps/web/src/api/source_split_contract.js';
import type {
  ReportRecord,
  ReportRequest,
  ReportEdit,
} from '../../apps/web/src/api/report_client.js';
import type {
  AiPolicy,
  AiTask,
  IntakeRecord,
} from '../../apps/web/src/api/ai_workflow_client.js';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {EntryMarkdownExportService} from '../../apps/server/src/modules/entries/information_entry_markdown_export_service.js';
import type {CurrentInformationEntry} from '../../apps/server/src/modules/entries/information_entry_contract.js';
import type {EntryMarkdownExportRepositoryPort} from '../../apps/server/src/modules/entries/information_entry_markdown_export.js';
import {Buffer} from 'node:buffer';
import {DEFAULT_WORKSPACE_UI_PREFERENCES} from '../../apps/web/src/api/workspace_ui_preferences.js';

import {expect, test, type Locator, type Page} from '@playwright/test';

test.use({screenshot: 'only-on-failure'});

import type {
  InformationEntrySourceReviewItem,
  InformationEntrySourceReview,
  EntrySavedQuery,
  EntrySavedQueries,
  InformationEntrySearchIndexStatus,
  InformationEntrySearchIndexRefreshResponse,
} from '../../apps/web/src/api/m1c_api_contract.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const EXPLORATION_ENTRY_ID = '44444444-4444-4444-8444-444444444445';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const FRAGMENT_ID = '66666666-6666-4666-8666-666666666666';
const STRUCTURE_ID = '77777777-7777-4777-8777-777777777777';
const NODE_ID = '88888888-8888-4888-8888-888888888888';
const SYNTHETIC_FRAGMENT_TEXT = 'A😀Z';

const SYNTHETIC_SNAPSHOT = {
  workspaceId: WORKSPACE_ID,
  snapshotId: SNAPSHOT_ID,
  resourceId: RESOURCE_ID,
  resourceKind: 'manual_text' as const,
  sourceKey: 'synthetic-split-source',
  canonicalUri: 'https://example.invalid/split',
  capturedAt: '2026-08-23T00:00:00.000Z',
  fragmentCount: 1,
  rawSha256: '1'.repeat(64),
  canonicalContentSha256: '2'.repeat(64),
  canonicalizationVersion: 'synthetic-v1',
  mediaType: 'text/markdown',
  structures: [
    {
      structureId: STRUCTURE_ID,
      parserName: 'synthetic',
      parserVersion: '1',
      textNormalizationVersion: 'synthetic-v1',
      structureSha256: '3'.repeat(64),
      textBlob: {
        algorithm: 'sha256' as const,
        digest: '4'.repeat(64),
        byteLength: 6,
      },
      normalizedText: SYNTHETIC_FRAGMENT_TEXT,
      fragments: [
        {
          fragmentId: FRAGMENT_ID,
          structureId: STRUCTURE_ID,
          nodeId: NODE_ID,
          nodeKind: 'section' as const,
          codePointRange: {start: 0, end: 3},
          lineRange: {start: 1, end: 1},
          selectedTextSha256: '5'.repeat(64),
          selectedText: SYNTHETIC_FRAGMENT_TEXT,
        },
      ],
    },
  ],
};

const SYNTHETIC_DOCUMENT = {
  workspaceId: WORKSPACE_ID,
  snapshotId: SNAPSHOT_ID,
  resourceId: RESOURCE_ID,
  resourceKind: 'manual_text' as const,
  sourceKey: 'synthetic-split-source',
  canonicalUri: 'https://example.invalid/split',
  capturedAt: '2026-08-23T00:00:00.000Z',
  fragmentCount: 1,
  entryCount: 0,
  annotatedEntryCount: 0,
};

const SYNTHETIC_ENTRY = {
  workspaceId: WORKSPACE_ID,
  entryId: ENTRY_ID,
  resourceId: RESOURCE_ID,
  snapshotId: SNAPSHOT_ID,
  revision: 1,
  revisionId: REVISION_ID,
  sourceKey: 'synthetic-public',
  canonicalUri: 'https://example.invalid/public',
  capturedAt: '2026-08-23T00:00:00.000Z',
  value: {
    documentOrder: 0,
    titlePath: '合成公开 Entry',
    body: '用于浏览器回归的合成正文。',
    bodySha256: 'a'.repeat(64),
    chunkMode: 'split' as const,
    splitRuleVersion: 'synthetic-v1',
    isPrivate: false,
    contentKeywords: [],
    domains: [],
    fragmentIds: [FRAGMENT_ID],
  },
};

const SYNTHETIC_EXPLORATION_ENTRY = {
  ...SYNTHETIC_ENTRY,
  entryId: EXPLORATION_ENTRY_ID,
  revisionId: '55555555-5555-4555-8555-555555555556',
  sourceKey: 'synthetic-exploration',
  value: {
    ...SYNTHETIC_ENTRY.value,
    documentOrder: 1,
    titlePath: '合成探索 Entry',
    body: '用于浏览器探索回归的合成页外正文。',
  },
};

function syntheticAutomationExecution(runId: string) {
  return {
    runId,
    status: 'succeeded' as const,
    version: 2,
    policyRevision: 1,
    profileRevision: 0,
    includePrivate: false,
    claims: [
      {
        ordinal: 0,
        entryId: ENTRY_ID,
        entryRevision: 1,
        route: 'manual_review' as const,
        reason: 'threshold_not_met' as const,
        status: 'completed' as const,
        createdAt: '2026-08-26T00:00:00.000Z',
        finishedAt: '2026-08-26T00:00:01.000Z',
      },
    ],
  };
}

function controlledGate(): Readonly<{
  promise: Promise<void>;
  release: () => void;
}> {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return Object.freeze({promise, release});
}

async function installCurrentProductApi(
  page: Page,
  options?: Readonly<{
    manualSplitRequests?: string[];
    splitRuleRequests?: Readonly<{path: string; body: string}>[];
    restructureRequests?: Readonly<{path: string; body: string}>[];
    importRequests?: string[];
    importOutcomes?: readonly ('created' | 'conflict')[];
    importRequestGate?: Promise<void>;
    preferenceSuggestionGate?: Promise<void>;
    preferenceSuggestionScopes?: boolean[];
    preferenceTrialGate?: Promise<void>;
    preferenceTrialScopes?: boolean[];
    automationRunListGate?: Promise<void>;
    automationRunListRequests?: string[];
  }>,
) {
  const productRequests: string[] = [];
  const manualSplitEnabled = options?.manualSplitRequests !== undefined;
  const splitRuleEnabled = options?.splitRuleRequests !== undefined;
  const restructureEnabled = options?.restructureRequests !== undefined;
  const splitWorkspaceEnabled =
    manualSplitEnabled || splitRuleEnabled || restructureEnabled;
  const automationEnabled = options?.automationRunListRequests !== undefined;
  let currentRestructureGroups: readonly Readonly<{
    titlePath: string;
    fragments: readonly Readonly<{
      fragmentId: string;
      startCodePoint: number;
      endCodePoint: number;
    }>[];
  }>[] = [
    {
      titlePath: SYNTHETIC_ENTRY.value.titlePath,
      fragments: [
        {
          fragmentId: FRAGMENT_ID,
          startCodePoint: 0,
          endCodePoint: 3,
        },
      ],
    },
  ];
  let splitRuleApplied = false;
  let splitRuleProfile: {
    revision: number;
    mode: 'one_section' | 'merge_short_adjacent';
    minimumGroupCodePoints: number;
    maximumGroupCodePoints: number;
    maximumFragmentsPerGroup: number;
  } = {
    revision: 0,
    mode: 'one_section' as const,
    minimumGroupCodePoints: 400,
    maximumGroupCodePoints: 4_000,
    maximumFragmentsPerGroup: 8,
  };
  let associationPolicy = {
    revision: 0,
    version: 'struinfo.entry-association.local-index.v1',
    contentWeight: 65,
    typeWeight: 15,
    domainWeight: 20,
    threshold: 1_100,
    candidateLimit: 12,
    adjustmentStep: 1_500,
  };
  let explorationPolicy = {
    revision: 0,
    enabled: false,
    resultShare: 20,
    neighborExpansion: true,
    crossDomain: true,
    serendipity: true,
  };
  const entryPreferenceProfile = {
    revision: 0,
    enabled: false,
    rules: [],
  };
  let preferenceSuggestionRequestCount = 0;
  let preferenceTrialRequestCount = 0;
  let automationRunListRequestCount = 0;
  let importResponseIndex = 0;

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (
      request.url().endsWith('/api/v1/research/commands') &&
      (request.postDataJSON() as {operation: string}).operation ===
        'report_pipeline_status'
    ) {
      await route.fulfill({
        json: {result: {schedules: [], runs: [], notices: []}},
      });
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/health/ready') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          schema_version: '1',
          service: 'struinfo',
          role: 'all',
          status: 'ready',
          checks: {database: 'ready'},
        },
        status: 200,
      });
      return;
    }

    if (!path.startsWith('/api/v1/')) {
      await route.continue();
      return;
    }

    if (
      path === '/api/v1/reports/commands' &&
      (request.postDataJSON() as {operation: string}).operation ===
        'reports_list'
    ) {
      await route.fulfill({json: {result: {reports: []}}});
      return;
    }

    if (path === '/api/v1/ingestion/commands') {
      const command = request.postDataJSON() as {operation: string};
      const results: Record<string, unknown> = {
        source_quality_status: {revision: 0, manualExamples: 0, sources: []},
        intake_status: {records: []},
        intake_origins: {origins: []},
        intake_previews: {previews: [], failed: []},
        subscriptions_list: [],
        ingestion_status: {
          modelConfigured: false,
          policy: {
            revision: 0,
            settings: {
              enabled: false,
              paused: false,
              subscriptionIds: [],
              manualUploads: false,
              model: '',
              maxEntries: 12,
              maxModelCalls: 24,
              maxDocumentsPerDay: 10,
            },
          },
          items: [],
        },
      };
      if (command.operation in results) {
        await route.fulfill({json: {result: results[command.operation]}});
        return;
      }
    }
    if (path === '/api/v1/ai-price/commands') {
      await route.fulfill({
        json: {
          result: {
            policy: {revision: 0, enabled: false},
            rule: 'deepseek-weekday-peak-2026-09-14',
            timeZone: 'Asia/Shanghai',
            provider: null,
            applicable: false,
            peak: false,
            blocked: false,
            checkedAt: '2040-01-02T00:00:00Z',
            nextAllowedAt: null,
          },
        },
      });
      return;
    }

    if (
      path === '/api/v1/ingestion/commands' ||
      path === '/api/v1/ai-tasks/commands'
    ) {
      const operation = (request.postDataJSON() as {operation: string})
        .operation;
      const result =
        operation === 'annotation_vocabulary'
          ? {
              vocabulary: {
                revision: 0,
                dimensions: [],
                terms: [],
                aliases: [],
                relations: [],
              },
            }
          : operation === 'document_queue_status'
            ? {items: [], held: 0, duplicates: 0, batchLimit: 32}
            : operation === 'intake_status'
              ? {records: []}
              : operation === 'intake_previews'
                ? {previews: [], failed: []}
                : operation === 'system_status'
                  ? {role: 'all', agentEnabled: false, grants: []}
                  : operation === 'ingestion_status'
                    ? {
                        policy: {
                          revision: 0,
                          settings: {
                            enabled: false,
                            paused: false,
                            subscriptionIds: [],
                            manualUploads: false,
                            model: '',
                            maxEntries: 12,
                            maxModelCalls: 24,
                            maxDocumentsPerDay: 10,
                          },
                        },
                        items: [],
                        modelConfigured: false,
                      }
                    : [];
      await route.fulfill({json: {result}});
      return;
    }
    productRequests.push(`${request.method()} ${path}`);
    if (path === '/api/v1/workspace') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          workspaceId: WORKSPACE_ID,
          capabilities: automationEnabled ? ['entry_automation'] : [],
        },
        status: 200,
      });
      return;
    }
    if (
      (path === '/api/v1/imports/markdown' ||
        path === '/api/v1/imports/document') &&
      request.method() === 'POST'
    ) {
      const postData = request.postData() ?? '';
      options?.importRequests?.push(postData);
      if (
        importResponseIndex === 0 &&
        options?.importRequestGate !== undefined
      ) {
        await options.importRequestGate;
      }
      const importOutcome =
        options?.importOutcomes?.[importResponseIndex] ?? 'conflict';
      importResponseIndex += 1;
      if (importOutcome === 'created') {
        const body = JSON.parse(postData) as {
          commandIdempotencyKey: string;
          resource: {resourceId: string; isPrivate?: true};
          snapshot: {snapshotId: string};
        };
        await route.fulfill({
          contentType: 'application/json',
          json: {
            status: 'created',
            workspaceId: WORKSPACE_ID,
            commandIdempotencyKey: body.commandIdempotencyKey,
            resourceId: body.resource.resourceId,
            snapshotId: body.snapshot.snapshotId,
            structureId: '88888888-8888-4888-8888-888888888888',
            fragmentIds: ['99999999-9999-4999-8999-999999999999'],
            mediaAssetIds: [],
            ...(body.resource.isPrivate === true ? {isPrivate: true} : {}),
          },
          status: 201,
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'conflict', code: 'synthetic_conflict'},
        status: 409,
      });
      return;
    }
    if (path === '/api/v1/evidence') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          snapshots: splitWorkspaceEnabled ? [SYNTHETIC_SNAPSHOT] : [],
          totalCount: splitWorkspaceEnabled ? 1 : 0,
        },
        status: 200,
      });
      return;
    }
    if (
      splitWorkspaceEnabled &&
      path === `/api/v1/evidence/snapshots/${SNAPSHOT_ID}`
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', snapshot: SYNTHETIC_SNAPSHOT},
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/split-rules/profile' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', profile: splitRuleProfile},
        status: 200,
      });
      return;
    }
    if (
      splitRuleEnabled &&
      path === '/api/v1/entries/split-rules/profile' &&
      request.method() === 'PUT'
    ) {
      const body = request.postData() ?? '{}';
      options.splitRuleRequests.push({path, body});
      const next = JSON.parse(body) as Readonly<{
        mode: 'one_section' | 'merge_short_adjacent';
        minimumGroupCodePoints: number;
        maximumGroupCodePoints: number;
        maximumFragmentsPerGroup: number;
      }>;
      splitRuleProfile = {
        revision: splitRuleProfile.revision + 1,
        mode: next.mode,
        minimumGroupCodePoints: next.minimumGroupCodePoints,
        maximumGroupCodePoints: next.maximumGroupCodePoints,
        maximumFragmentsPerGroup: next.maximumFragmentsPerGroup,
      };
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'applied', profile: splitRuleProfile},
        status: 200,
      });
      return;
    }
    if (
      splitRuleEnabled &&
      path === '/api/v1/entries/split-rules/trial' &&
      request.method() === 'POST'
    ) {
      const body = request.postData() ?? '{}';
      options.splitRuleRequests.push({path, body});
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'previewed',
          trial: {
            snapshotId: SNAPSHOT_ID,
            profile: splitRuleProfile,
            sourceFragmentCount: 1,
            totalCodePointCount: 3,
            groups: [
              {
                ordinal: 0,
                titlePath: SYNTHETIC_FRAGMENT_TEXT,
                fragmentIds: [FRAGMENT_ID],
                fragmentCount: 1,
                codePointCount: 3,
                exceedsMaximum: false,
                previewText: SYNTHETIC_FRAGMENT_TEXT,
                previewTruncated: false,
              },
            ],
          },
        },
        status: 200,
      });
      return;
    }
    if (
      splitRuleEnabled &&
      path === '/api/v1/entries/split-rules/apply' &&
      request.method() === 'POST'
    ) {
      const body = request.postData() ?? '{}';
      options.splitRuleRequests.push({path, body});
      splitRuleApplied = true;
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'created',
          snapshotId: SNAPSHOT_ID,
          profileRevision: splitRuleProfile.revision,
          createdCount: 1,
          entries: [SYNTHETIC_ENTRY],
        },
        status: 201,
      });
      return;
    }
    if (
      restructureEnabled &&
      (path === '/api/v1/entries/restructure/preview' ||
        path === '/api/v1/entries/restructure/apply') &&
      request.method() === 'POST'
    ) {
      const body = request.postData() ?? '{}';
      options.restructureRequests.push({path, body});
      const payload = JSON.parse(body) as Readonly<{
        groups?: typeof currentRestructureGroups;
      }>;
      const currentCount = currentRestructureGroups.length;
      const requestedGroups = payload.groups ?? currentRestructureGroups;
      const hasChanges =
        payload.groups !== undefined &&
        JSON.stringify(requestedGroups) !==
          JSON.stringify(currentRestructureGroups);
      if (path.endsWith('/apply')) currentRestructureGroups = requestedGroups;
      const resultingCount = requestedGroups.length;
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: path.endsWith('/apply') ? 'applied' : 'preview',
          snapshotId: SNAPSHOT_ID,
          planSha256: '9'.repeat(64),
          currentGroups: currentRestructureGroups,
          hasChanges,
          currentEntryCount: currentCount,
          resultingEntryCount: resultingCount,
          insertedEntryCount: hasChanges ? resultingCount : 0,
          revisedEntryCount: 0,
          unchangedEntryCount: hasChanges ? 0 : resultingCount,
          retiredEntryCount: hasChanges ? currentCount : 0,
          annotationReviewCount: 0,
          transferredRelationshipCount: 0,
          collapsedRelationshipCount: 0,
          conflictingRelationshipCount: 0,
          successors: requestedGroups.map((group, index) => ({
            entryId: `${(index + 1).toString().padStart(8, '0')}-0000-4000-8000-000000000099`,
            operation: hasChanges ? 'insert' : 'unchanged',
            titlePath: group.titlePath,
            documentOrder: index,
            predecessorEntryIds: [ENTRY_ID],
            annotationStatus: 'preserved',
          })),
          ...(path.endsWith('/apply') ? {entries: []} : {}),
        },
        status: 200,
      });
      return;
    }
    if (
      manualSplitEnabled &&
      path === '/api/v1/entries/materialize/manual' &&
      request.method() === 'POST'
    ) {
      options.manualSplitRequests.push(request.postData() ?? '');
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'created',
          snapshotId: SNAPSHOT_ID,
          createdCount: 2,
          entries: [],
        },
        status: 200,
      });
      return;
    }
    if (path === '/api/v1/entries/saved-queries') {
      await route.fulfill({
        json: {
          status: 'ok',
          savedQueries: {version: 1, revision: 0, views: []},
        },
      });
      return;
    }
    if (path === '/api/v1/preferences/interface') {
      await route.fulfill({
        json: {status: 'ok', preferences: DEFAULT_WORKSPACE_UI_PREFERENCES},
      });
      return;
    }
    if (path === '/api/v1/preferences/review') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          workspaceId: WORKSPACE_ID,
          quickTags: [],
          automaticKeywords: {
            enabled: true,
            includeLinkDomains: false,
            excludedKeywords: [],
          },
          vocabulary: {aliases: []},
          associationPolicy: {
            revision: associationPolicy.revision,
            contentWeight: associationPolicy.contentWeight,
            typeWeight: associationPolicy.typeWeight,
            domainWeight: associationPolicy.domainWeight,
            threshold: associationPolicy.threshold,
          },
          explorationPolicy,
        },
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/preferences/profile' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', profile: entryPreferenceProfile},
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/preferences/profile/suggestions' &&
      request.method() === 'POST'
    ) {
      const body = JSON.parse(request.postData() ?? 'null') as Readonly<{
        includePrivate: boolean;
      }>;
      const requestIndex = preferenceSuggestionRequestCount++;
      options?.preferenceSuggestionScopes?.push(body.includePrivate);
      if (
        requestIndex === 0 &&
        options?.preferenceSuggestionGate !== undefined
      ) {
        await options.preferenceSuggestionGate;
      }
      const displayValue = body.includePrivate
        ? '当前隐私候选'
        : '迟到公开候选';
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          includePrivate: body.includePrivate,
          visibleEntryCount: body.includePrivate ? 2 : 1,
          totalCandidateCount: 1,
          truncated: false,
          candidates: [
            {
              dimension: 'usefulness',
              featureKind: 'content_keyword',
              featureIdentity: body.includePrivate
                ? 'current-private'
                : 'late-public',
              displayValue,
              effect: 'prefer',
              suggestedWeight: 4,
              positiveCount: 3,
              neutralCount: 0,
              negativeCount: 0,
              positiveEntryIds: [ENTRY_ID],
              neutralEntryIds: [],
              negativeEntryIds: [],
            },
          ],
        },
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/preferences/profile/trial' &&
      request.method() === 'POST'
    ) {
      const body = JSON.parse(request.postData() ?? 'null') as Readonly<{
        includePrivate: boolean;
      }>;
      const requestIndex = preferenceTrialRequestCount++;
      options?.preferenceTrialScopes?.push(body.includePrivate);
      if (requestIndex === 0 && options?.preferenceTrialGate !== undefined) {
        await options.preferenceTrialGate;
      }
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'complete',
          profile: entryPreferenceProfile,
          includePrivate: body.includePrivate,
          visibleEntryCount: 1,
          evaluatedEntryCount: 1,
          truncated: false,
          items: [
            {
              entryId:
                requestIndex === 0
                  ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                  : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              revision: 1,
              usefulnessScore: 5,
              interestScore: 4,
              matchedRules: [],
              totals: {usefulness: 0, interest: 0},
            },
          ],
        },
        status: 200,
      });
      return;
    }
    if (
      automationEnabled &&
      path === '/api/v1/entries/automation/policy' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          policy: {
            revision: 1,
            enabled: true,
            paused: false,
            profileRevision: 0,
            minimumMatchedRuleCount: 1,
            advanceThresholds: {
              usefulness: 3,
              interest: 3,
              requiredDimensions: 'either',
            },
            deferThresholds: {
              usefulness: -3,
              interest: -3,
              requiredDimensions: 'either',
            },
            budgets: {
              maximumEntriesPerRun: 20,
              maximumAdvanceCandidatesPerRun: 10,
              maximumDeferCandidatesPerRun: 10,
            },
            failureMode: 'pause',
          },
          profile: {revision: 0, enabled: false, ruleCount: 0},
        },
        status: 200,
      });
      return;
    }
    if (
      automationEnabled &&
      path === '/api/v1/entries/automation/runs' &&
      request.method() === 'GET'
    ) {
      const requestIndex = automationRunListRequestCount++;
      options.automationRunListRequests.push(request.url());
      if (requestIndex === 1 && options.automationRunListGate !== undefined) {
        await options.automationRunListGate;
      }
      const runId =
        requestIndex === 0
          ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          : requestIndex === 1
            ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
            : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          executions: [syntheticAutomationExecution(runId)],
        },
        status: 200,
      });
      return;
    }
    if (
      automationEnabled &&
      path.startsWith('/api/v1/entries/automation/runs/') &&
      request.method() === 'GET'
    ) {
      const runId = decodeURIComponent(
        path.slice('/api/v1/entries/automation/runs/'.length),
      );
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', execution: syntheticAutomationExecution(runId)},
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/exploration/policy' &&
      request.method() === 'PUT'
    ) {
      const body = JSON.parse(request.postData() ?? 'null') as Readonly<{
        enabled: boolean;
        resultShare: number;
        neighborExpansion: boolean;
        crossDomain: boolean;
        serendipity: boolean;
      }>;
      explorationPolicy = {
        revision: explorationPolicy.revision + 1,
        enabled: body.enabled,
        resultShare: body.resultShare,
        neighborExpansion: body.neighborExpansion,
        crossDomain: body.crossDomain,
        serendipity: body.serendipity,
      };
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'applied',
          policy: {
            ...explorationPolicy,
            version: 'struinfo.entry-exploration.local-association.v1',
          },
        },
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/exploration/candidates' &&
      request.method() === 'POST'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          policy: {
            ...explorationPolicy,
            version: 'struinfo.entry-exploration.local-association.v1',
          },
          anchorEntryId: ENTRY_ID,
          candidateLimit: 1,
          totalEligibleCount: 1,
          items: [
            {
              entry: SYNTHETIC_EXPLORATION_ENTRY,
              reason: 'neighbor_expansion',
              effectiveScore: 7_500,
              candidateBasis: ['content_keyword'],
              differentSnapshot: false,
            },
          ],
        },
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/knowledge-graph/view' &&
      request.method() === 'POST'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          querySha256: '9'.repeat(64),
          candidateTotalCount: 2,
          candidates: [
            {
              entry: SYNTHETIC_ENTRY,
              matchReasons: [],
              filterReasons: [],
            },
            {
              entry: SYNTHETIC_EXPLORATION_ENTRY,
              matchReasons: [],
              filterReasons: [],
            },
          ],
          graph: {
            center: SYNTHETIC_ENTRY,
            nodes: [SYNTHETIC_ENTRY, SYNTHETIC_EXPLORATION_ENTRY],
            edges: [
              {
                entryLowId: ENTRY_ID,
                entryHighId: EXPLORATION_ENTRY_ID,
                label: '内容相近',
                direction: 'symmetric',
                origin: 'automatically_calculated',
                semanticKind: 'similarity',
                verificationStatus: 'calculated',
                note: '',
                effectiveScore: 0.76,
                isBlocked: false,
                overrideRevision: 0,
              },
            ],
            hiddenEdges: [],
          },
        },
        status: 200,
      });
      return;
    }
    if (path.endsWith('/translation') && request.method() === 'GET') {
      await route.fulfill({json: {status: 'ok', translation: null}});
      return;
    }
    if (path === '/api/v1/entries/search/index') {
      await route.fulfill({
        json: {status: 'ok', index: syntheticIndexStatus(1, 0, false)},
      });
      return;
    }
    if (path === '/api/v1/entries/search') {
      const includePrivate =
        request.postData()?.includes('"includePrivate":true') ?? false;
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          querySha256: '0'.repeat(64),
          totalCount: 1,
          items: [
            {
              entry: SYNTHETIC_ENTRY,
              matchReasons: [],
              filterReasons: [],
            },
          ],
          privateDocuments: includePrivate
            ? {
                totalCount: 1,
                items: [
                  {
                    snapshot: {
                      workspaceId: WORKSPACE_ID,
                      snapshotId: SNAPSHOT_ID,
                      resourceId: RESOURCE_ID,
                      resourceKind: 'manual_text',
                      sourceKey: 'synthetic-private',
                      canonicalUri: 'https://example.invalid/private',
                      isPrivate: true,
                      capturedAt: '2026-08-23T00:00:00.000Z',
                      fragmentCount: 1,
                    },
                    matchReasons: ['body'],
                    entryMatchCount: 1,
                    excerpt: '用于浏览器回归的完整隐私文档摘要。',
                  },
                ],
              }
            : {totalCount: 0, items: []},
        },
        status: 200,
      });
      return;
    }
    if (
      path === `/api/v1/entries/${ENTRY_ID}/associations` &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          entryId: ENTRY_ID,
          totalCount: 0,
          policy: associationPolicy,
          associations: [],
        },
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/associations/policy' &&
      request.method() === 'PUT'
    ) {
      associationPolicy = {
        ...associationPolicy,
        revision: 1,
        contentWeight: 50,
        typeWeight: 25,
        domainWeight: 25,
      };
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'applied', policy: associationPolicy},
        status: 200,
      });
      return;
    }
    if (
      path === '/api/v1/entries/associations/rebuild' &&
      request.method() === 'POST'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'rebuilt',
          entryCount: 1,
          projectedCount: 0,
          policy: associationPolicy,
        },
        status: 200,
      });
      return;
    }
    if (path === '/api/v1/entry-documents') {
      const documents = splitWorkspaceEnabled
        ? [
            {
              ...SYNTHETIC_DOCUMENT,
              entryCount: restructureEnabled
                ? currentRestructureGroups.length
                : splitRuleApplied
                  ? 1
                  : 0,
            },
          ]
        : [];
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', totalCount: documents.length, documents},
        status: 200,
      });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      json: {status: 'failed', issue: {code: 'unexpected_test_request'}},
      status: 501,
    });
  });

  return productRequests;
}

async function openReceiptDetails(page: Page) {
  const menu = page.getByRole('button', {name: '更多接收操作', exact: true});
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.getByRole('button', {name: '接收详情与正文恢复'}).click();
}

test('P3 previews and enables a document recipe without changing the reading layout', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page, {manualSplitRequests: []});
  const operations: string[] = [];
  const catalog: SourceSplitCatalogView = {
    revision: 0,
    sourceId: null,
    recipes: [],
  };
  const plan = {
    outcome: 'ready',
    reason: 'recipe_ready',
    groups: [{title: '合成文档', start: 0, end: 3}],
    characters: 3,
    completeCoverage: true,
  };
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        definition: SourceSplitDefinition;
        note: string;
        action: string;
        sampleKind: 'typical' | 'variant' | 'exception';
        expected: 'ready' | 'review';
      };
    };
    if (!operation.startsWith('split_recipe')) {
      await route.fallback();
      return;
    }
    operations.push(operation);
    let result: unknown = catalog;
    if (operation === 'split_recipe_preview') result = plan;
    if (operation === 'split_recipe_save') {
      catalog.revision++;
      catalog.recipes = [
        {
          ...input.definition,
          status: 'draft',
          approval: null,
          replaces: null,
          trials: [],
        },
      ];
    }
    const recipe = catalog.recipes[0];
    if (recipe && operation === 'split_recipe_trial') {
      catalog.revision++;
      recipe.status = 'trial';
      recipe.trials = [
        {
          snapshotId: SNAPSHOT_ID,
          recipeRevision: recipe.revision,
          sampleKind: input.sampleKind,
          expected: input.expected,
          outcome: 'ready',
          reason: 'recipe_ready',
          entryCount: 1,
        },
      ];
      result = {catalog, plan};
    }
    if (recipe && operation === 'split_recipe_control') {
      catalog.revision++;
      recipe.status = input.action === 'enable' ? 'enabled' : 'paused';
      result = catalog;
    }
    if (operation === 'split_recipe_apply') result = {createdCount: 1};
    await route.fulfill({json: {result}});
  });
  await page.goto('/');
  await openWorkspace(page, '工作台');
  await openDocumentEditor(page);
  await page
    .locator('.reader-editor-actions')
    .getByRole('button', {name: '拆分方案', exact: true})
    .click();
  const panel = page.getByRole('region', {name: '拆分方案', exact: true});
  await panel
    .getByRole('textbox', {name: '方案名称', exact: true})
    .fill('合成整篇方案');
  await panel.getByRole('button', {name: '预览切点', exact: true}).click();
  await expect(
    panel.getByRole('heading', {name: '1 个条目 · 原文完整覆盖'}),
  ).toBeVisible();
  expect(operations).not.toContain('split_recipe_apply');
  await panel.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '应用到当前文档', exact: true}),
  ).toBeDisabled();
  await panel.getByRole('button', {name: '记录本篇试读', exact: true}).click();
  await expect(panel.getByText('当前文档 · 1 条 · 符合预期')).toBeVisible();
  await panel
    .getByRole('textbox', {name: '核对说明', exact: true})
    .fill('已核对原文范围，整篇阅读。');
  await panel.getByRole('button', {name: '启用方案', exact: true}).click();
  await panel
    .getByRole('button', {name: '应用到当前文档', exact: true})
    .click();
  await expect(panel.getByText('已生成 1 个条目，确认后入库。')).toBeVisible();
  await expect(
    panel.getByRole('textbox', {name: '方案名称', exact: true}),
  ).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1000});

    await panel.getByRole('button', {name: '暂停方案', exact: true}).focus();
    await expect(
      panel.getByRole('button', {name: '暂停方案', exact: true}),
    ).toBeFocused();
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await panel.evaluate((el) => {
      el.scrollTop = 0;
      for (const child of el.querySelectorAll('*'))
        if (child.scrollHeight > child.clientHeight) child.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath('p3-recipe-' + String(width) + '.png'),
      animations: 'disabled',
    });
    await expect(
      panel.getByRole('button', {name: '关闭拆分方案', exact: true}),
    ).toBeInViewport();
  }
  await panel.getByRole('button', {name: '暂停方案', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '应用到当前文档', exact: true}),
  ).toBeDisabled();
  await panel.getByRole('button', {name: '关闭拆分方案', exact: true}).focus();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  expect(operations.filter((op) => op === 'split_recipe_apply')).toHaveLength(
    1,
  );
  expect(operations).not.toContain('split_recipe_suggest');
});

async function openDocumentEditor(page: Page) {
  if (
    await page.getByRole('dialog', {name: '编辑文档', exact: true}).isVisible()
  )
    return;
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '编辑', exact: true}).click();
}
async function closeFloatingTools(page: Page) {
  while (await page.locator('dialog[open], :popover-open').count()) {
    await page.keyboard.press('Escape');
  }
}
async function submitQuery(page: Page) {
  await closeFloatingTools(page);
  await page
    .getByRole('search')
    .getByRole('button', {name: '搜索', exact: true})
    .click();
}
async function openQuerySettings(page: Page, name = '筛选与匹配方式') {
  if (['筛选与匹配方式', '查询管理', '索引维护'].includes(name)) {
    // Filters now live in the left scope panel; matching and index controls live in a dialog.
    if (name === '筛选与匹配方式') {
      const opener = page.getByRole('button', {
        name: '展开内容范围',
        exact: true,
      });
      if (await opener.isVisible()) await opener.click();
      for (const group of ['分类与标签', '来源', '时间', '更多筛选']) {
        const detail = page
          .locator('.side-left details.filter-group')
          .filter({has: page.locator('summary').filter({hasText: group})})
          .first();
        if (
          (await detail.count()) &&
          (await detail.getAttribute('open')) === null
        )
          await detail.locator(':scope > summary').click();
      }
      const structured = page.locator('.side-left .nested-options');
      if (
        (await structured.count()) &&
        (await structured.getAttribute('open')) === null
      )
        await structured.locator('summary').click();
      return;
    }
    if (
      !(await page
        .getByRole('dialog', {name: '搜索设置', exact: true})
        .isVisible())
    )
      await page.getByRole('button', {name: '搜索设置 ⌄', exact: true}).click();
    if (name === '索引维护') {
      const d = page
        .getByRole('dialog', {name: '搜索设置', exact: true})
        .locator('details')
        .filter({hasText: '索引维护'});
      if ((await d.getAttribute('open')) === null)
        await d.locator(':scope > summary').click();
    }
    return;
  }
  const readingSections = ['阅读设置', '资料清单与导出', '比较与探索'];
  if (readingSections.includes(name)) {
    await openQuerySettings(page, '阅读与导出');
    return;
  }
  const trigger = page.getByRole('button', {name, exact: true});
  // Native popover state remains current when a test pauses queued toggle events.
  const expanded = await trigger.evaluate((button) => {
    const id = button.getAttribute('aria-controls');
    const surface = id ? document.getElementById(id) : null;
    return surface?.hasAttribute('popover')
      ? surface.matches(':popover-open')
      : button.getAttribute('aria-expanded') === 'true';
  });
  if (!expanded) await trigger.click();
}

test('keeps floating reading controls from resizing the document', async ({
  page,
}) => {
  await installJourneyApi(page);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '查询');
  const paper = page.locator('.entry-readonly-detail');
  await expect(paper).toBeVisible();
  const before = await paper.boundingBox();
  for (const name of ['搜索设置 ⌄', '阅读与导出']) {
    await page.getByRole('button', {name, exact: true}).click();
    await expect(
      name === '阅读与导出'
        ? page.locator('.floating-tool-panel__surface:popover-open')
        : page.getByRole('dialog', {name: '搜索设置'}),
    ).toBeVisible();
    expect(await paper.boundingBox()).toEqual(before);
    await page.keyboard.press('Escape');
  }
});

test('recovers an existing working copy inside its document without rewriting original evidence', async ({
  page,
}) => {
  await installCurrentProductApi(page, {
    splitRuleRequests: [],
  });
  const workingCopyMethods: string[] = [];
  const draftWrites: unknown[] = [];
  const originalText = '用于全文草稿回归的合成正文。';
  const editedText = '用于全文草稿回归的合成修改。';
  await page.route('**/working-copy**', async (route) => {
    const request = route.request();
    workingCopyMethods.push(request.method());
    const editing = request.method() === 'PUT';
    if (editing) draftWrites.push(request.postDataJSON());
    await route.fulfill({
      json: {
        status: 'ok',
        workingCopy: {
          sourceSnapshotId: SNAPSHOT_ID,
          revision: editing ? 1 : 0,
          state: editing ? 'editing' : 'original',
          originalText,
          currentText: editing ? editedText : originalText,
          changed: editing,
        },
      },
    });
  });
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        documents: [
          {
            ...SYNTHETIC_DOCUMENT,
            entryCount: 0,
            workingCopy: {revision: 1, state: 'editing'},
          },
        ],
      },
    }),
  );
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '修改分段', exact: true}).click();
  const workingCopy = page.locator('.information-document-working-copy');
  const editor = workingCopy.getByRole('textbox', {
    name: '当前全文',
    exact: true,
  });
  await expect(editor).toHaveValue(originalText);
  await editor.fill(editedText);
  await workingCopy
    .getByRole('button', {name: '保存当前修改', exact: true})
    .click();
  await expect(
    workingCopy.getByText('当前全文修改已保存', {exact: true}),
  ).toBeVisible();
  expect(workingCopyMethods).toEqual(['GET', 'PUT']);
  expect(draftWrites).toEqual([
    {
      expectedRevision: 0,
      includePrivate: false,
      text: editedText,
    },
  ]);
  await workingCopy
    .locator('summary')
    .filter({hasText: '对照原始全文'})
    .click();
  await expect(workingCopy.locator('pre')).toHaveText(originalText);
  await expect(
    workingCopy.getByRole('button', {
      name: '确认并生成新文档',
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole('button', {name: '关闭处理已有全文草稿', exact: true})
    .click();
  await expect(editor).not.toBeVisible();
  expect(workingCopyMethods).toEqual(['GET', 'PUT']);
});

test('exposes exactly four document-centred pages with settings outside primary navigation', async ({
  page,
}) => {
  const requests = await installCurrentProductApi(page);
  await page.goto('/');
  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await expect(navigation.getByRole('button')).toHaveCount(4);
  for (const name of ['总览', '源管理', '文档阅读', '数据库']) {
    await navigation.getByRole('button', {name, exact: true}).click();
    await expect(
      page.getByRole('heading', {
        name: name === '总览' ? 'StruInfo' : name,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
  }
  await expect(navigation.getByRole('button', {name: '设置'})).toHaveCount(0);
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '设置', level: 1}),
  ).toBeVisible();
  expect(
    requests.some((r) =>
      /\/api\/v1\/(curation|knowledge|search)(?:\/|$)/u.test(r),
    ),
  ).toBe(false);
});

test('imports exact local UTF-8 bytes and preserves retry identity', async ({
  page,
}) => {
  const importRequests: string[] = [];
  await installCurrentProductApi(page, {importRequests});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '导入', navigation);
  await page.getByRole('radio', {name: '本地文件', exact: true}).check();
  await page.locator('#local-document-file').setInputFiles({
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic\r\nBody 😀\r\n', 'utf8'),
  });

  await expect(page.getByText('synthetic.txt', {exact: true})).toBeVisible();
  await expect(page.getByLabel('文件正文预览')).toHaveValue(
    'Synthetic\nBody 😀\n',
  );
  await page.getByRole('checkbox', {name: /作为隐私文档录入/u}).check();
  await page.getByRole('button', {name: '导入文档', exact: true}).click();
  await expect(page.getByText('导入命令发生冲突', {exact: true})).toBeVisible();

  await page.getByRole('button', {name: '导入文档', exact: true}).click();
  expect(importRequests).toHaveLength(2);

  const first = JSON.parse(importRequests[0] ?? 'null') as unknown;
  const second = JSON.parse(importRequests[1] ?? 'null') as unknown;
  expect(first).toMatchObject({
    resource: {
      resourceKind: 'uploaded_file',
      sourceKey:
        'synthetic.txt#sha256:a1c3cc0c426a448cde3c4f92b73a887e7d95c4a88487d4cf51df28047ffc499c',
      isPrivate: true,
    },
    snapshot: {mediaType: 'text/plain'},
    profile: 'commonmark-v1',
    sourceBase64: 'U3ludGhldGljDQpCb2R5IPCfmIANCg==',
  });
  expect(first).not.toHaveProperty('sourceText');
  expect(JSON.stringify(first)).not.toContain('C:\\');
  expect(second).toEqual(first);
});

test('imports an explicit local file batch and retries only failed items with the same identity', async ({
  page,
}) => {
  const importRequests: string[] = [];
  await installCurrentProductApi(page, {
    importRequests,
    importOutcomes: ['created', 'conflict', 'created'],
  });
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '导入', navigation);
  await page.getByRole('radio', {name: '本地文件', exact: true}).check();
  await page.getByRole('radio', {name: '多份批次', exact: true}).check();
  await page.locator('#local-document-batch-files').setInputFiles([
    {
      name: 'synthetic-a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# A\n\nSynthetic A', 'utf8'),
    },
    {
      name: 'synthetic-a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# B\n\nSynthetic B', 'utf8'),
    },
  ]);

  await expect(
    page.getByRole('button', {name: '导入 2 份就绪文件', exact: true}),
  ).toBeEnabled();
  await expect(
    page.getByRole('radio', {name: '手动文本', exact: true}),
  ).toBeDisabled();
  await expect(
    page.getByRole('radio', {name: '单份文件', exact: true}),
  ).toBeDisabled();
  await page
    .getByRole('button', {name: '导入 2 份就绪文件', exact: true})
    .click();
  await expect(page.getByText(/成功 1 · 失败 1 · 已停止 0/u)).toBeVisible();
  await expect(
    page.getByRole('button', {name: '重试失败与已停止项', exact: true}),
  ).toBeVisible();

  await page
    .getByRole('button', {name: '重试失败与已停止项', exact: true})
    .click();
  await expect(page.getByText(/成功 2 · 失败 0 · 已停止 0/u)).toBeVisible();
  expect(importRequests).toHaveLength(3);

  const first = JSON.parse(importRequests[0] ?? 'null') as {
    commandIdempotencyKey: string;
    resource: {resourceId: string; sourceKey: string};
    snapshot: {snapshotId: string};
  };
  const failed = JSON.parse(importRequests[1] ?? 'null') as {
    resource: {sourceKey: string};
  };
  const retry = JSON.parse(importRequests[2] ?? 'null') as unknown;
  expect(first.resource.sourceKey).toMatch(/^synthetic-a\.md#sha256:/u);
  expect(failed.resource.sourceKey).toMatch(/^synthetic-a\.md#sha256:/u);
  expect(failed.resource.sourceKey).not.toBe(first.resource.sourceKey);
  expect(failed).toEqual(retry);
  expect(JSON.stringify(importRequests)).not.toContain('C:\\');

  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('heading', {name: '多文件导入队列', exact: true}),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('stops a local batch after the in-flight file without starting later files', async ({
  page,
}) => {
  const importRequests: string[] = [];
  const gate = controlledGate();
  await installCurrentProductApi(page, {
    importRequests,
    importOutcomes: ['created', 'created'],
    importRequestGate: gate.promise,
  });
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '导入', navigation);
  await page.getByRole('radio', {name: '本地文件', exact: true}).check();
  await page.getByRole('radio', {name: '多份批次', exact: true}).check();
  await page.locator('#local-document-batch-files').setInputFiles([
    {
      name: 'synthetic-stop-a.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic stop A', 'utf8'),
    },
    {
      name: 'synthetic-stop-b.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic stop B', 'utf8'),
    },
  ]);

  await page
    .getByRole('button', {name: '导入 2 份就绪文件', exact: true})
    .click();
  await expect(
    page.getByRole('checkbox', {name: /作为隐私文档录入/u}),
  ).toBeDisabled();
  await page.getByRole('button', {name: '停止后续导入', exact: true}).click();
  gate.release();

  await expect(page.getByText(/成功 1 · 失败 0 · 已停止 1/u)).toBeVisible();
  expect(importRequests).toHaveLength(1);
});

test('edits association weights and opens the complete private-document channel', async ({
  page,
}) => {
  const productRequests = await installCurrentProductApi(page);
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '联系', navigation);
  await expect(
    page.getByRole('heading', {name: '联系推荐', exact: true}),
  ).toBeVisible();

  await page.getByLabel('内容相似度数值').fill('50');
  await page.getByLabel('类型相似度数值').fill('25');
  await page.getByLabel('领域相似度数值').fill('25');
  await page
    .getByRole('button', {name: '保存权重并重建联系', exact: true})
    .click();
  await expect(
    page.getByText('联系设置已保存，公开推荐已更新。人工关系保持原有设置。', {
      exact: true,
    }),
  ).toBeVisible();

  await openWorkspace(page, '查询');
  await openQuerySettings(page);
  await page.getByLabel('隐私结果').selectOption({label: '公开与隐私结果'});
  await submitQuery(page);

  await expect(
    page.getByRole('heading', {name: '完整隐私文档', exact: true}),
  ).toBeVisible();
  await expect(
    page.getByText('synthetic-private', {exact: true}),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {name: '查看完整隐私文档', exact: true}),
  ).toBeVisible();

  expect(productRequests).toContain('PUT /api/v1/entries/associations/policy');
  expect(productRequests).toContain(
    'POST /api/v1/entries/associations/rebuild',
  );
});

test('keeps exploration separate, explicit, and responsive across target widths', async ({
  page,
}) => {
  const productRequests = await installCurrentProductApi(page);
  let releaseSearch: () => void = () => undefined;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route('**/api/v1/entries/search', async (route) => {
    await searchGate;
    await route.fallback();
  });
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  await openWorkspace(page, '查询');
  await openQuerySettings(page, '比较与探索');

  await expect(
    page.getByRole('heading', {name: '探索推荐', exact: true}),
  ).toBeVisible();
  const generate = page.getByRole('button', {
    name: '生成探索推荐',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', {name: /启用独立探索/u}).check();
  await page.getByLabel('当前页探索份额').fill('50');
  // A delayed initial query must not remount the independent policy draft.
  releaseSearch();
  await expect(
    page.getByRole('heading', {
      name: SYNTHETIC_ENTRY.value.titlePath,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', {name: /启用独立探索/u}),
  ).toBeChecked();
  await expect(page.getByLabel('当前页探索份额')).toHaveValue('50');
  await page.getByRole('button', {name: '保存探索设置', exact: true}).click();
  await expect(generate).toBeEnabled();
  await generate.click();

  await expect(
    page.getByRole('heading', {name: '合成探索 Entry', exact: true}),
  ).toBeVisible();
  await expect(
    page.locator('.entry-exploration-card__reason', {
      hasText: '邻域扩展',
    }),
  ).toBeVisible();
  await expect(page.getByText('搜索结果保留', {exact: false})).toBeVisible();
  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('heading', {name: '探索推荐', exact: true}),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.getByLabel('关键词或问题').fill('新的查询范围');
  await expect(
    page.getByRole('heading', {name: '合成探索 Entry', exact: true}),
  ).toBeHidden();
  await expect(
    page.getByText('选择一个查询结果后，可以生成探索推荐。', {
      exact: true,
    }),
  ).toBeHidden();
  await openQuerySettings(page, '比较与探索');
  await expect(
    page.getByText('选择一个查询结果后，可以生成探索推荐。', {
      exact: true,
    }),
  ).toBeVisible();
  expect(productRequests).toContain('PUT /api/v1/entries/exploration/policy');
  expect(productRequests).toContain(
    'POST /api/v1/entries/exploration/candidates',
  );
});

test('cancels inline segment edits without writing or changing immutable source', async ({
  page,
}) => {
  const writes: string[] = [];
  const {snapshot} = await installJourneyApi(page, writes);
  await page.goto('/');
  await openWorkspace(page, '资料库');
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '修改分段', exact: true}).click();
  await page
    .getByRole('button', {name: '＋ 在这里分段', exact: true})
    .first()
    .click();
  await page.getByLabel('条目 2 标题', {exact: true}).fill('合成分段草稿');
  expect(writes).toEqual([]);
  await page.getByRole('button', {name: '取消本次分段', exact: true}).click();
  await expect(page.locator('.inline-structure-editor')).toHaveCount(0);
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '修改分段', exact: true}).click();
  await expect(page.getByLabel('条目 2 标题', {exact: true})).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(snapshot.structures[0]?.normalizedText).toContain(
    '第三段保留原文结论',
  );
});

test('saves shared splitting rules in settings without applying them to a document', async ({
  page,
}) => {
  const splitRuleRequests: Readonly<{path: string; body: string}>[] = [];
  await installCurrentProductApi(page, {splitRuleRequests});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '拆分', navigation);
  const panel = page.locator('.split-rule-panel');
  await expect(
    panel.getByRole('heading', {name: '结构规则', exact: true}),
  ).toBeVisible();
  await panel.getByRole('radio', {name: /合并相邻短段/u}).check();
  await panel.getByLabel('期望最短字符数').fill('250');
  await panel.getByLabel('允许最长字符数').fill('2500');
  await panel.getByLabel('单组最多结构段').fill('6');
  await panel.getByRole('button', {name: '保存规则', exact: true}).click();
  await expect(panel.getByText('拆分规则已保存', {exact: true})).toBeVisible();
  await expect(
    panel.getByRole('button', {name: '预览当前文档', exact: true}),
  ).toHaveCount(0);

  expect(splitRuleRequests.map((item) => item.path)).toEqual([
    '/api/v1/entries/split-rules/profile',
  ]);
  expect(JSON.parse(splitRuleRequests[0]?.body ?? '{}')).toEqual({
    expectedRevision: 0,
    mode: 'merge_short_adjacent',
    minimumGroupCodePoints: 250,
    maximumGroupCodePoints: 2500,
    maximumFragmentsPerGroup: 6,
  });
  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('previews existing structure changes before confirming with the plan version', async ({
  page,
}) => {
  const writes: Readonly<{path: string; body: string}>[] = [];
  await installCurrentProductApi(page, {restructureRequests: writes});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '修改分段', exact: true}).click();
  const title = page.getByLabel('条目 1 标题', {exact: true});
  await expect(title).toBeVisible();
  await title.fill('确认后的合成标题');
  await page.getByRole('button', {name: '预览变更影响', exact: true}).click();
  await expect(
    page.getByRole('button', {name: '确认分段并入库', exact: true}),
  ).toBeEnabled();
  expect(writes.filter((r) => r.path.endsWith('/apply'))).toHaveLength(0);
  await page.getByRole('button', {name: '确认分段并入库', exact: true}).click();
  await expect
    .poll(() => writes.filter((r) => r.path.endsWith('/apply')).length)
    .toBe(1);
  expect(
    JSON.parse(writes.find((r) => r.path.endsWith('/apply'))?.body ?? '{}'),
  ).toMatchObject({
    snapshotId: SNAPSHOT_ID,
    planSha256: '9'.repeat(64),
    groups: [{titlePath: '确认后的合成标题'}],
  });
});

async function installGraphReadCandidate(page: Page) {
  await installCurrentProductApi(page);
  const nodes = Array.from({length: 14}, (_, ordinal) => ({
    ...SYNTHETIC_ENTRY,
    entryId:
      '44444444-4444-4444-8444-' + (ordinal + 1).toString().padStart(12, '0'),
    value: {
      ...SYNTHETIC_ENTRY.value,
      documentOrder: ordinal,
      isPrivate: ordinal === 13,
      titlePath:
        ordinal === 0
          ? '合成图谱中心'
          : ordinal === 13
            ? '合成隐私目标'
            : '合成关系条目 ' + ordinal.toString(),
    },
  }));
  const writes: Record<string, unknown>[] = [];
  const edits = new Map<string, Record<string, unknown>>();
  const reads: Record<string, unknown>[] = [];
  let evidenceGate: Promise<void> | undefined;
  let evidenceFailure = false;
  let graphGate: Promise<void> | undefined;
  let writeGate: Promise<void> | undefined;
  await page.route('**/api/v1/knowledge-graph/**', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const path = new URL(route.request().url()).pathname;
    if (path !== '/api/v1/knowledge-graph/view') {
      writes.push(body);
      const pendingWrite = writeGate;
      writeGate = undefined;
      if (pendingWrite !== undefined) await pendingWrite;
      const pair = path
        .split('/')
        .filter((part) => /^[0-9a-f-]{36}$/u.test(part))
        .sort()
        .join(':');
      const previous = edits.get(pair) ?? {};
      edits.set(pair, {
        ...previous,
        ...body,
        overrideRevision: Number(body.expectedRevision) + 1,
      });
      await route.fulfill({json: {status: 'applied'}});
      return;
    }
    reads.push(body);
    if (body.query === 'synthetic-failure') {
      await route.fulfill({
        status: 503,
        json: {status: 'failed', issue: {code: 'synthetic_unavailable'}},
      });
      return;
    }
    if (body.query === 'synthetic-empty') {
      await route.fulfill({
        json: {
          status: 'ok',
          querySha256: '9'.repeat(64),
          candidateTotalCount: 0,
          candidates: [],
          graph: null,
        },
      });
      return;
    }
    const wait = graphGate;
    graphGate = undefined;
    if (wait !== undefined) await wait;
    const visible = nodes.filter((node) =>
      body.onlyPrivate === true
        ? node.value.isPrivate
        : body.includePrivate === true || !node.value.isPrivate,
    );
    const center =
      visible.find((node) => node.entryId === body.centerEntryId) ?? visible[0];
    const edges =
      center === undefined
        ? []
        : visible
            .filter((node) => node !== center && !node.value.isPrivate)
            .slice(0, 12)
            .map((node, ordinal) => {
              const [entryLowId, entryHighId] = [
                center.entryId,
                node.entryId,
              ].sort();
              const changed = edits.get([entryLowId, entryHighId].join(':'));
              return {
                entryLowId,
                entryHighId,
                label: 'similarity',
                direction: 'symmetric',
                semanticKind: 'similarity',
                verificationStatus: 'calculated',
                note: '合成相似度依据',
                effectiveScore: 7600,
                overrideRevision: 0,
                origin:
                  ordinal === 1
                    ? 'ai_assisted'
                    : ordinal === 2
                      ? 'user_created'
                      : 'automatically_calculated',
                ...changed,
                ...(changed?.operation === 'edit'
                  ? {origin: 'user_edited'}
                  : {}),
                isBlocked: changed?.operation === 'block',
              };
            });
    await route.fulfill({
      json: {
        status: 'ok',
        querySha256: '9'.repeat(64),
        candidateTotalCount: visible.length,
        candidates: visible.map((entry) => ({
          entry,
          matchReasons: [],
          filterReasons: [],
        })),
        graph:
          center === undefined
            ? null
            : {
                center,
                nodes: visible,
                edges: edges.filter((edge) => !edge.isBlocked),
                hiddenEdges: edges.filter((edge) => edge.isBlocked),
              },
      },
    });
  });
  await page.route('**/api/v1/evidence/snapshots/*', async (route) => {
    if (evidenceFailure) {
      evidenceFailure = false;
      await route.fulfill({status: 503, json: {status: 'failed'}});
      return;
    }
    const wait = evidenceGate;
    evidenceGate = undefined;
    if (wait !== undefined) await wait;
    await route.fulfill({json: {status: 'ok', snapshot: SYNTHETIC_SNAPSHOT}});
  });
  return {
    writes,
    reads,
    failEvidence() {
      evidenceFailure = true;
    },
    holdEvidence(gate: Promise<void>) {
      evidenceGate = gate;
    },
    holdWrite(gate: Promise<void>) {
      writeGate = gate;
    },
    acceptSyntheticProposal() {
      const pair = nodes
        .slice(0, 2)
        .map((node) => node.entryId)
        .sort()
        .join(':');
      edits.set(pair, {
        origin: 'ai_assisted',
        label: '合成接受关系',
        overrideRevision: 1,
      });
    },
    holdGraph(gate: Promise<void>) {
      graphGate = gate;
    },
  };
}

test('keeps the radial graph, equivalent list and source controls operable', async ({
  page,
}, testInfo) => {
  const fixture = await installGraphReadCandidate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(message.text() + ' ' + message.location().url);
  });
  await page.goto('/');
  await openWorkspace(page, '知识');
  const graph = page.getByRole('group', {name: '条目关系图', exact: true});
  await expect(graph.locator('.knowledge-radial-edge')).toHaveCount(12);
  await expect(graph.locator('[data-origin="ai_assisted"]')).toHaveAttribute(
    'aria-label',
    /AI/,
  );
  await expect(graph.locator('[data-origin="user_created"]')).toHaveAttribute(
    'aria-label',
    /用户创建/,
  );
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await expect(graph).toBeVisible();
    if (width >= 1024) {
      const frame = await page.locator('.reading-graph-frame').boundingBox();
      if (!frame) throw new Error('Missing reading graph frame');
      expect(frame.y + frame.height).toBeLessThanOrEqual(984);
      for (const selector of [
        '.knowledge-network-panel',
        '.knowledge-inspector',
      ]) {
        const panel = await page.locator(selector).boundingBox();
        if (!panel) throw new Error('Missing ' + selector);
        expect(panel.y + panel.height).toBeLessThanOrEqual(
          frame.y + frame.height,
        );
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const nodeOverlap = await graph
      .locator('.knowledge-node')
      .evaluateAll((nodes) => {
        const boxes = nodes.map((node) => node.getBoundingClientRect());
        return boxes.some((box, index) =>
          boxes
            .slice(index + 1)
            .some(
              (other) =>
                Math.min(box.right, other.right) -
                  Math.max(box.left, other.left) >
                  1 &&
                Math.min(box.bottom, other.bottom) -
                  Math.max(box.top, other.top) >
                  1,
            ),
        );
      });
    expect(nodeOverlap, 'Graph node overlap at ' + width.toString()).toBe(
      false,
    );
    const edge = graph.locator('.knowledge-radial-edge').first();
    await edge.focus();
    await edge.press('Enter');
    await expect(page.locator('.knowledge-edge-inspector')).toContainText(
      '建立原因',
    );
    await page
      .locator('.formal-knowledge-workspace')
      .evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
      });
    const clippedControls = await page
      .locator(
        '.knowledge-command-panel, .knowledge-candidate-strip, .knowledge-inspector',
      )
      .evaluateAll((panels) =>
        panels.flatMap((panel) => {
          const panelBounds = panel.getBoundingClientRect();
          return Array.from(
            panel.querySelectorAll('button, input, select, textarea'),
          )
            .filter((control) => {
              const bounds = control.getBoundingClientRect();
              return (
                bounds.width > 0 &&
                (bounds.left < Math.max(0, panelBounds.left) - 1 ||
                  bounds.right >
                    Math.min(window.innerWidth, panelBounds.right) + 1)
              );
            })
            .map(
              (control) =>
                control.getAttribute('aria-label') ??
                (control.textContent || control.tagName),
            );
        }),
      );
    expect(
      clippedControls,
      'Clipped controls at ' + width.toString() + 'px',
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('graph-' + width.toString() + '.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  for (const height of [720, 900]) {
    await page.setViewportSize({width: 1440, height});
    const frame = await page.locator('.reading-graph-frame').boundingBox();
    if (!frame) throw new Error('Missing reading graph frame');
    expect(frame.y + frame.height).toBeLessThanOrEqual(height - 16);
    const inspector = await page.locator('.knowledge-inspector').boundingBox();
    if (!inspector) throw new Error('Missing graph inspector');
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(
      frame.y + frame.height,
    );
    await expect(
      graph.locator('[data-knowledge-graph-center="true"]'),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath('graph-height-' + height.toString() + '.png'),
      animations: 'disabled',
    });
  }
  await page.getByRole('button', {name: '关系列表', exact: true}).click();
  await expect(page.locator('.knowledge-relation-list li')).toHaveCount(12);
  const listEdge = page
    .locator('.knowledge-relation-list li')
    .first()
    .getByRole('button')
    .first();
  await listEdge.focus();
  await listEdge.press('Space');
  const inspector = page.locator('.knowledge-edge-inspector');
  const source = inspector.getByRole('button', {
    name: '查看中心来源',
    exact: true,
  });
  await source.click();
  await expect(page.locator('.excerpt-panel blockquote')).toHaveText(
    SYNTHETIC_FRAGMENT_TEXT,
  );
  await page.getByRole('button', {name: '关闭来源原文'}).click();
  await expect(source).toBeFocused();
  const relatedSource = inspector.getByRole('button', {
    name: '查看相关项来源',
    exact: true,
  });
  await relatedSource.click();
  await expect(page.locator('.excerpt-panel blockquote')).toHaveText(
    SYNTHETIC_FRAGMENT_TEXT,
  );
  await page.getByRole('button', {name: '关闭来源原文'}).click();
  await expect(relatedSource).toBeFocused();
  await inspector.getByLabel('关系名称', {exact: true}).fill('合成已检查关系');
  await inspector
    .getByRole('combobox', {name: '方向', exact: true})
    .selectOption('low_to_high');
  await inspector
    .getByRole('combobox', {name: '原文核对', exact: true})
    .selectOption('source_checked');
  await inspector.getByRole('button', {name: '保存关系', exact: true}).click();
  await expect(page.getByText('关系已保存', {exact: true})).toBeVisible();
  await page
    .locator('.knowledge-relation-list li')
    .first()
    .getByRole('button')
    .first()
    .click();
  await expect(inspector).toContainText('用户编辑');
  await expect(
    inspector.getByRole('combobox', {name: '方向', exact: true}),
  ).toHaveValue('low_to_high');
  await inspector
    .getByRole('button', {name: '隐藏这条边', exact: true})
    .click();
  await expect(page.locator('.knowledge-relation-list li')).toHaveCount(11);
  await page.locator('.knowledge-hidden-relations summary').click();
  await page
    .locator('.knowledge-hidden-relations')
    .getByRole('button', {name: '恢复', exact: true})
    .click();
  await expect(page.locator('.knowledge-relation-list li')).toHaveCount(12);
  expect(fixture.writes.map((write) => write.operation)).toEqual([
    'edit',
    'block',
    'restore',
  ]);
  expect(fixture.writes.map((write) => write.expectedRevision)).toEqual([
    0, 1, 2,
  ]);
  await page.getByRole('button', {name: '图谱', exact: true}).click();
  const related = graph.locator('[data-knowledge-graph-related]').first();
  await related.focus();
  await related.press('Enter');
  await page
    .locator('.knowledge-node-inspector')
    .getByRole('button', {name: '设为新中心', exact: true})
    .click();
  await expect(graph.locator('[data-knowledge-graph-center]')).toContainText(
    '合成关系条目 1',
  );
  await page.emulateMedia({reducedMotion: 'reduce', forcedColors: 'active'});
  await expect(graph).toBeVisible();
  expect(
    await graph
      .locator('.knowledge-node')
      .first()
      .evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).transitionDuration),
      ),
  ).toBeLessThanOrEqual(0.001);
  await page.screenshot({
    path: testInfo.outputPath('graph-forced-colors.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('discards graph targets from a former privacy scope and closed source requests', async ({
  page,
}) => {
  const fixture = await installGraphReadCandidate(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');
  await openWorkspace(page, '知识');
  await page
    .getByRole('combobox', {name: '隐私范围', exact: true})
    .selectOption('include_private');
  await expect(page.locator('.knowledge-candidate-strip')).toContainText(
    '合成隐私目标',
  );
  const creator = page.locator('.knowledge-create-relation');
  await creator.getByLabel('查找另一个条目', {exact: true}).fill('合成');
  await creator.getByRole('button', {name: '查找', exact: true}).click();
  await expect(
    creator.getByRole('combobox', {name: '目标条目', exact: true}),
  ).toContainText('合成隐私目标');
  await page
    .getByRole('combobox', {name: '隐私范围', exact: true})
    .selectOption('public');
  await expect(page.locator('.knowledge-node-inspector')).toContainText(
    '合成图谱中心',
  );
  await expect(
    creator.getByRole('combobox', {name: '目标条目', exact: true}),
  ).toHaveCount(0);
  const gate = controlledGate();
  fixture.holdEvidence(gate.promise);
  const source = page
    .locator('.knowledge-node-inspector')
    .getByRole('button', {name: '查看原文', exact: true});
  await source.click();
  const close = page.getByRole('button', {name: '关闭来源原文'});
  await expect(close).toBeFocused();
  await close.press('Escape');
  await expect(close).toHaveCount(0);
  const response = page.waitForResponse('**/api/v1/evidence/snapshots/*');
  gate.release();
  await response;
  await expect(close).toHaveCount(0);
  await expect(source).toBeFocused();
  fixture.failEvidence();
  await source.click();
  await expect(
    page.getByRole('heading', {name: '无法打开来源原文', exact: true}),
  ).toBeVisible();
  await page.getByRole('button', {name: '重试读取', exact: true}).click();
  await expect(page.locator('.excerpt-panel blockquote')).toHaveText(
    SYNTHETIC_FRAGMENT_TEXT,
  );
  await close.click();
  await expect(source).toBeFocused();
  await source.click();
  await expect(page.getByRole('dialog', {name: '来源原文'})).toBeVisible();
  await page.getByRole('button', {name: '关闭来源原文'}).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByText('查看整理后的正文', {exact: true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: '关闭来源原文'})).toBeFocused();
});

test('keeps late graph reads and writes out of a newer privacy scope', async ({
  page,
}) => {
  const fixture = await installGraphReadCandidate(page);
  await page.goto('/');
  await openWorkspace(page, '知识');
  await expect(page.locator('.knowledge-node-inspector')).toContainText(
    '合成图谱中心',
  );
  const scope = page.getByRole('combobox', {name: '隐私范围', exact: true});
  const readGate = controlledGate();
  fixture.holdGraph(readGate.promise);
  await scope.selectOption('include_private');
  await expect(
    page.getByText('正在读取当前知识图谱…', {exact: true}),
  ).toBeVisible();
  await scope.selectOption('public');
  await expect(page.locator('.knowledge-node-inspector')).toContainText(
    '合成图谱中心',
  );
  const lateRead = page.waitForResponse('**/api/v1/knowledge-graph/view');
  readGate.release();
  await lateRead;
  await expect(page.locator('.knowledge-candidate-strip')).not.toContainText(
    '合成隐私目标',
  );
  await scope.selectOption('include_private');
  await expect(page.locator('.knowledge-candidate-strip')).toContainText(
    '合成隐私目标',
  );
  const writeGate = controlledGate();
  fixture.holdWrite(writeGate.promise);
  await page.locator('.knowledge-radial-edge').first().focus();
  await page.keyboard.press('Enter');
  await page
    .locator('.knowledge-edge-inspector')
    .getByRole('button', {name: '保存关系', exact: true})
    .click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await scope.selectOption('public');
  await expect(page.locator('.knowledge-node-inspector')).toContainText(
    '合成图谱中心',
  );
  const lateWrite = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith(
      '/api/v1/knowledge-graph/edges/',
    ),
  );
  writeGate.release();
  await lateWrite;
  await expect(page.locator('.knowledge-candidate-strip')).not.toContainText(
    '合成隐私目标',
  );
  const search = page.getByRole('searchbox', {
    name: '搜索中心条目',
    exact: true,
  });
  await search.fill('synthetic-empty');
  await page.getByRole('button', {name: '探索这个话题', exact: true}).click();
  await expect(
    page.getByText('当前范围没有可作为中心的条目。', {exact: true}),
  ).toBeVisible();
  await search.fill('synthetic-failure');
  await page.getByRole('button', {name: '探索这个话题', exact: true}).click();
  await expect(page.locator('.knowledge-state[role="alert"]')).toBeVisible();
  await expect(
    page
      .locator('.knowledge-state')
      .getByRole('button', {name: '重试', exact: true}),
  ).toBeEnabled();
  await search.fill('');
  await page.getByRole('button', {name: '探索这个话题', exact: true}).click();
  await expect(page.locator('.knowledge-node-inspector')).toContainText(
    '合成图谱中心',
  );
  await page.getByRole('button', {name: '关系列表', exact: true}).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.locator('.knowledge-relation-list li')).toHaveCount(12);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

function syntheticIndexStatus(
  current: number,
  embedded = current,
  semantic = true,
): InformationEntrySearchIndexStatus {
  return {
    indexVersion: 'struinfo.entry-search-index.v1',
    tokenizerVersion: 'struinfo.entry-tokenizer.v1',
    publicEntryCount: 65,
    currentProjectionCount: current,
    embeddedProjectionCount: embedded,
    staleProjectionCount: 0,
    postingCount: current * 3,
    semanticSearchAvailable: semantic,
    semanticSearchReady: semantic && embedded === 65,
    ...(semantic
      ? {embeddingProvider: 'synthetic', embeddingModel: 'synthetic-2d'}
      : {}),
  };
}

function syntheticIndexWindow(
  current: number,
  embedded: number,
  updated: number,
  remaining: number,
  outcome: 'more' | 'complete' | 'provider_failed' = 'more',
  semantic = true,
): InformationEntrySearchIndexRefreshResponse {
  return {
    status: 'ok',
    index: syntheticIndexStatus(current, embedded, semantic),
    progress: {
      outcome,
      loadedEntryCount: updated,
      updatedEntryCount: updated,
      staleEntryCount: 0,
      removedProjectionCount: 0,
      reusedEmbeddingCount: 0,
      embeddingInputCount: semantic ? updated : 0,
      remainingEntryCount: remaining,
      remainingObsoleteCount: 0,
    },
  };
}

async function installIncrementalIndexApi(
  page: Page,
  semantic = true,
  firstReadGate?: Promise<void>,
) {
  await installCurrentProductApi(page);
  const fixture = {
    index: syntheticIndexStatus(0, 0, semantic),
    reads: 0,
    completedReads: 0,
    requests: [] as string[],
    completedRefreshes: 0,
    rebuilds: 0,
    steps: [] as {
      gate?: Promise<void>;
      body: InformationEntrySearchIndexRefreshResponse;
    }[],
  };
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: [
          'information_entry_incremental_search_index',
          ...(semantic ? ['semantic_entry_search'] : []),
        ],
      },
    }),
  );
  await page.route('**/api/v1/entries/search/index**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/refresh')) {
      fixture.requests.push(route.request().postData() ?? '');
      const step = fixture.steps.shift();
      expect(step, 'An unexpected index refresh was started').toBeDefined();
      if (step === undefined) return;
      if (step.gate !== undefined) await step.gate;
      if (step.body.status === 'ok') fixture.index = step.body.index;
      await route.fulfill({
        status: step.body.status === 'ok' ? 200 : 409,
        json: step.body,
      });
      fixture.completedRefreshes += 1;
      return;
    }
    if (path.endsWith('/rebuild')) {
      fixture.rebuilds += 1;
      fixture.index = syntheticIndexStatus(65, semantic ? 65 : 0, semantic);
      await route.fulfill({json: {status: 'ok', index: fixture.index}});
      return;
    }
    fixture.reads += 1;
    const index = fixture.index;
    if (fixture.reads === 1 && firstReadGate !== undefined) await firstReadGate;
    await route.fulfill({json: {status: 'ok', index}});
    fixture.completedReads += 1;
  });
  return fixture;
}

test('refreshes the index explicitly, pauses between windows and retries only unfinished work', async ({
  page,
}, testInfo) => {
  const fixture = await installIncrementalIndexApi(page);
  const firstWindow = controlledGate();
  fixture.steps.push(
    {gate: firstWindow.promise, body: syntheticIndexWindow(32, 32, 32, 33)},
    {body: syntheticIndexWindow(64, 32, 32, 33, 'provider_failed')},
    {body: syntheticIndexWindow(64, 64, 32, 1)},
    {body: syntheticIndexWindow(65, 65, 1, 0, 'complete')},
    {
      body: {
        status: 'rejected',
        issue: {code: 'search_index_maintenance_busy'},
      },
    },
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  await openQuerySettings(page, '索引维护');
  const panel = page.getByRole('complementary', {name: '搜索索引维护'});
  await expect(panel).toContainText('已收录 0 / 65');
  expect(fixture.requests).toEqual([]);
  const start = panel.getByRole('button', {name: '刷新变化项', exact: true});
  await start.focus();
  await start.press('Enter');
  await expect.poll(() => fixture.requests.length).toBe(1);
  await panel.getByRole('button', {name: '本批后暂停', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '本批后暂停', exact: true}),
  ).toBeDisabled();
  firstWindow.release();
  await expect(panel).toContainText('已暂停。下次将继续处理剩余变化项。');
  await expect(panel).toContainText('已收录 32 / 65');
  expect(fixture.requests).toHaveLength(1);

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('index-' + width.toString() + '.png'),
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const clipped = await panel.evaluate((element) => {
      const parent = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('button, summary'))
        .filter((control) => {
          const bounds = control.getBoundingClientRect();
          return (
            bounds.width > 0 &&
            (bounds.left < Math.max(0, parent.left) - 1 ||
              bounds.right > Math.min(window.innerWidth, parent.right) + 1)
          );
        })
        .map((control) => control.textContent);
    });
    expect(clipped, 'Index controls at ' + width.toString() + 'px').toEqual([]);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await panel.getByRole('button', {name: '继续刷新', exact: true}).focus();
  await page.screenshot({
    path: testInfo.outputPath('index-large-text.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });

  await panel.getByRole('button', {name: '继续刷新', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText(
    '文字索引和已完成部分已保留',
  );
  await expect(panel).toContainText('已收录 64 / 65');
  expect(fixture.requests).toHaveLength(2);
  await panel.getByRole('button', {name: '重试刷新', exact: true}).click();
  await expect(panel).toContainText('索引已更新到当前状态。');
  await expect(panel).toContainText('待刷新 0');
  expect(fixture.requests).toHaveLength(4);
  expect(fixture.requests.map((body) => JSON.parse(body) as unknown)).toEqual(
    Array.from({length: 4}, () => ({limit: 32})),
  );
  await panel.getByRole('button', {name: '刷新变化项', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText(
    '另一项索引维护正在进行',
  );
  await panel.getByRole('button', {name: '读取状态', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '刷新变化项', exact: true}),
  ).toBeEnabled();
  const repair = panel.locator('summary');
  await repair.focus();
  await repair.press('Enter');
  await expect(panel).toContainText('可能产生调用费用');
  expect(fixture.rebuilds).toBe(0);
  await panel.getByRole('button', {name: '重建全部索引', exact: true}).click();
  await expect.poll(() => fixture.rebuilds).toBe(1);
  await expect(panel).toContainText('已收录 65 / 65');
  expect(errors).toEqual([]);
});

test('leaves index checkpoints durable without letting late requests resume an unmounted page', async ({
  page,
}) => {
  const lateRead = controlledGate();
  const lateWindow = controlledGate();
  const fixture = await installIncrementalIndexApi(
    page,
    false,
    lateRead.promise,
  );
  fixture.steps.push(
    {
      gate: lateWindow.promise,
      body: syntheticIndexWindow(64, 0, 32, 1, 'more', false),
    },
    {body: syntheticIndexWindow(65, 0, 1, 0, 'complete', false)},
  );
  await page.goto('/');
  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  const query = navigation.getByRole('button', {name: '数据库', exact: true});
  const overview = {click: () => openWorkspace(page, '总览', navigation)};
  const panel = page.getByRole('complementary', {name: '搜索索引维护'});
  await query.click();
  await openQuerySettings(page, '索引维护');
  await expect.poll(() => fixture.reads).toBe(1);
  await overview.click();
  fixture.index = syntheticIndexStatus(32, 0, false);
  await query.click();
  await openQuerySettings(page, '索引维护');
  await expect(panel).toContainText('已收录 32 / 65');
  lateRead.release();
  await expect.poll(() => fixture.completedReads).toBe(2);
  await expect(panel).toContainText('已收录 32 / 65');
  expect(fixture.requests).toHaveLength(0);
  await panel.getByRole('button', {name: '刷新变化项', exact: true}).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  await overview.click();
  lateWindow.release();
  await expect.poll(() => fixture.completedRefreshes).toBe(1);
  await query.click();
  await openQuerySettings(page, '索引维护');
  await expect(panel).toContainText('已收录 64 / 65');
  expect(fixture.requests).toHaveLength(1);
  await panel.getByRole('button', {name: '刷新变化项', exact: true}).click();
  await expect(panel).toContainText('索引已更新到当前状态。');
  await expect(panel).toContainText('待刷新 0');
  await expect(panel).toContainText('重新生成 0');
  expect(fixture.requests).toHaveLength(2);
  await panel.locator('summary').click();
  await expect(
    panel.getByRole('button', {name: '重建文字索引', exact: true}),
  ).toBeEnabled();
});

test('refreshes an accepted AI relation after a manual graph save is rejected', async ({
  page,
}) => {
  const fixture = await installGraphReadCandidate(page);
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: ['ai_associations'],
      },
    }),
  );
  const proposal = {
    proposalId: '99999999-9999-4999-8999-999999999999',
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ordinal: 0,
    stage: 'associations',
    kind: 'association',
    status: 'pending_review',
    summary: '合成 AI 关系建议',
    fragmentIds: [FRAGMENT_ID],
    createdAt: '2026-09-05T00:00:00.000Z',
    associationPayload: {
      expectedEntryLowRevision: 1,
      expectedEntryHighRevision: 1,
      expectedOverrideRevision: 0,
      providerModel: 'synthetic-model',
      promptVersion: 'synthetic-v1',
      relationLabel: '合成接受关系',
      direction: 'symmetric',
    },
  };
  let accepted = false;
  await page.route('**/api/v1/knowledge-graph/edges/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/proposals')) {
      await route.fulfill({
        json: {
          status: 'ok',
          proposals: [
            {...proposal, status: accepted ? 'accepted' : 'pending_review'},
          ],
        },
      });
    } else if (path.endsWith('/accept')) {
      accepted = true;
      fixture.acceptSyntheticProposal();
      await route.fulfill({
        json: {status: 'accepted', proposal: {...proposal, status: 'accepted'}},
      });
    } else {
      await route.fulfill({
        status: 409,
        json: {status: 'rejected', issue: {code: 'graph_revision_conflict'}},
      });
    }
  });
  await page.goto('/');
  await openWorkspace(page, '知识');
  const edge = page.locator('.knowledge-radial-edge').first();
  await edge.focus();
  await edge.press('Enter');
  const inspector = page.locator('.knowledge-edge-inspector');
  await expect(
    inspector.getByRole('button', {name: '接受并写入图谱', exact: true}),
  ).toBeEnabled();
  await inspector.getByRole('button', {name: '保存关系', exact: true}).click();
  await expect(page.getByText('关系没有保存', {exact: true})).toBeVisible();
  await inspector
    .getByRole('button', {name: '接受并写入图谱', exact: true})
    .click();
  await expect(edge).toHaveAttribute('aria-label', /合成接受关系/);
  await expect(edge).toHaveAttribute('data-origin', 'ai_assisted');
  expect(accepted).toBe(true);
});

async function installSavedQueryApi(
  page: Page,
  initial: readonly Readonly<EntrySavedQuery>[] = [],
) {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/entries/search/index', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        index: {...syntheticIndexStatus(1, 0, false), publicEntryCount: 1},
      },
    }),
  );
  let savedQueries: EntrySavedQueries = {
    version: 1,
    revision: 0,
    views: [...initial],
  };
  const writes: Record<string, unknown>[] = [];
  const reads: Record<string, unknown>[] = [];
  await page.route('**/api/v1/entries/saved-queries', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({json: {status: 'ok', savedQueries}});
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(body);
    if (body.expectedRevision !== savedQueries.revision) {
      await route.fulfill({
        status: 409,
        json: {
          status: 'rejected',
          issue: {code: 'saved_queries_revision_conflict'},
        },
      });
      return;
    }
    const prior = savedQueries.views.find(
      (view) => view.viewId === body.viewId,
    );
    const views = savedQueries.views.filter(
      (view) => view.viewId !== body.viewId,
    );
    if (body.operation === 'save')
      views.push({
        viewId: body.viewId as string,
        name: body.name as string,
        query: body.query as EntrySavedQuery['query'],
        ...(body.selectedEntryId === undefined
          ? {}
          : {selectedEntryId: body.selectedEntryId as string}),
      });
    if (body.operation === 'rename' && prior !== undefined)
      views.push({...prior, name: body.name as string});
    savedQueries = {
      ...savedQueries,
      revision: savedQueries.revision + 1,
      views,
    };
    await route.fulfill({json: {status: 'applied', savedQueries}});
  });
  await page.route('**/api/v1/entries/query-context', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    reads.push(body);
    await route.fulfill({
      json: {
        status: 'ok',
        entry: {
          ...SYNTHETIC_ENTRY,
          entryId: body.entryId,
          value: {
            ...SYNTHETIC_ENTRY.value,
            titlePath: '合成上次条目',
            body: '合成当前版本正文',
            isPrivate: body.includePrivate === true,
          },
        },
      },
    });
  });
  return {writes, reads, state: () => savedQueries};
}

async function openSavedQueryPanel(page: Page) {
  await closeFloatingTools(page);
  const open = page.getByRole('button', {name: '展开内容范围', exact: true});
  if (await open.isVisible()) await open.click();
  const d = page
    .locator('.side-left .filter-group')
    .filter({has: page.locator('summary').filter({hasText: '保存的查询'})})
    .first();
  if ((await d.getAttribute('open')) === null)
    await d.locator(':scope > summary').click();
  return page.locator('.saved-query-panel');
}

test('saves and reopens named queries with current source and graph return', async ({
  page,
}) => {
  const fixture = await installSavedQueryApi(page);
  const sourceReads: string[] = [];
  await page.route('**/api/v1/evidence/snapshots/*', async (route) => {
    sourceReads.push(route.request().url());
    await route.fulfill({json: {status: 'ok', snapshot: SYNTHETIC_SNAPSHOT}});
  });
  const graphReads: Record<string, unknown>[] = [];
  await page.route('**/api/v1/knowledge-graph/view', async (route) => {
    graphReads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        status: 'ok',
        querySha256: '0'.repeat(64),
        candidateTotalCount: 1,
        candidates: [],
        graph: {
          center: SYNTHETIC_ENTRY,
          nodes: [SYNTHETIC_ENTRY],
          edges: [],
          hiddenEdges: [],
        },
      },
    });
  });
  await page.goto('/');

  await openWorkspace(page, '查询');
  await openQuerySettings(page);
  await page
    .getByRole('searchbox', {name: '关键词或问题'})
    .fill('合成检索条件');
  await submitQuery(page);
  await expect(
    page.locator('.entry-result-list button[data-active="true"]'),
  ).toBeVisible();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toBeVisible();
  const panel = await openSavedQueryPanel(page);
  await panel.getByRole('textbox', {name: '查询名称'}).fill('合成常用查询');
  await panel.getByRole('button', {name: '另存当前查询'}).click();
  await expect(panel.getByText('查询条件与当前位置已保存。')).toBeVisible();
  expect(fixture.writes[0]).toMatchObject({
    query: {text: '合成检索条件'},
    selectedEntryId: ENTRY_ID,
  });
  expect(fixture.writes[0]?.query).not.toHaveProperty('after');
  await page.reload();
  await openWorkspace(page, '查询');
  await openQuerySettings(page);
  await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption({label: '合成常用查询'});
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await expect(page.getByRole('searchbox', {name: '关键词或问题'})).toHaveValue(
    '合成检索条件',
  );
  await openQuerySettings(page, '阅读设置');
  await page.getByRole('button', {name: '出处与文档', exact: true}).click();
  await expect(
    page.getByText(SYNTHETIC_FRAGMENT_TEXT, {exact: true}).first(),
  ).toBeVisible();
  expect(sourceReads.at(-1)).toContain(SNAPSHOT_ID);
  expect(sourceReads.at(-1)).not.toContain('includePrivate=true');
  await page.getByRole('button', {name: '关闭来源原文'}).click();
  await expect(page.getByRole('searchbox', {name: '关键词或问题'})).toHaveValue(
    '合成检索条件',
  );
  await openQuerySettings(page, '阅读与导出');
  await page.getByRole('button', {name: '联系星图', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', {name: '数据库', exact: true}),
  ).toBeVisible();
  expect(graphReads.at(-1)).toMatchObject({
    centerEntryId: ENTRY_ID,
    includePrivate: false,
  });
  await openQuerySettings(page, '阅读与导出');
  await page.getByRole('button', {name: '阅读正文', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', {name: '关键词或问题'})).toHaveValue(
    '合成检索条件',
  );
  await expect(
    page.locator('.entry-result-list button[data-active="true"]'),
  ).toContainText('合成公开 Entry');
  await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption({label: '合成常用查询'});
  await panel.getByRole('textbox', {name: '查询名称'}).fill('合成新名称');
  await panel.getByRole('button', {name: '重命名', exact: true}).click();
  await expect(panel.getByText('查询已重命名。')).toBeVisible();
  await page
    .getByRole('searchbox', {name: '关键词或问题'})
    .fill('合成更新条件');
  await expect(page.getByText('条件已更改', {exact: true})).toHaveCount(0);
  await panel.getByRole('button', {name: '更新条件与位置'}).click();
  await expect(panel.getByText('查询条件与当前位置已保存。')).toBeVisible();
  expect(fixture.state().views[0]?.query.text).toBe('合成更新条件');
  await panel.getByRole('button', {name: '删除查询'}).click();
  await expect(panel.getByText('查询已删除，条目和来源保留。')).toBeVisible();
  expect(fixture.state().views).toEqual([]);
});

test('restores an off-page selection and requires fresh private scope after navigation', async ({
  page,
}) => {
  const publicView = {
    viewId: WORKSPACE_ID,
    name: '合成公开位置',
    query: {includePrivate: false},
    selectedEntryId: EXPLORATION_ENTRY_ID,
  };
  const privateView = {
    viewId: RESOURCE_ID,
    name: '合成隐私位置',
    query: {includePrivate: true, onlyPrivate: true},
    selectedEntryId: EXPLORATION_ENTRY_ID,
  };
  const fixture = await installSavedQueryApi(page, [publicView, privateView]);
  const searches: Record<string, unknown>[] = [];
  await page.route('**/api/v1/entries/search', async (route) => {
    searches.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        items: [{entry: SYNTHETIC_ENTRY, matchReasons: [], filterReasons: []}],
        privateDocuments: {totalCount: 0, items: []},
      },
    });
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '查询');
  await openQuerySettings(page);
  const panel = await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(WORKSPACE_ID);
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '上次查看的位置'}),
  ).toContainText('合成当前版本正文');
  expect(fixture.reads.at(-1)).toEqual({
    entryId: EXPLORATION_ENTRY_ID,
    includePrivate: false,
    onlyPrivate: false,
  });
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(RESOURCE_ID);
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '重新选择隐私范围'}),
  ).toBeVisible();
  expect(searches.every((query) => query.includePrivate === false)).toBe(true);
  expect(fixture.reads.every((query) => query.includePrivate === false)).toBe(
    true,
  );
  await page.getByRole('button', {name: '按保存范围打开'}).click();
  await expect.poll(() => searches.at(-1)?.onlyPrivate).toBe(true);
  await expect.poll(() => fixture.reads.at(-1)?.includePrivate).toBe(true);
  await openWorkspace(page, '总览', nav);
  const previousPrivateCalls = searches.filter(
    (query) => query.includePrivate === true,
  ).length;
  await openWorkspace(page, '查询');
  await expect(
    page.getByRole('region', {name: '重新选择隐私范围'}),
  ).toBeVisible();
  expect(
    searches.filter((query) => query.includePrivate === true),
  ).toHaveLength(previousPrivateCalls);
  await page.getByRole('button', {name: '仅公开资料'}).click();
  await expect.poll(() => searches.at(-1)?.includePrivate).toBe(false);
  await expect(
    page.getByRole('region', {name: '重新选择隐私范围'}),
  ).toHaveCount(0);
});

test('keeps saved-query controls responsive and offers recovery for unavailable context', async ({
  page,
}) => {
  const fixture = await installSavedQueryApi(page, [
    {
      viewId: WORKSPACE_ID,
      name: '合成查询名称用于较窄显示与键盘操作检查',
      query: {
        includePrivate: false,
        text: 'Synthetic',
        retrievalMode: 'semantic',
        association: {entryId: ENTRY_ID, maximumDepth: 2, minimumScore: 0},
      },
      selectedEntryId: EXPLORATION_ENTRY_ID,
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/entries/search', async (route) => {
    const query = route.request().postDataJSON() as Record<string, unknown>;
    if (query.retrievalMode === 'semantic' || query.association !== undefined) {
      await route.fulfill({
        status: 422,
        json: {
          status: 'rejected',
          issue: {
            code:
              query.retrievalMode === 'semantic'
                ? 'semantic_search_not_configured'
                : 'association_anchor_not_found',
          },
        },
      });
    } else {
      await route.fulfill({
        json: {
          status: 'ok',
          totalCount: 0,
          items: [],
          privateDocuments: {totalCount: 0, items: []},
        },
      });
    }
  });
  await page.route('**/api/v1/entries/query-context', (route) =>
    route.fulfill({
      status: 404,
      json: {status: 'not_found', issue: {code: 'entry_not_found'}},
    }),
  );
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  await openQuerySettings(page);
  const panel = await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(WORKSPACE_ID);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await openSavedQueryPanel(page);
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    for (const control of await panel.locator('input, select, button').all()) {
      const box = await control.boundingBox();
      if (box === null) throw new Error('Saved query control is not laid out.');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    if (width === 1440) {
      const search = await page.locator('.search-module').boundingBox();
      const results = await page.locator('.query-studio-results').boundingBox();
      if (search === null || results === null)
        throw new Error('Query layout is missing.');
      expect(results.y).toBeGreaterThan(search.y + search.height);
    }
    await page.screenshot({
      path: 'test-results/playwright/saved-query-' + width.toString() + '.png',
      fullPage: true,
    });
  }
  await page.emulateMedia({reducedMotion: 'reduce'});
  const open = panel.getByRole('button', {name: '打开查询', exact: true});
  await open.focus();
  await open.press('Enter');
  await page.getByRole('button', {name: '改用文字查询'}).click();
  await page.getByRole('button', {name: '清除关联中心后查询'}).click();
  await expect(
    page.getByRole('heading', {name: '当前范围还没有条目'}),
  ).toBeVisible();
  // Reopen without unavailable filters so the missing selected position is read independently.
  await page.route('**/api/v1/entries/saved-queries', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        savedQueries: {
          version: 1,
          revision: 1,
          views: [
            {...fixture.state().views[0], query: {includePrivate: false}},
          ],
        },
      },
    }),
  );
  await openSavedQueryPanel(page);
  await panel.getByRole('button', {name: '重新读取', exact: true}).click();
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '上次查看的位置'}),
  ).toContainText('上次查看的条目已不存在');
  expect(errors).toEqual([]);
});

test('discards a late private reading position and recovers from saved-view conflicts', async ({
  page,
}) => {
  const view = {
    viewId: WORKSPACE_ID,
    name: '合成隐私回归',
    query: {includePrivate: true},
    selectedEntryId: EXPLORATION_ENTRY_ID,
  };
  await installSavedQueryApi(page, [view]);
  const gate = controlledGate();
  let contextStarted = false;
  await page.route('**/api/v1/entries/query-context', async (route) => {
    contextStarted = true;
    await gate.promise;
    await route.fulfill({
      json: {
        status: 'ok',
        entry: {
          ...SYNTHETIC_ENTRY,
          entryId: EXPLORATION_ENTRY_ID,
          value: {
            ...SYNTHETIC_ENTRY.value,
            body: '合成迟到隐私正文',
            isPrivate: true,
          },
        },
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  await openQuerySettings(page);
  const panel = await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(WORKSPACE_ID);
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await page.getByRole('button', {name: '按保存范围打开'}).click();
  await expect.poll(() => contextStarted).toBe(true);
  await openQuerySettings(page);
  await page.getByRole('combobox', {name: '隐私结果'}).selectOption('public');
  const response = page.waitForResponse('**/api/v1/entries/query-context');
  gate.release();
  await response;
  await expect(page.getByText('合成迟到隐私正文', {exact: true})).toHaveCount(
    0,
  );
  const clearedSearch = controlledGate();
  await page.route('**/api/v1/entries/search', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    const privateScope = request.includePrivate === true;
    if (!privateScope) await clearedSearch.promise;
    await route.fulfill({
      json: {
        status: 'ok',
        querySha256: '0'.repeat(64),
        totalCount: privateScope ? 1 : 0,
        items: privateScope
          ? [
              {
                entry: {
                  ...SYNTHETIC_ENTRY,
                  value: {
                    ...SYNTHETIC_ENTRY.value,
                    body: '合成当前隐私条目正文',
                    isPrivate: true,
                  },
                },
                matchReasons: [],
                filterReasons: [],
              },
            ]
          : [],
        privateDocuments: {totalCount: 0, items: []},
      },
    });
  });
  await page.getByRole('combobox', {name: '隐私结果'}).selectOption('all');
  await expect(
    page.getByText('合成当前隐私条目正文', {exact: true}),
  ).toBeVisible();
  await page.getByRole('button', {name: '清除筛选', exact: true}).click();
  expect(
    await page.getByText('合成当前隐私条目正文', {exact: true}).count(),
  ).toBe(0);
  clearedSearch.release();
  await page.route('**/api/v1/entries/saved-queries', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 409,
        json: {
          status: 'rejected',
          issue: {code: 'saved_queries_revision_conflict'},
        },
      });
    } else {
      await route.fulfill({
        json: {
          status: 'ok',
          savedQueries: {
            version: 1,
            revision: 2,
            views: [{...view, name: '合成另一处更改'}],
          },
        },
      });
    }
  });
  await openSavedQueryPanel(page);
  await panel.getByRole('textbox', {name: '查询名称'}).fill('合成重命名草稿');
  await panel.getByRole('button', {name: '重命名', exact: true}).click();
  await expect(
    panel.getByText('保存的查询已在另一处更改，请重新读取后再操作。'),
  ).toBeVisible();
  await panel.getByRole('button', {name: '重新读取', exact: true}).click();
  await expect(panel.getByRole('combobox', {name: '已保存查询'})).toContainText(
    '合成另一处更改',
  );
});

async function installSourceReviewFixture(page: Page, count = 22) {
  await installGraphReadCandidate(page);
  const rows: InformationEntrySourceReviewItem[] = Array.from(
    {length: count},
    (_, i) => {
      const right = {
        ...SYNTHETIC_ENTRY,
        entryId:
          '44444444-4444-4444-8444-' + (i + 100).toString().padStart(12, '0'),
        snapshotId: '33333333-3333-4333-8333-333333333334',
        value: {
          ...SYNTHETIC_ENTRY.value,
          titlePath: '合成右端条目 ' + (i + 1).toString(),
          body: '合成右端来源正文。',
        },
      };
      // Use canonical pair order for the displayed revision binding.
      const left = {
        ...SYNTHETIC_ENTRY,
        entryId: '44444444-4444-4444-8444-000000000001',
      };
      return {
        entryLow: left,
        entryHigh: right,
        edge: {
          entryLowId: left.entryId,
          entryHighId: right.entryId,
          label: '合成复核关系 ' + (i + 1).toString(),
          direction: 'high_to_low',
          origin: 'ai_assisted',
          semanticKind: 'contradicts',
          verificationStatus: 'needs_review',
          note: '合成旧说明',
          isBlocked: false,
          overrideRevision: 2,
          effectiveScore: 5000,
        },
        review: {
          status: 'needs_review',
          storedStatus: 'source_checked',
          reason: 'unbound',
        },
      };
    },
  );
  const first = rows[0];
  if (first === undefined) throw new Error('Expected review fixture.');
  const privateRow = {
    ...first,
    entryLow: {
      ...SYNTHETIC_ENTRY,
      entryId: '44444444-4444-4444-8444-000000000002',
      value: {
        ...SYNTHETIC_ENTRY.value,
        isPrivate: true,
        titlePath: '合成隐私左端',
      },
    },
    entryHigh: {
      ...SYNTHETIC_ENTRY,
      entryId: '44444444-4444-4444-8444-000000000999',
      value: {
        ...SYNTHETIC_ENTRY.value,
        isPrivate: true,
        titlePath: '合成隐私右端',
      },
    },
  };
  const privateItem: InformationEntrySourceReviewItem = {
    ...privateRow,
    edge: {
      ...privateRow.edge,
      entryLowId: privateRow.entryLow.entryId,
      entryHighId: privateRow.entryHigh.entryId,
      label: '合成隐私复核关系',
    },
  };
  rows.push(privateItem);
  const reads: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const evidence: string[] = [];
  let readGate: Promise<void> | undefined,
    writeGate: Promise<void> | undefined,
    evidenceGate: Promise<void> | undefined;
  let failWrite = false;
  await page.route(
    '**/api/v1/knowledge-graph/source-reviews',
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      reads.push(body);
      const wait = readGate;
      readGate = undefined;
      const visible = rows
        .filter((row) =>
          body.privacyScope === 'private_only'
            ? row.entryLow.value.isPrivate && row.entryHigh.value.isPrivate
            : body.privacyScope === 'include_private' ||
              (!row.entryLow.value.isPrivate && !row.entryHigh.value.isPrivate),
        )
        .filter(
          (row) =>
            body.filter === 'all' ||
            (body.filter === 'pending'
              ? row.review.status !== 'source_checked'
              : row.review.status === body.filter),
        );
      const after = body.after as {entryHighId: string} | undefined;
      const start =
        after === undefined
          ? 0
          : visible.findIndex(
              (row) => row.edge.entryHighId === after.entryHighId,
            ) + 1;
      const items = visible.slice(start, start + 20);
      const last = items.at(-1);
      const response = {
        status: 'ok',
        totalCount: visible.length,
        items,
        ...(last !== undefined && start + 20 < visible.length
          ? {
              nextCursor: {
                version: 1,
                filter: body.filter,
                privacyScope: body.privacyScope,
                entryLowId: last.edge.entryLowId,
                entryHighId: last.edge.entryHighId,
              },
            }
          : {}),
      };
      if (wait !== undefined) await wait;
      await route.fulfill({json: response});
    },
  );
  await page.route(
    '**/api/v1/knowledge-graph/edges/*/*/source-review',
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      const row = rows.find((item) =>
        route
          .request()
          .url()
          .includes(item.edge.entryLowId + '/' + item.edge.entryHighId),
      );
      const wait = writeGate;
      writeGate = undefined;
      if (wait !== undefined) await wait;
      if (failWrite) {
        failWrite = false;
        if (row !== undefined)
          rows[rows.indexOf(row)] = {
            ...row,
            entryHigh: {...row.entryHigh, revision: row.entryHigh.revision + 1},
            review: {
              ...row.review,
              reason: 'entry_changed',
              reviewedRevisions: {entryLowRevision: 1, entryHighRevision: 1},
            },
          };
        await route.fulfill({
          status: 409,
          json: {status: 'rejected', issue: {code: 'stale_source_review'}},
        });
        return;
      }
      if (row !== undefined) {
        const status =
          body.verificationStatus as InformationEntrySourceReview['status'];
        const revisions = body.expectedEntryRevisions as {
          entryLowRevision: number;
          entryHighRevision: number;
        };
        const index = rows.indexOf(row);
        rows[index] = {
          ...row,
          edge: {
            ...row.edge,
            overrideRevision: row.edge.overrideRevision + 1,
            note: String(body.note),
            verificationStatus: status,
          },
          review: {
            status,
            storedStatus: status,
            reason:
              status === 'source_checked'
                ? 'current'
                : status === 'needs_review'
                  ? 'owner_requested'
                  : 'not_reviewed',
            reviewedRevisions: revisions,
          },
        };
      }
      await route.fulfill({json: {status: 'applied'}});
    },
  );
  await page.route('**/api/v1/evidence/snapshots/*', async (route) => {
    evidence.push(route.request().url());
    const wait = evidenceGate;
    evidenceGate = undefined;
    if (wait !== undefined) await wait;
    const right = route.request().url().includes('333333333334');
    const text = right ? '合成右端原文' : SYNTHETIC_FRAGMENT_TEXT;
    await route.fulfill({
      json: {
        status: 'ok',
        snapshot: {
          ...SYNTHETIC_SNAPSHOT,
          structures: [
            {
              ...SYNTHETIC_SNAPSHOT.structures[0],
              normalizedText: text,
              fragments: [
                {
                  ...SYNTHETIC_SNAPSHOT.structures[0]?.fragments[0],
                  selectedText: text,
                },
              ],
            },
          ],
        },
      },
    });
  });
  return {
    reads,
    writes,
    evidence,
    failNextWrite() {
      failWrite = true;
    },
    holdRead(gate: Promise<void>) {
      readGate = gate;
    },
    holdWrite(gate: Promise<void>) {
      writeGate = gate;
    },
    holdEvidence(gate: Promise<void>) {
      evidenceGate = gate;
    },
  };
}
async function openSourceReview(page: Page) {
  await page.goto('/');
  await openWorkspace(page, '知识');
  const action = page.getByRole('button', {name: '来源复核', exact: true});
  await action.focus();
  await action.press('Enter');
  await expect(
    page.getByRole('heading', {name: '来源复核', exact: true}),
  ).toBeVisible();
}
test('reviews both exact sources, binds displayed revisions, handles conflicts and continues through pages', async ({
  page,
}) => {
  const fixture = await installSourceReviewFixture(page);
  await openSourceReview(page);
  const editor = page.getByRole('region', {name: '关系来源复核', exact: true});
  await expect(editor).toContainText('已有来源核验记录尚未绑定条目版本');
  await expect(editor).toContainText('右端指向左端');
  for (const [region, text] of [
    ['左端条目', SYNTHETIC_FRAGMENT_TEXT],
    ['右端条目', '合成右端原文'],
  ] as const) {
    const source = page
      .getByRole('region', {name: region, exact: true})
      .getByRole('button', {name: '查看原文'});
    await source.click();
    await expect(page.locator('.excerpt-panel blockquote')).toHaveText(text);
    await page.getByRole('button', {name: '关闭来源原文'}).click();
    await expect(source).toBeFocused();
  }
  expect(fixture.evidence.some((url) => url.includes('333333333334'))).toBe(
    true,
  );
  await editor
    .getByRole('combobox', {name: '本次核验状态', exact: true})
    .selectOption('source_checked');
  await editor
    .getByRole('textbox', {name: '维护说明', exact: true})
    .fill('合成核验说明');
  await editor.getByRole('button', {name: '保存并继续'}).click();
  await expect(editor.getByRole('heading', {level: 2})).toHaveText(
    '合成复核关系 2',
  );
  expect(fixture.writes[0]).toEqual({
    expectedRevision: 2,
    expectedEntryRevisions: {entryLowRevision: 1, entryHighRevision: 1},
    includePrivate: false,
    verificationStatus: 'source_checked',
    note: '合成核验说明',
  });
  fixture.failNextWrite();
  await editor.getByRole('button', {name: '保存并继续'}).click();
  await expect(
    page.getByText('关系或条目可能已变化，复核没有保存。请重新读取后核对。'),
  ).toBeVisible();
  await page.getByRole('button', {name: '重新读取', exact: true}).click();
  await expect(editor).toContainText('条目版本已变化');
  await expect(editor).toContainText('当前条目版本：左 1 / 右 2');
  await page
    .getByRole('combobox', {name: '核验状态', exact: true})
    .selectOption('source_checked');
  await expect(
    editor.getByRole('textbox', {name: '维护说明', exact: true}),
  ).toHaveValue('合成核验说明');
  await page
    .getByRole('combobox', {name: '核验状态', exact: true})
    .selectOption('all');
  await expect(
    page.getByRole('navigation', {name: '待复核关系'}).getByRole('button'),
  ).toHaveCount(20);
  const last = page
    .getByRole('navigation', {name: '待复核关系'})
    .getByRole('button')
    .last();
  await last.click();
  await editor.getByRole('button', {name: '保存并继续'}).click();
  await expect(editor.getByRole('heading', {level: 2})).toHaveText(
    '合成复核关系 21',
  );
  await expect(
    page.getByText('22 条关系 · 第 2 批', {exact: true}),
  ).toBeVisible();
  await page.getByRole('button', {name: '上一批'}).click();
  await expect(
    page.getByRole('navigation', {name: '待复核关系'}).getByRole('button'),
  ).toHaveCount(20);
  await page.getByRole('button', {name: '返回图谱'}).click();
  await expect(
    page.getByRole('heading', {name: '数据库', exact: true}),
  ).toBeVisible();
});

test('clears private source reviews and rejects late list, evidence and save responses after scope changes', async ({
  page,
}) => {
  const fixture = await installSourceReviewFixture(page, 1);
  await openSourceReview(page);
  const scope = page.getByRole('combobox', {name: '复核隐私范围', exact: true});
  const editor = page.getByRole('region', {name: '关系来源复核', exact: true});
  const pendingList = controlledGate();
  fixture.holdRead(pendingList.promise);
  await scope.selectOption('private_only');
  await expect
    .poll(() => fixture.reads.at(-1)?.privacyScope)
    .toBe('private_only');
  await scope.selectOption('public');
  pendingList.release();
  await expect(editor).toContainText('合成公开 Entry');
  await expect(page.getByText('合成隐私左端', {exact: true})).toHaveCount(0);
  await scope.selectOption('private_only');
  await expect(editor).toContainText('合成隐私左端');
  const pendingEvidence = controlledGate();
  fixture.holdEvidence(pendingEvidence.promise);
  await page
    .getByRole('region', {name: '左端条目', exact: true})
    .getByRole('button', {name: '查看原文'})
    .click();
  await expect
    .poll(() => fixture.evidence.at(-1)?.includes('includePrivate=true'))
    .toBe(true);
  await scope.selectOption('public');
  pendingEvidence.release();
  await expect(page.locator('.excerpt-panel')).toHaveCount(0);
  await scope.selectOption('private_only');
  await expect(editor).toContainText('合成隐私左端');
  const pendingWrite = controlledGate();
  fixture.holdWrite(pendingWrite.promise);
  await editor
    .getByRole('combobox', {name: '本次核验状态', exact: true})
    .selectOption('source_checked');
  await editor.getByRole('button', {name: '保存并继续'}).click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await scope.selectOption('public');
  pendingWrite.release();
  await expect(editor).toContainText('合成公开 Entry');
  await expect(page.getByText('复核已保存，可继续下一项。')).toHaveCount(0);
  await expect(page.getByText('合成隐私左端', {exact: true})).toHaveCount(0);
  expect(fixture.writes[0]?.includePrivate).toBe(true);
  await scope.selectOption('private_only');
  await expect(
    page.getByRole('heading', {name: '当前范围没有符合条件的关系'}),
  ).toBeVisible();
});
test('keeps the source review workbench usable at desktop and narrow widths', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installSourceReviewFixture(page, 2);
  await openSourceReview(page);
  const sourceTitles = await page
    .locator('.source-review-evidence h4')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(sourceTitles).toHaveLength(2);
  expect(new Set(sourceTitles).size).toBe(2);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await expect(
      page.getByRole('region', {name: '关系来源复核', exact: true}),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const save = page.getByRole('button', {name: '保存并继续'});
    await save.focus();
    await expect(save).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath('source-review-' + width.toString() + '.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({reducedMotion: 'reduce', forcedColors: 'active'});
  await page
    .getByRole('combobox', {name: '本次核验状态', exact: true})
    .selectOption('needs_review');
  await page
    .getByRole('textbox', {name: '维护说明', exact: true})
    .fill('x'.repeat(501));
  await expect(page.getByRole('button', {name: '保存并继续'})).toBeDisabled();
  await expect(
    page.getByText('501 / 500 字符，请缩短说明后保存。'),
  ).toBeVisible();
  await page
    .getByRole('textbox', {name: '维护说明', exact: true})
    .fill('合成键盘维护说明');
  await page.getByRole('button', {name: '保存并继续'}).focus();
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('region', {name: '关系来源复核', exact: true})
      .getByRole('heading', {level: 2}),
  ).toHaveText('合成复核关系 2');
  expect(errors).toEqual([]);
});

async function installMarkdownExportFixture(page: Page) {
  await installSavedQueryApi(page);
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  let entries: CurrentInformationEntry[] = [0, 1, 2].map((ordinal) => ({
    ...SYNTHETIC_ENTRY,
    entryId:
      '44444444-4444-4444-8444-' + (ordinal + 101).toString().padStart(12, '0'),
    value: {
      ...SYNTHETIC_ENTRY.value,
      titlePath:
        ordinal === 2
          ? '合成隐私清单资料'
          : '合成导出条目 ' + (ordinal + 1).toString(),
      isPrivate: ordinal === 2,
      bodySha256: digest(SYNTHETIC_ENTRY.value.body),
      fragmentRanges: [{startCodePoint: 1, endCodePoint: 2}],
    },
  }));
  const snapshot = {
    ...SYNTHETIC_SNAPSHOT,
    rawSha256: digest(SYNTHETIC_FRAGMENT_TEXT),
    structures: SYNTHETIC_SNAPSHOT.structures.map((structure) => ({
      ...structure,
      textBlob: {
        ...structure.textBlob,
        digest: digest(SYNTHETIC_FRAGMENT_TEXT),
      },
      fragments: structure.fragments.map((fragment) => ({
        ...fragment,
        selectedTextSha256: digest(SYNTHETIC_FRAGMENT_TEXT),
      })),
    })),
  };
  const writes: string[] = [];
  const requests: Record<string, unknown>[] = [];
  let hold: Promise<void> | undefined;
  let failure: string | undefined;
  const repository: EntryMarkdownExportRepositoryPort = {
    withSelection: (_workspace, _request, work) =>
      work({
        entries,
        snapshots: [snapshot],
        associations: {projections: [], overrides: []},
      }),
  };
  const service = new EntryMarkdownExportService({
    workspaceId: WORKSPACE_ID,
    repository,
    blobStore: {
      read: () =>
        Promise.resolve(new TextEncoder().encode(SYNTHETIC_FRAGMENT_TEXT)),
      put: () => Promise.reject(new Error('No Blob writes')),
    },
    files: {
      write: (_workspace, bytes) => {
        writes.push(new TextDecoder().decode(bytes));
        return Promise.resolve({
          fileName: 'synthetic.entries.md',
          byteLength: bytes.byteLength,
        });
      },
    },
  });
  await page.route('**/api/v1/entries/search', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const privateScope = body.includePrivate === true;
    const index = privateScope ? 2 : body.after === undefined ? 0 : 1;
    const current = entries[index];
    await route.fulfill({
      json: {
        status: 'ok',
        totalCount: privateScope ? 1 : 2,
        items: [{entry: current, matchReasons: [], filterReasons: []}],
        ...(!privateScope && index === 0
          ? {
              nextCursor: {
                version: 2,
                querySha256: 'a'.repeat(64),
                entryId: current?.entryId,
                capturedAt: SYNTHETIC_ENTRY.capturedAt,
                documentOrder: 0,
              },
            }
          : {}),
        privateDocuments: {totalCount: 0, items: []},
      },
    });
  });
  await page.route('**/api/v1/entries/markdown-export**', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const pending = hold;
    hold = undefined;
    if (pending !== undefined) await pending;
    if (failure !== undefined) {
      const code = failure;
      failure = undefined;
      await route.fulfill({
        status: 503,
        json: {status: 'rejected', issue: {code}},
      });
      return;
    }
    const generating = !route.request().url().endsWith('/preview');
    const result = await (generating
      ? service.generate(body)
      : service.preview(body));
    await route.fulfill({
      status: result.status === 'rejected' ? 409 : generating ? 201 : 200,
      json: result,
    });
  });
  return {
    writes,
    requests,
    hold: (promise: Promise<void>) => {
      hold = promise;
    },
    fail: (code: string) => {
      failure = code;
    },
    reviseFirst: () => {
      entries = entries.map((entry, index) =>
        index === 0 ? {...entry, revision: entry.revision + 1} : entry,
      );
    },
  };
}
async function openMarkdownExportPanel(page: Page) {
  await openQuerySettings(page, '资料清单与导出');
  const panel = page.locator('.entry-markdown-export');
  if ((await panel.getAttribute('open')) === null)
    await panel.locator('summary').click();
  return panel;
}
async function openQueryForExport(page: Page) {
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 1',
  );
  return openMarkdownExportPanel(page);
}

test('exports a cited Markdown list from an explicit cross-page selection and clears changed query scope', async ({
  page,
}) => {
  const fixture = await installMarkdownExportFixture(page);
  const panel = await openQueryForExport(page);
  await expect(
    panel.getByRole('button', {name: '生成 Markdown 文件', exact: true}),
  ).toBeDisabled();
  await panel.getByRole('button', {name: '加入资料清单'}).focus();
  await page.keyboard.press('Enter');
  expect(fixture.requests).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
  await openMarkdownExportPanel(page);
  await panel.getByRole('button', {name: '加入资料清单'}).click();
  await expect(
    panel.locator('.entry-markdown-export__selection li'),
  ).toHaveCount(2);
  await panel.getByRole('textbox', {name: '清单标题'}).fill('合成两页资料');
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  const preview = panel.getByRole('region', {name: '资料清单预览'});
  await expect(preview).toContainText('Fragment 内 Unicode 范围：[1, 2)');
  await expect(preview).toContainText('😀');
  await expect(preview).toContainText('未包含会话内 AI 综合');
  expect(fixture.writes).toHaveLength(0);
  await panel
    .getByRole('button', {name: '生成 Markdown 文件', exact: true})
    .click();
  await expect(panel.getByRole('link', {name: '下载 Markdown'})).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('link', {name: '下载 Markdown'}).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('synthetic.entries.md');
  const path = await download.path();
  expect(await readFile(path, 'utf8')).toBe(fixture.writes[0]);
  expect(fixture.writes[0]).toContain('# 合成两页资料');
  const submitted = fixture.requests.at(-1);
  expect(submitted?.entries).toHaveLength(2);
  expect(submitted).not.toHaveProperty('markdown');
  expect(submitted).not.toHaveProperty('path');
  await page
    .getByRole('searchbox', {name: '关键词或问题'})
    .fill('合成其他查询');
  await expect(panel.locator('summary')).toHaveText('资料清单与导出 · 0 条');
  expect(fixture.writes).toHaveLength(1);
  await expect(page.getByRole('link', {name: '下载 Markdown'})).toHaveCount(0);
});

test('rejects stale Markdown selection and discards private preview and generation responses after scope changes', async ({
  page,
}) => {
  const fixture = await installMarkdownExportFixture(page);
  const panel = await openQueryForExport(page);
  await panel.getByRole('button', {name: '加入资料清单'}).click();
  fixture.reviseFirst();
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect(panel.getByRole('alert')).toContainText('所选条目已更新');
  await expect(
    panel.getByRole('button', {name: '生成 Markdown 文件', exact: true}),
  ).toBeDisabled();
  expect(fixture.writes).toHaveLength(0);
  const scope = page.getByRole('combobox', {name: '隐私结果'});
  await openQuerySettings(page);
  await scope.selectOption('private');
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成隐私清单资料',
  );
  await openMarkdownExportPanel(page);
  await expect(panel).toContainText('合成隐私清单资料');
  await panel.getByRole('button', {name: '加入资料清单'}).click();
  const gate = controlledGate();
  fixture.hold(gate.promise);
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect
    .poll(() => fixture.requests.at(-1)?.privacyScope)
    .toBe('private_only');
  await openQuerySettings(page);
  await scope.selectOption('public');
  gate.release();
  await openMarkdownExportPanel(page);
  await expect(panel).not.toContainText('合成隐私清单资料');
  await expect(panel.getByRole('region', {name: '资料清单预览'})).toHaveCount(
    0,
  );
  await openQuerySettings(page);
  await scope.selectOption('private');
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成隐私清单资料',
  );
  await openMarkdownExportPanel(page);
  await panel.getByRole('button', {name: '加入资料清单'}).click();
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect(panel.getByRole('region', {name: '资料清单预览'})).toContainText(
    '仅隐私',
  );
  const writing = controlledGate();
  fixture.hold(writing.promise);
  await panel.getByRole('button', {name: '含隐私生成 Markdown 文件'}).click();
  await expect(panel.getByRole('button', {name: '正在生成…'})).toBeVisible();
  await openQuerySettings(page);
  await scope.selectOption('public');
  writing.release();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await openMarkdownExportPanel(page);
  await expect(panel.getByRole('link', {name: '下载 Markdown'})).toHaveCount(0);
  await expect(panel).not.toContainText('合成隐私清单资料');
});

test('keeps cited Markdown controls readable across five widths and recovers from file errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await installMarkdownExportFixture(page);
  const panel = await openQueryForExport(page);
  await panel.getByRole('button', {name: '加入资料清单'}).click();
  await panel
    .getByRole('textbox', {name: '清单标题'})
    .fill('合成资料复用清单与精确出处，检查较窄屏幕上的长标题');
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect(panel.getByRole('region', {name: '资料清单预览'})).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await panel
      .getByRole('button', {name: '生成 Markdown 文件', exact: true})
      .focus();
    await expect(
      panel.getByRole('button', {name: '生成 Markdown 文件', exact: true}),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('markdown-export-' + width.toString() + '.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({reducedMotion: 'reduce', forcedColors: 'active'});
  await panel.getByRole('textbox', {name: '清单标题'}).fill('字'.repeat(121));
  await expect(
    panel.getByRole('button', {name: '预览资料清单'}),
  ).toBeDisabled();
  await expect(panel.getByRole('region', {name: '资料清单预览'})).toHaveCount(
    0,
  );
  await panel.getByRole('textbox', {name: '清单标题'}).fill('合成错误恢复');
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect(panel.getByRole('region', {name: '资料清单预览'})).toBeVisible();
  fixture.fail('export_storage_unavailable');
  await panel
    .getByRole('button', {name: '生成 Markdown 文件', exact: true})
    .focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('文件保存失败');
  expect(fixture.writes).toHaveLength(0);
  await panel.getByRole('button', {name: '预览资料清单'}).click();
  await expect(
    panel.getByRole('button', {name: '生成 Markdown 文件', exact: true}),
  ).toBeEnabled();
  await panel
    .getByRole('button', {name: '生成 Markdown 文件', exact: true})
    .click();
  await expect(panel.getByRole('link', {name: '下载 Markdown'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('waits for current query results before collecting or comparing after a filter change', async ({
  page,
}) => {
  await installMarkdownExportFixture(page);
  const panel = await openQueryForExport(page);
  await page.clock.install({time: new Date('2026-09-05T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-09-05T12:00:01Z'));
  await page
    .getByRole('searchbox', {name: '关键词或问题'})
    .fill('合成新的查询条件');
  await openMarkdownExportPanel(page);
  await expect(
    panel.getByRole('button', {name: '加入资料清单'}),
  ).toBeDisabled();
  await openQuerySettings(page, '比较与探索');
  await expect(
    page.getByRole('button', {name: '加入比较', exact: true}),
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', {name: '开启或关闭关联联想'}),
  ).toBeDisabled();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toHaveCount(0);
  await page.clock.fastForward(301);
  await expect(
    page.getByRole('button', {name: '加入比较', exact: true}),
  ).toBeEnabled();
  await openMarkdownExportPanel(page);
  await expect(panel.getByRole('button', {name: '加入资料清单'})).toBeEnabled();
  await openQuerySettings(page, '比较与探索');
  await expect(
    page.getByRole('button', {name: '加入比较', exact: true}),
  ).toBeEnabled();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 1',
  );
});

test('keeps query pagination aligned after resubmitting and repeatedly clearing filters', async ({
  page,
}) => {
  await installMarkdownExportFixture(page);
  await openQueryForExport(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
  await expect(page.locator('.entry-pagination')).toContainText('第 2 页');
  await page.getByRole('searchbox', {name: '关键词或问题'}).press('Enter');
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 1',
  );
  await expect(page.locator('.entry-pagination')).toContainText('第 1 页');
  await expect(
    page.getByRole('button', {name: '上一页', exact: true}),
  ).toBeDisabled();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await openQuerySettings(page);
    await page.getByRole('button', {name: '清除筛选', exact: true}).click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('region', {name: '条目查询结果'}),
    ).toContainText('合成导出条目 1');
    await expect(page.locator('.entry-pagination')).toContainText('第 1 页');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
  await expect(page.locator('.entry-pagination')).toContainText('第 2 页');
});

test('edits a related entry from the document workbench without losing its reading context', async ({
  page,
}) => {
  const fixture = await installGraphReadCandidate(page);
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        documents: [{...SYNTHETIC_DOCUMENT, entryCount: 1}],
        totalCount: 1,
      },
    }),
  );
  await page.goto('/');
  await openWorkspace(page, '工作台');
  const paper = page.locator('.document-paper');
  const initial = await paper.boundingBox();
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '建立联系', exact: true}).click();
  const panel = page.getByRole('region', {name: '建立联系', exact: true});
  await panel
    .locator('.knowledge-relation-list li')
    .first()
    .getByRole('button')
    .first()
    .click();
  const inspector = panel.locator('.knowledge-edge-inspector');
  await inspector.getByLabel('关系名称', {exact: true}).fill('合成跨文档联系');
  expect(fixture.writes).toHaveLength(0);
  await inspector.getByRole('button', {name: '保存关系', exact: true}).click();
  await expect(panel.getByText('关系已保存', {exact: true})).toBeVisible();
  expect(fixture.writes[0]).toMatchObject({
    operation: 'edit',
    expectedRevision: 0,
    label: '合成跨文档联系',
  });
  await page.getByRole('button', {name: '关闭建立联系'}).click();
  await expect(paper).toContainText(SYNTHETIC_ENTRY.value.titlePath);
  expect((await paper.boundingBox())?.width).toBe(initial?.width);
});

test('keeps manual type and tag correction readable in the document workbench', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page, {restructureRequests: []});
  await page.goto('/');
  await openWorkspace(page, '工作台');
  await openDocumentEditor(page);
  await page
    .locator('.reader-editor-actions')
    .getByRole('button', {name: '编辑标签', exact: true})
    .click();
  const panel = page.getByRole('region', {name: '添加标签', exact: true});
  await panel
    .getByRole('combobox', {name: '类型关键词', exact: true})
    .selectOption('other');
  await panel
    .getByRole('textbox', {name: '自定义类型名称', exact: true})
    .fill('合成短技术笔记');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await expect(
      panel.getByRole('textbox', {name: '自定义类型名称', exact: true}),
    ).toHaveValue('合成短技术笔记');
    await panel
      .getByRole('button', {name: '确认标签并入库', exact: true})
      .focus();
    await expect(
      panel.getByRole('button', {name: '确认标签并入库', exact: true}),
    ).toBeFocused();
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('manual-type-' + String(width) + '.png'),
    });
  }
});

test('prioritizes reading with closed settings and keeps long titles and safe Markdown usable', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const title =
    'Synthetic reading title with enough words to exercise several lines in a narrow knowledge workspace';
  const entry = {
    ...SYNTHETIC_ENTRY,
    value: {
      ...SYNTHETIC_ENTRY.value,
      titlePath: title,
      body:
        '# ' +
        title +
        '\n\nA **structured** article.\n\n- First point\n- Second point\n\n[Source reference](https://example.invalid/reference)\n\n<script>window.unsafe = true</script>\n\n![Remote image](https://example.invalid/pixel.png)' +
        '\n\nA long synthetic paragraph for bounded reading and keyboard scrolling. '.repeat(
          120,
        ),
    },
  };
  await page.route('**/api/v1/entries/search', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        items: [{entry, matchReasons: [], filterReasons: []}],
        privateDocuments: {totalCount: 0, items: []},
      },
    }),
  );
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  await expect(page.locator('.reading-content strong')).toHaveText(
    'structured',
  );
  await expect(
    page.locator('.reading-content img, .reading-content script'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', {name: 'Source reference'}),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  const textRegion = page.getByRole('region', {name: '原文正文', exact: true});
  await expect(textRegion).toHaveAttribute('tabindex', '0');
  await textRegion.focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => textRegion.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    const results = await page.locator('.query-studio-results').boundingBox();
    expect(results?.y).toBeLessThan(720);
    const textBounds = await textRegion.boundingBox();
    if (!textBounds) throw new Error('Missing reading region');
    if (width >= 1024)
      expect(textBounds.y + textBounds.height).toBeLessThanOrEqual(976);
    else expect(textBounds.height).toBeLessThanOrEqual(700);
    const reading = await page.locator('.entry-readonly-detail').boundingBox();
    expect(reading?.width).toBeGreaterThan(width < 400 ? 210 : 350);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('reading-' + String(width) + '.png'),
      fullPage: true,
    });
  }
});

test('shows only the latest actual task stage and handles cancellation and empty work', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/workspace', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        workspaceId: WORKSPACE_ID,
        apiVersion: 'm1c.v1',
        capabilities: ['processing_runs'],
      },
    });
  });
  let status: 'cancelled' | 'succeeded' = 'cancelled';
  let totalUnits = 0;
  await page.route('**/api/v1/processing-runs?*', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        status: 'ok',
        runs: [
          {
            runId: '11111111-1111-4111-8111-111111111119',
            origin: 'deterministic',
            status,
            privacyScope: 'public_only',
            currentStage: 'tags',
            completedUnits: 0,
            totalUnits,
            attempt: 1,
            version: 2,
            createdAt: '2040-01-01T00:00:00.000Z',
            updatedAt: '2040-01-01T00:01:00.000Z',
            proposals: [],
          },
        ],
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '总览');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  await page.getByText('独立调用记录', {exact: true}).click();
  const rail = page.getByRole('complementary', {name: '最近处理任务'});
  await expect(rail.locator('.ai-stage-list li')).toHaveCount(1);
  await expect(rail.locator('.ai-stage-list')).toContainText('03 / 标签');
  await expect(rail.locator('.ai-stage-list')).toContainText('已取消');
  await expect(rail).toContainText('没有待处理项');
  await expect(rail).not.toContainText('NaN');
  await expect(rail.locator('.ai-stage-list')).not.toContainText('处理中');
  status = 'succeeded';
  totalUnits = 1;
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  await expect(rail.locator('.ai-stage-list')).toContainText('已完成');
  await expect(rail.locator('.ai-stage-list li')).toHaveCount(1);
  await page.keyboard.press('Escape');
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({width, height: 900});
    const navigation = page.getByRole('navigation', {name: '产品工作区'});
    for (const label of ['源管理', '文档阅读', '数据库']) {
      await expect(
        navigation.getByRole('button', {name: label, exact: true}),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
});

test('paginates and filters long document lists with exact source return', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  const snapshots = Array.from({length: 45}, (_, index) => ({
    ...SYNTHETIC_SNAPSHOT,
    snapshotId: String(index).padStart(8, '0') + '-0000-4000-8000-000000000045',
    sourceKey: 'synthetic-document-' + String(index + 1).padStart(3, '0'),
  }));
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots, totalCount: snapshots.length},
    }),
  );
  const tasks: AiTask[] = snapshots.map((snapshot, index) => ({
    taskId: 'synthetic-scroll-task-' + String(index),
    version: 1,
    model: 'synthetic',
    actorKind: 'owner',
    request: {kind: 'document', snapshotId: snapshot.snapshotId},
    state: {
      status: 'paused',
      phase: 'split',
      calls: 0,
      errorCode: 'ai_price_window_closed',
      steps: [],
    },
  }));
  const selectedTaskStarted = controlledGate();
  const selectedTaskResponse = controlledGate();
  let holdSelectedTask = false;
  await page.route('**/api/v1/ai-tasks/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {snapshotIds?: string[]};
    };
    if (operation !== 'tasks_list') return route.fallback();
    if (
      holdSelectedTask &&
      input.snapshotIds?.includes(snapshots[15]?.snapshotId ?? '')
    ) {
      selectedTaskStarted.release();
      await selectedTaskResponse.promise;
    }
    return route.fulfill({
      json: {
        result: input.snapshotIds
          ? tasks.filter((t) =>
              input.snapshotIds?.includes(t.request.snapshotId ?? ''),
            )
          : tasks,
      },
    });
  });
  const requestedSources: string[] = [];
  await page.route('**/api/v1/evidence/snapshots/*', (route) => {
    const snapshotId = new URL(route.request().url()).pathname
      .split('/')
      .at(-1);
    const snapshot = snapshots.find((value) => value.snapshotId === snapshotId);
    requestedSources.push(snapshotId ?? '');
    return route.fulfill({json: {status: 'ok', snapshot}});
  });
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        documents: snapshots.map((snapshot) => ({
          ...snapshot,
          entryCount: 0,
          annotatedEntryCount: 0,
        })),
        totalCount: snapshots.length,
      },
    }),
  );
  await page.route('**/api/v1/entries/search', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        querySha256: '0'.repeat(64),
        totalCount: 0,
        items: [],
        privateDocuments: {totalCount: 0, items: []},
      },
    }),
  );
  await page.goto('/');
  await openWorkspace(page, '工作台');
  await page.getByRole('button', {name: /选择文档/}).click();
  const list = page.locator('.document-library-list');
  await expect(list.locator('.document-library-item__processing')).toHaveCount(
    20,
  );
  await list.getByLabel('文档处理状态').selectOption('queued');
  await expect(list.locator('ol > li')).toHaveCount(20);
  const scrollBox = list.locator('.document-library-list__scroll');
  const target = list.locator('.document-library-item').nth(15);
  await target.scrollIntoViewIfNeeded();
  const scrollBefore = await scrollBox.evaluate((element) => element.scrollTop);
  expect(scrollBefore).toBeGreaterThan(100);
  holdSelectedTask = true;
  await target.click();
  await page.getByRole('button', {name: /选择文档/}).click();
  await selectedTaskStarted.promise;
  try {
    await expect(list.locator('ol > li')).toHaveCount(20);
    expect(
      await scrollBox.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(scrollBefore - 60);
  } finally {
    selectedTaskResponse.release();
  }
  await expect(
    list.locator('.document-library-item__processing').first(),
  ).toBeVisible();
  expect(
    await scrollBox.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(scrollBefore - 60);
  await list.getByLabel('文档处理状态').selectOption('all');
  await list.getByRole('button', {name: '下一页', exact: true}).click();
  await list.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(list.locator('ol > li')).toHaveCount(5);
  await list.locator('.document-library-item').last().click();
  await page.getByRole('button', {name: /选择文档/}).click();
  await expect
    .poll(() => requestedSources.at(-1))
    .toBe(snapshots[44]?.snapshotId);
  const filter = list.getByRole('searchbox', {name: '查找文档'});
  await filter.fill('synthetic-document-001');
  await expect(list.locator('ol > li')).toHaveCount(1);
  await expect(list.locator('footer')).toContainText('1 / 1');
  await filter.fill('no-match');
  await expect(list.getByText('没有匹配文档，请调整条件。')).toBeVisible();
  await filter.fill('');
  await expect(list.locator('ol > li')).toHaveCount(20);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await list.getByRole('button', {name: '下一页', exact: true}).click();
    await expect(list).toContainText('synthetic-document-021');
    await expect(list.locator('footer')).toContainText('2 / 3');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await list.getByRole('button', {name: '上一页', exact: true}).click();
  }
});

test('intake recovery selects evidence and refreshes captures without starting a task', async ({
  page,
}) => {
  await installCurrentProductApi(page, {manualSplitRequests: []});
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots: [SYNTHETIC_SNAPSHOT], totalCount: 1},
    }),
  );
  const oldWeb = '33333333-3333-4333-8333-333333333334',
    newWeb = '33333333-3333-4333-8333-333333333335';
  let record: IntakeRecord = {
    snapshotId: SNAPSHOT_ID,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      decision: 'held',
      origin: 'model',
      reason: '合成网页仅有摘要',
      preparation: 'web_article',
      preparedSnapshotId: oldWeb,
    },
  };
  const task: AiTask = {
    taskId: '11111111-1111-4111-8111-111111111112',
    version: 4,
    model: 'synthetic',
    actorKind: 'owner',
    request: {kind: 'document', snapshotId: SNAPSHOT_ID},
    state: {
      status: 'paused',
      phase: 'intake',
      calls: 1,
      steps: [{kind: 'intake', targetId: SNAPSHOT_ID, complete: false}],
    },
  };
  let resumes = 0;
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        snapshotId: string;
        selection: {
          source: 'received' | 'web_article';
          expectedVersion: number;
          refresh: boolean;
        };
      };
    };
    if (operation === 'intake_status')
      return route.fulfill({json: {result: {records: [record]}}});
    if (operation !== 'intake_prepare') return route.fallback();
    expect(input.snapshotId).toBe(SNAPSHOT_ID);
    expect(input.selection.expectedVersion).toBe(record.version);
    record = {
      ...record,
      version: record.version + 1,
      value: {
        ...record.value,
        decision: 'pending',
        origin: 'system',
        reason: '合成正文待重新审核',
        bodySource: input.selection.source,
        preparation: input.selection.source,
        ...(input.selection.refresh
          ? {preparedSnapshotId: newWeb, previousPreparedSnapshotIds: [oldWeb]}
          : {}),
      },
    };
    await route.fulfill({json: {result: record}});
  });
  await page.route('**/api/v1/ai-tasks/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {taskId: string; expectedVersion: number; action: string};
    };
    if (operation === 'tasks_list')
      return route.fulfill({json: {result: [task]}});
    if (operation !== 'task_control') return route.fallback();
    expect(input).toEqual({
      taskId: task.taskId,
      expectedVersion: 4,
      action: 'resume',
    });
    resumes++;
    task.state.status = 'running';
    await route.fulfill({json: {result: task}});
  });
  await page.goto('/');
  await openWorkspace(page, '收件箱');
  await page
    .getByRole('combobox', {name: '接收状态', exact: true})
    .selectOption('accepted');
  await page.getByRole('button', {name: '更多接收操作', exact: true}).click();
  await page.getByRole('button', {name: '接收详情与正文恢复'}).click();
  const panel = page
    .getByRole('region', {name: '接收审核与拦截', exact: true})
    .locator('.ai-workflow-panel');
  await expect(
    panel.getByRole('button', {name: '继续整理任务'}),
  ).toBeDisabled();
  await panel.getByRole('button', {name: '重新获取网页正文'}).click();
  await expect(panel.getByText('已暂缓', {exact: true})).toHaveCount(0);
  await panel.getByText('过往网页抓取 · 1').click();
  await expect(
    panel.getByRole('button', {name: '阅读第 1 次抓取'}),
  ).toBeVisible();
  await panel.getByRole('button', {name: '改用接收原文'}).click();
  await expect(panel.getByText('用于整理的正文：接收原文 / RSS')).toBeVisible();
  expect(resumes).toBe(0);
  expect(task.state.calls).toBe(1);
  for (const width of [390, 1440]) {
    await page.setViewportSize({width, height: 900});
    await panel
      .getByRole('button', {name: '继续整理任务'})
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
  }
  await panel.getByRole('button', {name: '继续整理任务'}).click();
  await expect(
    panel.getByRole('button', {name: '重新获取网页正文'}),
  ).toBeDisabled();
  expect(resumes).toBe(1);
  await page.screenshot({path: 'test-results/intake-body-recovery.png'});
});

test('DeepSeek price settings save with version checks and preserve drafts across status refresh', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  let policy = {revision: 0, enabled: false};
  const writes: {revision: number; enabled: boolean}[] = [];
  await page.route('**/api/v1/ai-price/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: typeof policy;
    };
    if (operation === 'ai_price_save') {
      expect(input.revision).toBe(policy.revision);
      writes.push(input);
      policy = {...input, revision: policy.revision + 1};
    }
    await route.fulfill({
      json: {
        result: {
          policy,
          rule: 'deepseek-weekday-peak-2026-09-14',
          timeZone: 'Asia/Shanghai',
          provider: 'deepseek-responses-v1',
          applicable: true,
          peak: true,
          blocked: policy.enabled,
          checkedAt: '2040-01-02T01:00:00Z',
          nextAllowedAt: policy.enabled ? '2040-01-02T04:00:00Z' : null,
        },
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '设置');
  await page.getByRole('link', {name: 'AI 执行', exact: true}).click();
  const panel = page
    .locator('.setting-card')
    .filter({has: page.getByRole('heading', {name: '价格时段', exact: true})});
  const toggle = panel.getByRole('switch', {
    name: '仅在 DeepSeek 低价时段调用',
  });
  await toggle.check();
  await panel.getByRole('button', {name: '保存时段设置'}).click();
  await expect(
    panel.getByText('高峰时段，等待低价', {exact: true}),
  ).toBeVisible();
  await expect(
    panel.getByText(/下次允许调用：北京时间 1\/2 12:00/),
  ).toBeVisible();
  expect(writes).toEqual([{revision: 0, enabled: true}]);
  await toggle.uncheck();
  await panel.getByRole('button', {name: '刷新状态'}).click();
  await expect(toggle).not.toBeChecked();
  await expect(panel.getByRole('button', {name: '保存时段设置'})).toBeEnabled();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    await panel
      .getByRole('button', {name: '保存时段设置'})
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
  }
  await panel.getByRole('button', {name: '保存时段设置'}).click();
  await expect(panel.getByText('时段限制未开启', {exact: true})).toBeVisible();
  expect(writes).toHaveLength(2);
});

async function openWorkspace(
  page: Page,
  label: string,
  navigation: Locator = page.getByRole('navigation', {name: '产品工作区'}),
) {
  await closeFloatingTools(page);
  if (label === '总览') {
    await page
      .getByRole('button', {name: 'StruInfo · 运行总览', exact: true})
      .click();
    return;
  }
  if (label === '设置' || ['标签', '联系', '拆分'].includes(label)) {
    await page.getByRole('button', {name: '设置', exact: true}).click();
    if (label !== '设置') {
      await page.getByRole('link', {name: '自动处理', exact: true}).click();
      await page
        .getByRole('button', {name: '拆分与本地推荐', exact: true})
        .click();
    }
    return;
  }
  const names: Record<string, string> = {
    导入: '源管理',
    收件箱: '源管理',
    文档入口: '源管理',
    资料库: '文档阅读',
    工作台: '文档阅读',
    查询: '数据库',
    知识: '数据库',
    数据阅览: '数据库',
    报告: '数据库',
  };
  await navigation
    .getByRole('button', {name: names[label] ?? label, exact: true})
    .click();
  if (label === '导入')
    await page.getByRole('button', {name: '手动放入', exact: true}).click();
  if (['文档入口', '收件箱'].includes(label))
    await page.getByRole('button', {name: /接收记录与计划/u}).click();
  if (['查询', '知识', '数据阅览'].includes(label))
    await page
      .getByRole('search')
      .getByRole('button', {name: '搜索', exact: true})
      .click();
  if (
    label === '报告' &&
    !(await page.getByRole('dialog', {name: '报告', exact: true}).isVisible())
  ) {
    const panel = page.getByRole('button', {name: '展开报告', exact: true});
    if (await panel.isVisible()) await panel.click();
    const card = page.locator('.database-report-card').first();
    if (await card.isVisible()) await card.click();
    else
      await page.getByRole('button', {name: '新建报告', exact: true}).click();
  }
  if (label === '知识') {
    await openQuerySettings(page, '阅读与导出');
    await page.getByRole('button', {name: '联系星图', exact: true}).click();
    await page.keyboard.press('Escape');
  }
}

test('keeps document reading stable through source, structure, tags and relationship workbenches', async ({
  page,
}) => {
  const restructureRequests: Readonly<{path: string; body: string}>[] = [];
  const writes: Record<string, unknown>[] = [];
  await installCurrentProductApi(page, {restructureRequests});
  await page.route('**/api/v1/entries/' + ENTRY_ID, async (route) => {
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {status: 'applied', entry: {...SYNTHETIC_ENTRY, revision: 2}},
    });
  });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  const paper = page.locator('.document-paper');
  await expect(paper).toContainText(SYNTHETIC_ENTRY.value.titlePath);
  const before = await paper.boundingBox();
  if (before === null) throw Error('Reading paper missing');
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '来源与证据', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '来源详情', exact: true}),
  ).toContainText('原文片段');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {name: '编辑', exact: true}),
  ).toBeVisible();
  await openDocumentEditor(page);
  await page
    .locator('.reader-editor-actions')
    .getByRole('button', {name: '编辑标签', exact: true})
    .click();
  const tags = page.getByRole('region', {name: '添加标签', exact: true});
  const keywords = tags.getByLabel('内容关键词（逗号或换行分隔）');
  await keywords.fill('合成关键词');
  await tags
    .getByRole('combobox', {name: '主领域', exact: true})
    .selectOption('engineering_computing');
  await page.getByRole('button', {name: '关闭添加标签'}).click();
  await openDocumentEditor(page);
  await page.getByRole('button', {name: '建立联系', exact: true}).click();
  await expect(
    page
      .getByRole('region', {name: '建立联系', exact: true})
      .locator('.knowledge-inspector'),
  ).toBeVisible();
  await page.getByRole('button', {name: '关闭建立联系'}).click();
  await openDocumentEditor(page);
  await page
    .locator('.reader-editor-actions')
    .getByRole('button', {name: '编辑标签', exact: true})
    .click();
  await expect(keywords).toHaveValue('合成关键词');
  const after = await paper.boundingBox();
  expect(after?.width).toBeCloseTo(before.width, 1);
  await tags.locator('summary').filter({hasText: '整篇文档标签'}).click();
  await expect(
    tags.getByRole('button', {name: '按全文重新聚合'}),
  ).toBeVisible();
  await tags.getByRole('button', {name: '确认标签并入库', exact: true}).click();
  await expect(page.getByText('条目已保存', {exact: true})).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    expectedRevision: 1,
    includePrivate: false,
    annotation: {
      body: SYNTHETIC_ENTRY.value.body,
      contentKeywords: ['合成关键词'],
    },
  });
  await expect(
    page.getByRole('heading', {name: '文档阅读', exact: true}),
  ).toBeVisible();
});

test('persists appearance while keeping document actions stable and preserves a conflicting draft', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  let saved = structuredClone(DEFAULT_WORKSPACE_UI_PREFERENCES);
  const writes: (typeof saved)[] = [];
  let conflict = false;
  await page.route('**/api/v1/preferences/interface', async (route) => {
    if (route.request().method() === 'PUT') {
      const candidate = route.request().postDataJSON() as typeof saved;
      writes.push(candidate);
      if (conflict) {
        saved = {...saved, revision: saved.revision + 1};
        await route.fulfill({
          status: 409,
          json: {status: 'conflict', preferences: saved},
        });
        return;
      }
      saved = {...candidate, revision: saved.revision + 1};
    }
    await route.fulfill({json: {status: 'ok', preferences: saved}});
  });
  await page.goto('/');
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '光效与动画', exact: true}),
  ).toBeVisible();
  await page.getByRole('combobox', {name: '主题'}).selectOption('dark');
  await page.getByRole('button', {name: '保存主题', exact: true}).click();
  await expect(page.getByText('已保存。', {exact: true})).toBeVisible();
  expect(writes[0]?.sidebars).toEqual(
    DEFAULT_WORKSPACE_UI_PREFERENCES.sidebars,
  );
  await page.reload();
  await openWorkspace(page, '工作台');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openDocumentEditor(page);
  const actions = page.locator('.reader-editor-actions');
  await expect(
    actions.getByRole('button', {name: '修改分段', exact: true}),
  ).toBeVisible();
  await expect(
    actions.getByRole('button', {name: '建立联系', exact: true}),
  ).toBeVisible();
  await openWorkspace(page, '设置');
  conflict = true;
  await page.getByRole('combobox', {name: '主题'}).selectOption('light');
  await page.getByRole('button', {name: '保存主题', exact: true}).click();
  await expect(
    page.locator('.appearance-card').getByRole('status'),
  ).toContainText('当前草稿仍然保留');
  await expect(page.getByRole('combobox', {name: '主题'})).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', {name: '重新读取'}).click();
  await expect(page.getByRole('combobox', {name: '主题'})).toHaveValue('dark');
});

test('applies browser appearance controls and keeps settings groups open', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await page.getByRole('button', {name: '设置', exact: true}).click();
  const settings = page.locator('.settings-content');
  await expect(
    settings.getByRole('heading', {name: '光效与动画', exact: true}),
  ).toBeVisible();
  await expect(settings.getByText(/隐私文档/)).toHaveCount(0);
  const glow = settings.getByRole('slider', {name: /发光强度/u});
  await glow.focus();
  await glow.press('Home');
  await expect(page.locator('body')).toHaveAttribute('data-glow', 'off');
  for (let i = 0; i < 8; i++) await glow.press('ArrowRight');
  await expect(glow).toHaveValue('40');
  await expect(page.locator('body')).toHaveAttribute('data-glow', 'on');
  await settings.getByRole('switch', {name: /玻璃效果/u}).uncheck();
  await settings.getByRole('switch', {name: /^界面动画/u}).uncheck();
  await expect(
    settings.getByRole('switch', {name: /^流程动画/u}),
  ).toBeDisabled();
  const size = settings.getByRole('slider', {name: /正文字号/u});
  await size.focus();
  await size.press('End');
  await expect(settings.locator('.appearance-reading-preview')).toHaveCSS(
    'font-size',
    '24px',
  );
  await page.reload();
  await expect(glow).toHaveValue('40');
  await expect(size).toHaveValue('24');
  await expect(page.locator('body')).toHaveAttribute('data-glass', 'off');
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'off');
  const status = page.getByRole('button', {
    name: '系统状态 · 正常',
    exact: true,
  });
  await status.click();
  await expect(
    page.locator('.system-status .floating-tool-panel__surface'),
  ).toHaveCSS('backdrop-filter', 'none');
  await page.keyboard.press('Escape');
  await openWorkspace(page, '总览');
  await expect(page.locator('.editorial-overview')).toHaveAttribute(
    'data-motion-allowed',
    'false',
  );
  await expect(page.locator('.ef-node-ring:visible')).toHaveCount(0);
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await settings
    .getByRole('button', {name: '恢复默认光效和字号', exact: true})
    .click();
  await expect(glow).toHaveValue('100');
  await expect(size).toHaveValue('17');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`appearance-${String(width)}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('link', {name: '自动处理', exact: true}).click();
  await expect(
    settings.getByRole('button', {name: '拆分与本地推荐', exact: true}),
  ).toBeVisible();
  await page.getByRole('link', {name: '标签与词表', exact: true}).click();
  await expect(
    settings.getByRole('button', {name: '维度、词条与别名', exact: true}),
  ).toBeVisible();
  await page.getByRole('link', {name: '数据与维护', exact: true}).click();
  await settings
    .getByRole('button', {name: '导入、导出与恢复', exact: true})
    .click();
  await expect(
    page.getByRole('button', {name: '导出全部个人数据', exact: true}),
  ).toBeVisible();
});

test('AI controls preserve drafts across refresh and filters, pause saved policy and expose queue recovery', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  let policy: AiPolicy = {
    revision: 1,
    settings: {
      enabled: true,
      paused: false,
      subscriptionIds: [],
      manualUploads: true,
      model: 'synthetic-model',
      maxEntries: 12,
      maxModelCalls: 20,
      maxDocumentsPerDay: 10,
    },
  };
  const writes: {expectedRevision: number; settings: AiPolicy['settings']}[] =
    [];
  const controls: unknown[] = [];
  let configured = false;
  let status = 'attention',
    version = 1;
  await page.route('**/api/v1/*/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: Record<string, unknown>;
    };
    let result: unknown;
    if (
      operation.startsWith('ai_price_') ||
      operation === 'reports_list' ||
      operation === 'report_pipeline_status' ||
      operation === 'topics_list' ||
      operation === 'topic_jobs' ||
      operation === 'intake_status' ||
      operation === 'source_quality_status' ||
      operation.startsWith('annotation_') ||
      operation.startsWith('topic_') ||
      operation.startsWith('split_')
    ) {
      await route.fallback();
      return;
    }
    if (operation === 'system_status')
      result = {
        role: 'all',
        agentEnabled: false,
        grants: [],
        ...(configured ? {model: 'synthetic-model'} : {}),
      };
    else if (operation === 'subscriptions_list' || operation === 'tasks_list')
      result = [];
    else if (operation === 'ingestion_status')
      result = {
        policy,
        modelConfigured: configured,
        summary: {counts: {[status]: 1}, admittedToday: 1, modelAttempts: 2},
        items:
          input.status && input.status !== status
            ? []
            : [
                {
                  snapshotId: SNAPSHOT_ID,
                  sourceLabel: '合成自动处理文档',
                  status,
                  version,
                  errorCode: 'ai_provider_unavailable',
                  task: {status: 'failed', phase: 'split', calls: 2},
                },
              ],
      };
    else if (operation === 'ingestion_policy_save') {
      const write = input as unknown as (typeof writes)[number];
      writes.push(structuredClone(write));
      if (write.expectedRevision !== policy.revision) {
        await route.fulfill({
          status: 409,
          json: {error: {code: 'stale_ingestion_policy'}},
        });
        return;
      }
      policy = {revision: policy.revision + 1, settings: write.settings};
      result = policy;
    } else if (operation === 'ingestion_item_control') {
      controls.push(input);
      status = input.action === 'take_over' ? 'taken_over' : 'pending';
      version++;
      result = {};
    } else throw new Error('Unexpected synthetic command: ' + operation);
    await route.fulfill({json: {result}});
  });
  await page.goto('/');
  await openWorkspace(page, '设置');
  await page.getByRole('link', {name: '自动处理', exact: true}).click();
  const panel = page.locator('.ai-automation-settings');
  await expect(panel.getByText('模型尚未配置。', {exact: true})).toBeVisible();
  const limit = panel.getByRole('spinbutton', {
    name: '每日新文档',
    exact: true,
  });
  await limit.fill('7');
  const save = panel.getByRole('button', {name: '保存处理策略', exact: true});
  await expect(save).toBeDisabled();
  configured = true;
  await panel.getByRole('button', {name: '刷新状态', exact: true}).click();
  await expect(save).toBeEnabled();
  await expect(limit).toHaveValue('7');
  policy = {
    ...policy,
    revision: 2,
    settings: {...policy.settings, paused: true},
  };
  await panel.getByRole('button', {name: '刷新状态', exact: true}).click();
  await expect(panel.getByText(/服务器策略已变化/)).toBeVisible();
  await expect(limit).toHaveValue('7');
  await save.click();
  await expect(panel.getByRole('status').last()).toContainText('策略');
  await panel.getByRole('button', {name: '重新读取策略', exact: true}).click();
  await expect(limit).toHaveValue('10');
  await expect(
    panel.getByRole('switch', {name: '暂停处理，继续收件', exact: true}),
  ).toBeChecked();
  await limit.fill('7');
  await save.click();
  await expect(panel.getByRole('status').last()).toContainText('已保存');
  expect(writes.at(-1)).toMatchObject({
    expectedRevision: 2,
    settings: {maxDocumentsPerDay: 7, paused: true},
  });
  expect(controls).toEqual([]);
});

test('creates, reviews and exports cited reports while preserving reading context across workspaces', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  const source = {
    handle: 1,
    entryId: ENTRY_ID,
    snapshotId: SNAPSHOT_ID,
    intakeSnapshotId: SNAPSHOT_ID,
    revision: 1,
    title: 'Synthetic report article',
    sourceKey: 'Synthetic feed',
    date: '2040-01-02',
    receivedDate: '2040-01-02',
    publishedDate: '2039-12-01',
    excerpt: 'Complete synthetic source, with its context preserved.',
    keywords: [],
    reason: 'Synthetic admission',
  };
  const otherSource = {
    ...source,
    handle: 2,
    entryId: '00000000-0000-4000-8000-000000000099',
    title: 'Another independent synthetic event',
  };
  let record: ReportRecord | undefined;
  let generatedReport: ReportRecord | undefined;
  const created: Record<string, unknown>[] = [];
  await page.route('**/api/v1/reports/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: Record<string, unknown>;
    };
    let result: unknown;
    const view = () => ({
      report: record,
      active: false,
      staleSources: [],
      model: 'synthetic-model',
    });
    if (operation === 'reports_list')
      result = {
        reports: record
          ? [
              {
                reportId: record.reportId,
                version: record.version,
                title: record.state.title,
                kind: 'daily',
                period: record.state.period,
                status: record.state.status,
                itemCount: record.state.items.length,
                stale: false,
              },
            ]
          : [],
        model: 'synthetic-model',
      };
    else if (operation === 'report_preview')
      result = {
        period: {from: '2040-01-02', to: '2040-01-02'},
        sources: [source, otherSource],
        totalEligible: 2,
        duplicateCount: 2,
      };
    else if (operation === 'report_create') {
      created.push(input);
      record = {
        reportId: RESOURCE_ID,
        version: 1,
        createdAt: '2040-01-02T00:00:00Z',
        updatedAt: '2040-01-02T00:00:00Z',
        state: {
          request: input.request as ReportRequest,
          title: '合成日报',
          period: {from: '2040-01-02', to: '2040-01-02'},
          sources: [source, otherSource],
          totalEligible: 2,
          duplicateCount: 2,
          items: [],
          planned: false,
          status: 'draft',
          calls: 0,
        },
      };
      result = view();
    } else if (operation === 'report_generate' && record) {
      const waiting: ReportRecord = {
        ...record,
        state: {
          ...record.state,
          status: 'queued',
          errorCode: 'ai_price_window_closed',
        },
      };
      record = {
        ...record,
        version: 2,
        state: {
          ...record.state,
          status: 'ready',
          calls: 2,
          planned: true,
          model: 'synthetic-model',
          otherGroups: [{title: '另一件独立事件', sources: [2]}],
          items: [
            {
              group: {title: '合成观察', sources: [1]},
              included: true,
              draft: {
                title: '合成观察',
                points: [
                  {
                    text: '由合成材料支持的摘要与上下文。',
                    sources: [1],
                    role: 'finding',
                  },
                  {
                    text: '同一合成材料中的关键依据。',
                    sources: [1],
                    role: 'evidence',
                  },
                  {
                    text: '同一合成材料中的适用限制。',
                    sources: [1],
                    role: 'limitation',
                  },
                ],
              },
            },
          ],
        },
      };
      generatedReport = record;
      record = waiting;
      result = view();
    } else if (operation === 'report_read' && generatedReport) {
      record = generatedReport;
      generatedReport = undefined;
      result = view();
    } else if (operation === 'report_edit' && record) {
      if (input.expectedVersion !== record.version) {
        await route.fulfill({
          status: 409,
          json: {error: {code: 'stale_report_version'}},
        });
        return;
      }
      const edit = input.edit as ReportEdit;
      record = {
        ...record,
        version: record.version + 1,
        state: {
          ...record.state,
          title: edit.title,
          status: edit.reviewed ? 'reviewed' : 'ready',
          items: record.state.items.map((item, index) => ({
            ...item,
            ...{
              included: edit.items[index]?.included ?? true,
              ...(edit.items[index]?.story
                ? {edited: edit.items[index].story}
                : {}),
            },
          })),
        },
      };
      result = view();
    } else if (operation === 'report_export')
      result = {
        fileName: 'synthetic-report.md',
        markdown: '# Synthetic reviewed report\n\n[1] Synthetic source\n',
      };
    else result = view();
    await route.fulfill({json: {result}});
  });
  await page.goto('/');
  await openWorkspace(page, '报告');
  const workspace = page.getByRole('region', {name: '报告', exact: true});
  await workspace.getByLabel('报告日期', {exact: true}).fill('2040-01-02');
  await workspace.getByRole('button', {name: '预览材料', exact: true}).click();
  await expect(
    workspace.getByText('2 条符合条件 · 已排除 2 条重复记录'),
  ).toBeVisible();
  await workspace.getByRole('button', {name: '加入 AI 生成队列'}).click();
  expect(created[0]).toMatchObject({
    request: {
      date: '2040-01-02',
      selectedEntryIds: [ENTRY_ID, otherSource.entryId],
    },
  });

  await expect(workspace.getByText('核心结论', {exact: true})).toHaveCount(0);
  await expect(workspace.locator('.report-queue-title')).toBeVisible();
  await expect(workspace.getByText('同一合成材料中的适用限制。')).toBeVisible();
  const story = workspace.locator('.report-story');
  await expect(story.locator('.report-point')).toHaveCount(3);
  await expect(story.locator('.report-point-references')).toHaveCount(0);
  await expect(
    story.getByRole('button', {
      name: '[1] Synthetic report article',
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    workspace
      .locator('.report-source-dates')
      .getByText(/发布 2039-12-01 · 接收 2040-01-02 · 补充阅读/),
  ).toBeVisible();
  const moreReading = workspace.locator('.report-other-reading');
  await moreReading.locator('summary').click();
  await expect(
    moreReading.getByRole('heading', {name: '另一件独立事件'}),
  ).toBeVisible();
  await expect(
    moreReading.getByRole('button', {
      name: '[2] Another independent synthetic event',
    }),
  ).toBeVisible();
  await moreReading.locator('summary').click();
  await expect(
    workspace.getByText('由合成材料支持的摘要与上下文。'),
  ).toBeVisible();
  await workspace
    .getByRole('button', {name: '[1] Synthetic report article', exact: true})
    .first()
    .click();
  await expect(
    page.getByRole('heading', {name: '文档阅读', exact: true}),
  ).toBeVisible();
  await openWorkspace(page, '报告');
  await expect(
    workspace.getByText('由合成材料支持的摘要与上下文。'),
  ).toBeVisible();
  const history = workspace.locator('.report-queue-title');
  await history.click();
  await expect(history).toHaveAttribute('aria-expanded', 'false');
  await history.click();
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  const editButton = workspace.getByRole('button', {
    name: '核对与编辑',
    exact: true,
  });
  await editButton.click();
  const editor = page.getByRole('dialog', {name: '报告核对工作台'});
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole('button', {name: '关闭核对与编辑'}),
  ).toBeFocused();
  await editor
    .getByRole('textbox', {name: '摘要 1', exact: true})
    .fill('人工检查了合成原文的上下文。');
  await page.keyboard.press('Escape');
  await expect(editor).not.toBeVisible();
  const resume = workspace.getByRole('button', {
    name: '继续编辑草稿',
    exact: true,
  });
  await expect(resume).toBeFocused();
  await expect(
    workspace.getByRole('button', {name: /^加入 AI 生成队列/u}),
  ).toBeDisabled();
  await resume.click();
  await expect(
    editor.getByRole('textbox', {name: '摘要 1', exact: true}),
  ).toHaveValue('人工检查了合成原文的上下文。');
  await editor
    .getByRole('button', {name: '[1] Synthetic report article', exact: true})
    .click();
  await expect(
    page.getByRole('heading', {name: '文档阅读', exact: true}),
  ).toBeVisible();
  await expect(editor).not.toBeVisible();
  const changedElsewhere = record;
  if (!changedElsewhere) throw new Error('missing synthetic report');
  changedElsewhere.version += 1;
  await openWorkspace(page, '报告');
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole('textbox', {name: '摘要 1', exact: true}),
  ).toHaveValue('人工检查了合成原文的上下文。');
  await editor.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect(editor.getByRole('alert')).toContainText('报告已被其他操作更新');
  await expect(
    editor.getByRole('textbox', {name: '摘要 1', exact: true}),
  ).toHaveValue('人工检查了合成原文的上下文。');
  expect(changedElsewhere.version).toBe(3);
  await editor.getByRole('button', {name: '放弃本次编辑', exact: true}).click();
  await editButton.click();
  await editor
    .getByRole('textbox', {name: '摘要 1', exact: true})
    .fill('人工检查了合成原文的上下文。');
  await editor.getByRole('button', {name: '确认已核对', exact: true}).click();
  await expect(editor).not.toBeVisible();
  await expect(
    workspace
      .locator('.report-queue-status')
      .getByText('已核对', {exact: true}),
  ).toBeVisible();
  await expect(
    workspace.getByText('人工检查了合成原文的上下文。'),
  ).toBeVisible();
  await page.context().addInitScript(() => {
    window.print = () => undefined;
  });
  const printPage = page.waitForEvent('popup');
  await workspace.getByRole('button', {name: '导出 PDF', exact: true}).click();
  const pdf = await printPage;
  await expect(
    pdf.getByRole('heading', {name: 'Synthetic reviewed report'}),
  ).toBeVisible();
  await expect(
    pdf.getByRole('button', {name: '打印 / 保存 PDF'}),
  ).toBeVisible();
  await pdf.close();
  const download = page.waitForEvent('download');
  await workspace
    .getByRole('button', {name: '导出 Markdown', exact: true})
    .click();
  expect((await download).suggestedFilename()).toBe('synthetic-report.md');
  for (const [width, height] of [
    [1600, 1000],
    [1024, 900],
    [768, 1024],
    [320, 800],
  ] as const) {
    await page.setViewportSize({width, height});
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    if (process.env.STRUIINFO_UI_EVIDENCE_ROOT)
      await page.screenshot({
        path:
          process.env.STRUIINFO_UI_EVIDENCE_ROOT +
          '/reports-' +
          String(width) +
          '.png',
        fullPage: true,
      });
    await workspace
      .getByRole('button', {name: '核对与编辑', exact: true})
      .click();
    await expect(editor).toBeVisible();
    await expect
      .poll(() => editor.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    if (process.env.STRUIINFO_UI_EVIDENCE_ROOT)
      await page.screenshot({
        path:
          process.env.STRUIINFO_UI_EVIDENCE_ROOT +
          '/report-editor-' +
          String(width) +
          '.png',
      });
    await editor
      .getByRole('button', {name: '放弃本次编辑', exact: true})
      .click();
    await expect(editor).not.toBeVisible();
  }
});

test('keeps report selection model-off and invalidates material previews after selection changes', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/reports/commands', async (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    await route.fulfill({
      json: {
        result:
          operation === 'reports_list'
            ? {reports: [], model: null}
            : {
                period: {from: '2040-01-02', to: '2040-01-02'},
                sources: [],
                totalEligible: 0,
                duplicateCount: 0,
              },
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '报告');
  const workspace = page.getByRole('region', {name: '报告', exact: true});
  await expect(
    workspace.getByText('模型尚未启用。选材、手动编写和导出仍可使用。'),
  ).toBeVisible();
  await workspace
    .getByRole('combobox', {name: '报告类型', exact: true})
    .selectOption('weekly');
  await workspace
    .getByLabel('本周中的任意日期', {exact: true})
    .fill('2040-01-02');
  await workspace.getByRole('button', {name: '预览材料', exact: true}).click();
  await expect(
    workspace.getByText(
      '本周期暂无可用材料。可调整日期，或先在文档入口接受，再到工作台整理入库。',
    ),
  ).toBeVisible();
  await workspace
    .getByLabel('本周中的任意日期', {exact: true})
    .fill('2040-01-09');
  await expect(workspace.getByRole('region', {name: '选材预览'})).toHaveCount(
    0,
  );
  await expect(
    workspace.getByRole('button', {name: /^加入 AI 生成队列/u}),
  ).toBeDisabled();
});

test('documents show scoped AI work and result details without moving the reading paper', async ({
  page,
}) => {
  await installCurrentProductApi(page, {restructureRequests: []});
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const writes: string[] = [];
  let fail = false;
  let task: AiTask = {
    taskId: '11111111-1111-4111-8111-111111111112',
    version: 1,
    actorKind: 'owner',
    model: 'synthetic-model',
    request: {kind: 'document', snapshotId: SNAPSHOT_ID},
    state: {
      status: 'paused',
      phase: 'split',
      calls: 0,
      errorCode: 'ai_price_window_closed',
      steps: [{kind: 'split', targetId: SNAPSHOT_ID, complete: false}],
    },
  };
  const scoped: string[][] = [];
  await page.route('**/api/v1/ai-tasks/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {snapshotIds?: string[]};
    };
    if (operation === 'system_status') return route.fallback();
    if (operation !== 'tasks_list') {
      writes.push(operation);
      return route.fallback();
    }
    if (fail)
      return route.fulfill({
        status: 503,
        json: {error: {code: 'ai_operation_failed'}},
      });
    if (input.snapshotIds) scoped.push(input.snapshotIds);
    // The document is older than the global recent task list.
    return route.fulfill({
      json: {result: input.snapshotIds?.includes(SNAPSHOT_ID) ? [task] : []},
    });
  });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  const openDetails = async () => {
    if (
      await page
        .getByRole('region', {name: 'AI 处理详情', exact: true})
        .isVisible()
    )
      return;
    await openDocumentEditor(page);
    await page.getByRole('button', {name: 'AI 处理', exact: true}).click();
  };
  await openDetails();
  const details = page.getByRole('region', {name: 'AI 处理详情', exact: true});
  await expect(details).toContainText('AI 等待低价时段');
  await expect(details).toContainText('0 次调用尝试');
  expect(scoped.some((ids) => ids.includes(SNAPSHOT_ID))).toBe(true);
  const paper = page.locator('.reading-stage');
  const before = await paper.boundingBox();
  await details
    .getByRole('button', {name: '关闭AI 处理详情', exact: true})
    .click();
  await closeFloatingTools(page);
  task = {
    ...task,
    version: 2,
    state: {
      status: 'succeeded',
      phase: 'complete',
      calls: 4,
      steps: [
        {
          kind: 'split',
          targetId: SNAPSHOT_ID,
          complete: true,
          proposalId: 'synthetic-split',
        },
        {
          kind: 'tags',
          targetId: ENTRY_ID,
          complete: true,
          proposalId: 'synthetic-tags',
        },
        {
          kind: 'relation',
          targetId: ENTRY_ID,
          complete: true,
          outcome: 'no_relation',
          candidateReasons: ['合成主题相似但没有明确关系'],
        },
        {
          kind: 'relation',
          targetId: ENTRY_ID,
          complete: true,
          outcome: 'edge_budget_reached',
        },
      ],
    },
  };
  await page.getByRole('button', {name: '刷新文档', exact: true}).click();
  await openDetails();
  await expect(details).toContainText('AI 处理完成');
  if (!(await details.isVisible())) await openDetails();
  await expect(details).toContainText('已建 0 · 未建 1 · 1 未评估');
  await details.getByText('候选 1 · 未建立联系', {exact: true}).click();
  await expect(details).toContainText('合成主题相似但没有明确关系');
  await details
    .getByRole('button', {name: '查看生成的条目', exact: true})
    .click();
  await expect(paper).toContainText(SYNTHETIC_ENTRY.value.body);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    if (!(await details.isVisible())) await openDetails();
    await expect(details).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await details
      .getByRole('button', {name: '关闭AI 处理详情', exact: true})
      .click();
    await closeFloatingTools(page);
  }
  fail = true;
  await page.getByRole('button', {name: '刷新文档', exact: true}).click();
  await openDetails();
  await expect(details).toContainText('读取');
  await details
    .getByRole('button', {name: '关闭AI 处理详情', exact: true})
    .click();
  await closeFloatingTools(page);
  await page.setViewportSize({width: 1440, height: 1000});
  expect(await paper.boundingBox()).toEqual(before);
  fail = false;
  await page.getByRole('button', {name: '刷新文档', exact: true}).click();
  await openDetails();
  await expect(details).toContainText('AI 处理完成');
  expect(writes).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('document source shows real split lines and header annotations across entry pages', async ({
  page,
}) => {
  await installCurrentProductApi(page, {restructureRequests: []});
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const parts = Array.from(
    {length: 23},
    (_, i) =>
      '## Unit ' +
      (i + 1).toString() +
      '\n\nSynthetic source ' +
      (i + 1).toString() +
      ' 😀 with **formatting**.\n\n',
  );
  const text = '# Synthetic reading\n\n' + parts.join('');
  const starts = parts.map(
    (part) => Array.from(text.slice(0, text.indexOf(part))).length,
  );
  starts[0] = 0;
  const entries = parts.map((part, i) => ({
    ...SYNTHETIC_ENTRY,
    entryId:
      '44444444-4444-4444-8444-' + (i + 100).toString().padStart(12, '0'),
    value: {
      ...SYNTHETIC_ENTRY.value,
      documentOrder: i,
      titlePath: 'Unit ' + (i + 1).toString(),
      body: part,
      splitRuleVersion: 'struinfo.entry-split.ai-group.v1',
      contentKeywords: [
        {
          displayValue: i === 22 ? 'Tail tag' : 'Shared tag',
          normalizedValue: i === 22 ? 'tail-tag' : 'shared-tag',
          origin: 'ai' as const,
          originVersion: 'synthetic',
        },
      ],
      fragmentRanges: [
        {
          startCodePoint: starts[i] ?? 0,
          endCodePoint: starts[i + 1] ?? Array.from(text).length,
        },
      ],
    },
  }));
  const relatedId = '33333333-3333-4333-8333-333333333339';
  const related = {
    ...SYNTHETIC_ENTRY,
    entryId: EXPLORATION_ENTRY_ID,
    snapshotId: relatedId,
    value: {
      ...SYNTHETIC_ENTRY.value,
      titlePath:
        'Synthetic related reading · 合成材料中的跨来源主题、实验条件与完整上下文阅读说明',
    },
  };
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 2,
        documents: [
          {...SYNTHETIC_DOCUMENT, entryCount: 23},
          {
            ...SYNTHETIC_DOCUMENT,
            snapshotId: relatedId,
            sourceKey: 'synthetic-related',
            entryCount: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/evidence/snapshots/*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        snapshot: {
          ...SYNTHETIC_SNAPSHOT,
          snapshotId: route.request().url().includes(relatedId)
            ? relatedId
            : SNAPSHOT_ID,
          structures: [
            {
              ...SYNTHETIC_SNAPSHOT.structures[0],
              normalizedText: text,
              fragments: [
                {
                  ...SYNTHETIC_SNAPSHOT.structures[0]?.fragments[0],
                  codePointRange: {start: 0, end: Array.from(text).length},
                  selectedText: text,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  let secondPageRead = false;
  await page.route('**/api/v1/entries/search', (route) => {
    const input = route.request().postDataJSON() as {
      snapshotId?: string;
      after?: unknown;
    };
    if (input.after) secondPageRead = true;
    const items =
      input.snapshotId === relatedId
        ? []
        : input.after
          ? entries.slice(20)
          : entries.slice(0, 20);
    return route.fulfill({
      json: {
        status: 'ok',
        querySha256: '0'.repeat(64),
        totalCount: 23,
        items: items.map((entry) => ({
          entry,
          matchReasons: [],
          filterReasons: [],
        })),
        ...(input.snapshotId === relatedId || input.after
          ? {}
          : {
              nextCursor: {
                version: 2,
                querySha256: '0'.repeat(64),
                documentOrder: 19,
              },
            }),
      },
    });
  });
  await page.route('**/api/v1/entries/*/associations*', (route) => {
    const entryId = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({
      json: {
        status: 'ok',
        entryId,
        totalCount: entryId === entries[22]?.entryId ? 1 : 0,
        associations:
          entryId === entries[22]?.entryId
            ? [
                {
                  relatedEntry: related,
                  effectiveScore: 0,
                  isBlocked: false,
                  override: {
                    value: {
                      graph: {
                        origin: 'ai',
                        label:
                          '两份合成材料讨论同一实验主题在不同条件下的变化，保留完整说明而不截成难以理解的小字',
                        note: 'Synthetic saved evidence for the relation.',
                        semanticKind: 'related',
                        verificationStatus: 'unreviewed',
                        direction: 'symmetric',
                      },
                    },
                  },
                },
                {
                  relatedEntry: {
                    ...related,
                    entryId: 'numbered',
                    value: {
                      ...related.value,
                      titlePath: '3、',
                      body: 'A literal synthetic excerpt makes the numbered entry readable.',
                    },
                  },
                  isBlocked: false,
                  override: {
                    value: {
                      graph: {
                        origin: 'ai',
                        label: 'shared SYN focus',
                        semanticKind: 'related',
                        verificationStatus: 'unreviewed',
                        note: 'Synthetic broad association reasoning.',
                      },
                    },
                  },
                },
                {
                  relatedEntry: {
                    ...related,
                    entryId: 'additional',
                    value: {
                      ...related.value,
                      titlePath: 'Additional synthetic reading',
                    },
                  },
                  isBlocked: false,
                  override: {
                    value: {
                      graph: {
                        origin: 'ai',
                        label: 'shared TEST focus',
                        semanticKind: 'related',
                        verificationStatus: 'unreviewed',
                      },
                    },
                  },
                },
                {
                  relatedEntry: {
                    ...related,
                    entryId: 'retired',
                    value: {...related.value, titlePath: 'Retired candidate'},
                  },
                  effectiveScore: 0,
                  isBlocked: false,
                },
                {
                  relatedEntry: {
                    ...related,
                    entryId: 'blocked',
                    value: {...related.value, titlePath: 'Blocked candidate'},
                  },
                  effectiveScore: 0,
                  isBlocked: true,
                  override: {value: {graph: {origin: 'ai', label: 'hidden'}}},
                },
              ]
            : [],
      },
    });
  });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  const source = page.getByRole('region', {name: '文档全文', exact: true});
  const header = page.getByRole('region', {
    name: '文首标签与联系',
    exact: true,
  });
  await expect(source.getByRole('separator')).toHaveCount(22);
  expect(secondPageRead).toBe(true);
  await expect(header).toContainText('Tail tag');
  await expect(header).not.toContainText('Retired candidate');
  await expect(header).not.toContainText('Blocked candidate');
  await expect(
    header.getByRole('button', {name: /Synthetic related reading/}),
  ).toBeVisible();
  expect(
    await header
      .locator('.document-tag')
      .first()
      .evaluate((element) => getComputedStyle(element).borderTopStyle),
  ).not.toBe('dashed');
  expect(
    await source
      .getByRole('separator')
      .first()
      .evaluate(
        (element) => getComputedStyle(element, '::before').borderTopStyle,
      ),
  ).toBe('dashed');
  await expect(
    source
      .locator('strong')
      .filter({hasText: /^formatting$/})
      .first(),
  ).toHaveText('formatting');
  await expect(header).toContainText(
    'A literal synthetic excerpt makes the numbered entry readable.',
  );
  await expect(header).toContainText('正文摘录');
  await expect(header).toContainText('共同关注：SYN');
  await expect(header).toContainText('宽泛关联');
  await expect(header).toContainText('尚未人工核查');
  const evidence = header.getByText('查看依据', {exact: true}).first();
  await evidence.focus();
  await page.keyboard.press('Enter');
  await expect(
    header.getByText('Synthetic saved evidence for the relation.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(evidence).toBeFocused();
  await expect(
    header.getByText('Synthetic saved evidence for the relation.', {
      exact: true,
    }),
  ).toBeHidden();
  await header.getByText('其余 1 条联系', {exact: true}).click();
  await expect(
    header.getByRole('button', {
      name: 'Additional synthetic reading',
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const title = header.locator('.document-relation-title').first();
    const metrics = await title.evaluate((element) => ({
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      whiteSpace: getComputedStyle(element).whiteSpace,
      clipped: element.scrollWidth > element.clientWidth + 1,
    }));
    expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
    expect(metrics.whiteSpace).toBe('normal');
    expect(metrics.clipped).toBe(false);
    expect(
      (await source.boundingBox())?.height,
      'reading height at ' + width.toString(),
    ).toBeGreaterThanOrEqual(160);
  }
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const theme of ['浅色', '深色']) {
    await page.emulateMedia({colorScheme: theme === '深色' ? 'dark' : 'light'});
    await page.screenshot({
      path: test.info().outputPath('source-boundaries-' + theme + '.png'),
      fullPage: true,
    });
  }
  await page.locator('.content-reading-main').evaluate((element) => {
    element.scrollTop = 400;
  });
  const scrolled = await page
    .locator('.content-reading-main')
    .evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(300);
  await page.getByRole('button', {name: '按条目 · 23', exact: true}).click();
  const entryBody = page.getByRole('region', {name: '原文正文', exact: true});
  await expect(
    page
      .getByRole('complementary', {name: '文档旁注'})
      .getByRole('region', {name: '文首标签与联系', exact: true}),
  ).toBeVisible();
  expect((await entryBody.boundingBox())?.height).toBeGreaterThanOrEqual(160);
  await page.getByRole('button', {name: '全文原文', exact: true}).click();
  expect(
    await page
      .locator('.content-reading-main')
      .evaluate((element) => element.scrollTop),
  ).toBe(scrolled);
  await page.locator('.content-reading-main').evaluate((element) => {
    element.scrollTop = 0;
  });
  await header.getByRole('button', {name: /Synthetic related reading/}).click();
  await expect(
    page.locator('.document-library-item[aria-pressed="true"]'),
  ).toContainText('synthetic-related');
  expect(errors).toEqual([]);
});

test('keeps oversized document titles compact with an accessible full-title popover', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        documents: [SYNTHETIC_DOCUMENT],
      },
    }),
  );
  const short = '【合成资料每日速递（01月01日）】';
  let full =
    short + ' 合成分类：1. 一段用于标题长度回归的无实际含义内容。'.repeat(35);
  await page.route('**/api/v1/evidence/snapshots/*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        snapshot: {
          ...SYNTHETIC_SNAPSHOT,
          structures: [
            {
              ...SYNTHETIC_SNAPSHOT.structures[0],
              normalizedText:
                '# ' +
                full +
                '\n\nSynthetic readable body.\n\n' +
                'Body paragraph.\n\n'.repeat(30),
              fragments: [
                {
                  ...SYNTHETIC_SNAPSHOT.structures[0]?.fragments[0],
                  nodeKind: 'heading',
                  selectedText: '# ' + full,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '资料库');
  const identity = page.locator('.document-paper__identity');
  await expect(identity.getByRole('heading', {level: 2})).toHaveText(short);
  const source = page.getByRole('region', {name: '文档全文', exact: true});
  const before = await source.boundingBox();
  const trigger = identity.getByRole('button', {name: '完整标题', exact: true});
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', {name: '完整标题', exact: true});
  await expect(panel).toBeVisible();
  await expect(panel.locator('.document-title__full')).toHaveText(full);
  expect(await source.boundingBox()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    const heading = identity.getByRole('heading', {level: 2});
    const size = await heading.evaluate((e) => ({
      height: e.clientHeight,
      line: parseFloat(getComputedStyle(e).lineHeight),
    }));
    expect(size.height).toBeLessThanOrEqual(size.line * 2 + 1);
    expect((await source.boundingBox())?.height).toBeGreaterThanOrEqual(250);
    await trigger.click();
    const box = await panel.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const theme of ['浅色', '深色']) {
    await page.emulateMedia({colorScheme: theme === '深色' ? 'dark' : 'light'});
    await page.screenshot({
      path: testInfo.outputPath('compact-document-title-' + theme + '.png'),
      fullPage: true,
    });
  }
  full =
    'A synthetic document heading with no briefing prefix and enough words to need a bounded preview. '.repeat(
      10,
    );
  await page.getByRole('button', {name: '刷新文档', exact: true}).click();
  await expect(identity.getByRole('heading', {level: 2})).toHaveText(
    Array.from(full).slice(0, 80).join('').trimEnd() + '…',
  );
  await trigger.click();
  await expect(panel.locator('.document-title__full')).toHaveText(full);
});

test('reviews subscription receipts in the inbox before adding them to the library', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const snapshots = Array.from({length: 23}, (_, index) => ({
    ...SYNTHETIC_SNAPSHOT,
    snapshotId:
      '12345678-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    sourceKey: '合成订阅资料 ' + String(index + 1).padStart(2, '0'),
    resourceKind: 'remote_document' as const,
  }));
  const records: IntakeRecord[] = snapshots.map((s, index) => ({
    snapshotId: s.snapshotId,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      reception: {channel: index === 2 || index === 3 ? 'history' : 'live'},
      receipt: 'pending',
      decision: 'pending',
      origin: 'system',
      reason: '',
      preparation: 'received',
    },
  }));
  let conflict = true,
    modelStarts = 0;
  const batches: number[] = [];
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots, totalCount: snapshots.length},
    }),
  );
  await page.route('**/api/v1/entry-documents*', (route) => {
    const documents = snapshots
      .filter(
        (s) =>
          records.find((r) => r.snapshotId === s.snapshotId)?.value.receipt ===
          'accepted',
      )
      .map((s) => ({...s, entryCount: 0, annotatedEntryCount: 0}));
    return route.fulfill({
      json: {status: 'ok', documents, totalCount: documents.length},
    });
  });
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        action: string;
        items: {snapshotId: string; expectedVersion: number}[];
      };
    };
    if (operation === 'intake_status')
      return route.fulfill({json: {result: {records}}});
    if (operation !== 'intake_receive') return route.fallback();
    batches.push(input.items.length);
    const saved: IntakeRecord[] = [],
      failed: {snapshotId: string; code: string}[] = [];
    for (const item of input.items) {
      const record = records.find((r) => r.snapshotId === item.snapshotId);
      if (!record) throw new Error('Synthetic receipt missing');
      if (conflict) {
        conflict = false;
        record.version++;
      }
      if (record.version !== item.expectedVersion) {
        failed.push({
          snapshotId: item.snapshotId,
          code: 'stale_intake_version',
        });
        continue;
      }
      record.value.receipt =
        input.action === 'accept'
          ? 'accepted'
          : input.action === 'reject'
            ? 'rejected'
            : 'pending';
      record.version++;
      saved.push(record);
    }
    await route.fulfill({json: {result: {records: saved, failed}}});
  });
  await page.route('**/api/v1/ai-tasks/commands', (route) => {
    if (
      (route.request().postDataJSON() as {operation: string}).operation ===
      'task_start'
    )
      modelStarts++;
    return route.fallback();
  });
  await page.goto('/');
  await openWorkspace(page, '收件箱');
  const list = page.locator('.intake-article-strip');
  const state = page.getByRole('combobox', {name: '接收状态', exact: true});
  await expect(list.locator('.intake-article-choice')).toHaveCount(20);
  const accept = page.getByRole('button', {
    name: '我已审核，接受并整理',
    exact: true,
  });
  await accept.click();
  await expect(page.locator('.journey-feedback')).toContainText('已完成 0 份');
  await expect(list.locator('.intake-article-choice')).toHaveCount(20);
  await accept.click();
  await expect(page.locator('.journey-feedback')).toContainText('已接受 1 份');
  expect(records[0]?.value.receipt).toBe('accepted');
  await list.getByRole('checkbox').first().check();
  await page.getByRole('button', {name: '拒绝所选', exact: true}).click();
  await expect
    .poll(() => records.filter((r) => r.value.receipt === 'rejected').length)
    .toBe(1);
  await state.selectOption('rejected');
  await expect(list.locator('.intake-article-choice')).toHaveCount(1);
  await page.getByRole('button', {name: '更多接收操作', exact: true}).click();
  await page.getByRole('button', {name: '恢复为待审', exact: true}).click();
  await state.selectOption('pending');
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(list.locator('.intake-article-choice')).toHaveCount(2);
  const channel = page.getByRole('combobox', {name: '接收渠道', exact: true});
  await channel.selectOption('history');
  await expect(list.locator('.intake-article-choice')).toHaveCount(2);
  const more = page.getByRole('button', {name: '更多接收操作', exact: true});
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  await page
    .getByRole('button', {
      name: '接受并整理当前来源全部待审（2）',
      exact: true,
    })
    .click();
  await expect(page.locator('.journey-feedback')).toContainText('已接受 2 份');
  expect(records.filter((r) => r.value.receipt === 'pending')).toHaveLength(20);
  await channel.selectOption('all');
  await expect(list.locator('.intake-article-choice')).toHaveCount(20);
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  await page
    .getByRole('button', {
      name: '接受并整理当前来源全部待审（20）',
      exact: true,
    })
    .click();
  await expect(page.locator('.journey-feedback')).toContainText('已接受 20 份');
  expect(batches).toEqual([1, 1, 1, 1, 2, 20]);
  expect(modelStarts).toBe(0);
  await state.selectOption('accepted');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({path: testInfo.outputPath('inbox-receipts.png')});
  await openWorkspace(page, '工作台');
  await page.getByRole('button', {name: /选择文档/}).click();
  await expect(page.locator('.document-library-list')).toContainText('23 份');
});

test('submits inbox receipts to the complete document pipeline and retains uncertain material', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const snapshots = [
    SYNTHETIC_SNAPSHOT,
    {
      ...SYNTHETIC_SNAPSHOT,
      snapshotId: '33333333-3333-4333-8333-333333333334',
      sourceKey: 'synthetic-review-uncertain',
    },
  ];
  const records: IntakeRecord[] = snapshots.map((s) => ({
    snapshotId: s.snapshotId,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      receipt: 'pending',
      decision: 'pending',
      origin: 'system',
      reason: '',
      preparation: 'received',
    },
  }));
  const tasks: AiTask[] = [];
  const started: {
    kind: string;
    expectedReceiptVersion: number;
    maxModelCalls: number;
    intake: unknown;
  }[] = [];
  const intake = {
    fetchFullText: false,
    blockedKinds: ['promotion'],
    preferredTopics: ['synthetic studies'],
    excludedTopics: [],
  };
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({json: {status: 'ok', snapshots, totalCount: 2}}),
  );
  await page.route('**/api/v1/entry-documents*', (route) => {
    const documents = snapshots
      .filter(
        (s) =>
          records.find((r) => r.snapshotId === s.snapshotId)?.value.receipt ===
          'accepted',
      )
      .map((s) => ({...s, entryCount: 0, annotatedEntryCount: 0}));
    return route.fulfill({
      json: {status: 'ok', documents, totalCount: documents.length},
    });
  });
  await page.route('**/api/v1/ingestion/commands', (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'intake_status')
      return route.fulfill({json: {result: {records}}});
    if (operation === 'ingestion_status')
      return route.fulfill({
        json: {
          result: {
            modelConfigured: true,
            items: [],
            policy: {
              revision: 1,
              settings: {
                enabled: false,
                paused: false,
                subscriptionIds: [],
                manualUploads: false,
                model: 'synthetic-model',
                maxEntries: 12,
                maxModelCalls: 12,
                maxDocumentsPerDay: 10,
                intake,
              },
            },
          },
        },
      });
    return route.fallback();
  });
  await page.route('**/api/v1/ai-tasks/commands', (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        request: {
          kind: string;
          snapshotId: string;
          expectedReceiptVersion: number;
          maxModelCalls: number;
          intake: unknown;
        };
        taskId: string;
        action: string;
      };
    };
    if (operation === 'tasks_list')
      return route.fulfill({json: {result: tasks}});
    if (operation === 'task_start') {
      started.push(input.request);
      const task: AiTask = {
        taskId: input.request.snapshotId,
        version: 1,
        actorKind: 'owner',
        model: 'synthetic-model',
        request: input.request,
        state: {
          status: 'paused',
          phase: 'intake',
          calls: 0,
          errorCode: 'ai_price_window_closed',
          steps: [
            {
              kind: 'intake',
              targetId: input.request.snapshotId,
              complete: false,
            },
          ],
        },
      };
      tasks.unshift(task);
      return route.fulfill({json: {result: task}});
    }
    if (operation === 'task_control') {
      const task = tasks.find((t) => t.taskId === input.taskId);
      const record = records.find(
        (r) => r.snapshotId === task?.request.snapshotId,
      );
      if (!task || !record) throw new Error('Synthetic receipt task missing');
      task.version++;
      task.pauseRequested = input.action === 'pause';
      if (input.action === 'resume') {
        const accepted = record.snapshotId === SNAPSHOT_ID;
        record.version++;
        record.value = {
          ...record.value,
          receipt: accepted ? 'accepted' : 'pending',
          decision: accepted ? 'admitted' : 'held',
          origin: 'model',
          reason: accepted
            ? 'Synthetic complete research.'
            : 'Synthetic context is incomplete.',
          ...(accepted ? {receiptOrigin: 'model', deferProcessing: false} : {}),
        };
        task.state = {
          status: accepted ? 'succeeded' : 'paused',
          phase: accepted ? 'complete' : 'intake',
          ...(!accepted ? {errorCode: 'intake_held'} : {}),
          calls: 1,
          steps: [
            {
              kind: 'intake',
              complete: true,
              outcome: accepted ? 'accepted' : 'held',
            },
          ],
        };
      }
      return route.fulfill({json: {result: task}});
    }
    return route.fallback();
  });
  await page.goto('/');
  await openWorkspace(page, '收件箱');
  const list = page.locator('.intake-article-strip');
  const ai = page.getByRole('button', {
    name: '交给 AI 审核并整理',
    exact: true,
  });
  await expect(ai).toBeEnabled();
  await list.getByRole('checkbox').nth(0).check();
  await list.getByRole('checkbox').nth(1).check();
  await ai.click();
  await expect(page.locator('.intake-ai-status')).toContainText(
    'AI 审核等待低价时段',
  );
  expect(started).toHaveLength(2);
  expect(
    started.every(
      (r) =>
        r.kind === 'document' &&
        r.expectedReceiptVersion === 1 &&
        r.maxModelCalls === 12,
    ),
  ).toBe(true);
  expect(started[0]?.intake).toEqual(intake);
  expect(records.every((r) => r.value.receipt === 'pending')).toBe(true);
  await page.screenshot({path: testInfo.outputPath('inbox-ai-review.png')});
  await openReceiptDetails(page);
  await page.getByRole('button', {name: '继续接收审核', exact: true}).click();
  await expect(
    page.getByRole('region', {name: 'AI 接收审核任务'}),
  ).toContainText('已入库');
  await page.getByRole('button', {name: '返回待审文章'}).click();
  await expect(list.locator('.intake-article-choice')).toHaveCount(1);
  await openReceiptDetails(page);
  await page.getByRole('button', {name: '继续接收审核', exact: true}).click();
  await expect(
    page.getByRole('region', {name: 'AI 接收审核任务'}),
  ).toContainText('AI 暂缓');
  await page.getByRole('button', {name: '返回待审文章'}).click();
  await expect(page.locator('.intake-held-reason')).toContainText(
    'Synthetic context is incomplete.',
  );
  await page
    .getByRole('combobox', {name: '接收状态', exact: true})
    .selectOption('accepted');
  await expect(page.locator('.intake-ai-status')).toContainText('已入库');
  await expect(ai).toBeDisabled();
  await openWorkspace(page, '工作台');
  await page.getByRole('button', {name: /选择文档/}).click();
  await expect(page.locator('.document-library-list')).toContainText('1 份');
  expect(started).toHaveLength(2);
  expect(
    records.find((r) => r.snapshotId === SNAPSHOT_ID)?.value.deferProcessing,
  ).toBe(false);
});

test('routes AI decisions to current inbox holds and makes permission distinct from starting work', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const snapshots = [
    '待接受合成简报',
    '整理暂缓合成文档',
    '失败合成文档',
    '已拒绝合成资料',
  ].map((title, index) => ({
    ...SYNTHETIC_SNAPSHOT,
    snapshotId: '33333333-3333-4333-8333-33333333333' + String(index + 3),
    sourceKey: title,
  }));
  const records: IntakeRecord[] = snapshots.map((s, index) => ({
    snapshotId: s.snapshotId,
    version: 1,
    updatedAt: '2040-01-02T00:00:00Z',
    value: {
      receipt: index === 0 ? 'pending' : index === 3 ? 'rejected' : 'accepted',
      decision: index === 2 ? 'admitted' : 'held',
      origin: 'model',
      reason: '合成审核原因：请核对上下文。',
      preparation: 'received',
    },
  }));
  const tasks: AiTask[] = snapshots.slice(0, 3).map((s, index) => ({
    taskId: s.snapshotId,
    version: 1,
    model: 'synthetic-model',
    actorKind: 'owner',
    updatedAt: '2040-01-02T00:00:00Z',
    request: {
      kind: index === 0 ? 'intake' : 'document',
      snapshotId: s.snapshotId,
    },
    state:
      index === 0
        ? {
            status: 'succeeded',
            phase: 'complete',
            calls: 1,
            steps: [{kind: 'intake', complete: true, outcome: 'held'}],
          }
        : {
            workflow: 'confirmed-content-v1',
            status: index === 1 ? 'paused' : 'failed',
            phase: index === 1 ? 'intake' : 'tags',
            calls: 1,
            steps: [],
            errorCode:
              index === 1 ? 'intake_held' : 'ai_provider_invalid_response',
          },
    runtimeStatus: 'idle',
  }));
  const price = {
    policy: {revision: 4, enabled: true, operationsAllowed: true},
    rule: 'synthetic',
    timeZone: 'Asia/Shanghai',
    provider: 'synthetic',
    applicable: true,
    peak: false,
    blocked: false,
    checkedAt: '2040-01-02T00:00:00Z',
    nextAllowedAt: null,
  };
  const operations: string[] = [];
  let conflict = true;
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots, totalCount: snapshots.length},
    }),
  );
  await page.route('**/api/v1/ai-price/commands', (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {revision: number; operationsAllowed: boolean};
    };
    if (operation !== 'ai_operations_save')
      return route.fulfill({json: {result: price}});
    operations.push(operation);
    expect(input.revision).toBe(price.policy.revision);
    if (input.operationsAllowed && conflict) {
      conflict = false;
      return route.fulfill({
        status: 409,
        json: {error: {code: 'ai_price_policy_conflict'}},
      });
    }
    price.policy = {
      ...price.policy,
      revision: price.policy.revision + 1,
      operationsAllowed: input.operationsAllowed,
    };
    return route.fulfill({json: {result: price}});
  });
  await page.route('**/api/v1/ai-tasks/commands', (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'system_status')
      return route.fulfill({
        json: {
          result: {
            role: 'all',
            agentEnabled: false,
            grants: [],
            model: 'synthetic-model',
            aiPrice: price,
          },
        },
      });
    if (operation === 'document_queue_status') return route.fallback();
    if (operation === 'tasks_list')
      return route.fulfill({json: {result: tasks}});
    operations.push(operation);
    return route.fallback();
  });
  await page.route('**/api/v1/ingestion/commands', (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        action: string;
        snapshotId: string;
        expectedVersion: number;
        items: {snapshotId: string; expectedVersion: number}[];
      };
    };
    if (operation === 'intake_status')
      return route.fulfill({json: {result: {records}}});
    if (operation === 'intake_receive') {
      operations.push(operation);
      const changed = input.items.map((item) => {
        const record = records.find((r) => r.snapshotId === item.snapshotId);
        if (!record) throw new Error('missing synthetic receipt');
        expect(record.version).toBe(item.expectedVersion);
        record.version++;
        record.value.receipt =
          input.action === 'accept' ? 'accepted' : 'rejected';
        record.value.receiptOrigin = 'manual';
        if (input.action === 'accept') {
          record.value.decision = 'admitted';
          record.value.origin = 'manual';
        }
        return record;
      });
      return route.fulfill({json: {result: {records: changed, failed: []}}});
    }
    if (operation === 'intake_control') {
      operations.push(operation);
      const record = records.find((r) => r.snapshotId === input.snapshotId);
      if (!record) throw new Error('missing synthetic review');
      expect(record.version).toBe(input.expectedVersion);
      record.version++;
      record.value.decision = input.action === 'admit' ? 'admitted' : 'blocked';
      record.value.origin = 'manual';
      return route.fulfill({json: {result: record}});
    }
    return route.fallback();
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  const queue = page.getByRole('region', {name: '任务队列'});
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  const jump = queue.getByRole('button', {name: '待接受合成简报', exact: true});
  await expect(jump).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('switch', {name: '允许 AI 操作', exact: true}).click();
  await expect(
    page.getByRole('switch', {name: '允许 AI 操作', exact: true}),
  ).toBeVisible();
  await page.getByRole('switch', {name: '允许 AI 操作', exact: true}).click();
  await expect(page.locator('.control-panel [role="alert"]')).toBeVisible();
  await page.getByRole('switch', {name: '允许 AI 操作', exact: true}).click();
  await expect(
    page.getByRole('switch', {name: '允许 AI 操作', exact: true}),
  ).toBeVisible();
  await expect(page.locator('.control-panel .panel-heading')).not.toContainText(
    'synthetic-model',
  );
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  await expect(queue).toContainText('从断点继续');
  await expect(queue).toContainText('模型请求并发上限 1');
  expect(operations).toEqual([
    'ai_operations_save',
    'ai_operations_save',
    'ai_operations_save',
  ]);
  await queue.getByRole('button', {name: '失败合成文档', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '文档阅读', exact: true}),
  ).toBeVisible();
  await openWorkspace(page, '总览');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  const list = page.locator('.intake-article-strip');
  await jump.click();
  await expect(
    page.getByRole('combobox', {name: '接收状态', exact: true}),
  ).toHaveValue('all');
  await expect(page.locator('.intake-document-meta')).toContainText(
    '待接受合成简报',
  );
  await page
    .getByRole('combobox', {name: '接收状态', exact: true})
    .selectOption('review');
  await expect(list.locator('.intake-article-choice')).toHaveCount(2);
  await expect(page.locator('.intake-held-reason')).toBeVisible();
  await expect(list).not.toContainText('已拒绝合成资料');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({colorScheme: theme === 'dark' ? 'dark' : 'light'});
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 900});
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await page.screenshot({
      path: testInfo.outputPath('manual-review-' + theme + '.png'),
    });
  }
  await page
    .getByRole('button', {name: '我已审核，接受并整理', exact: true})
    .click();

  await expect(list.locator('.intake-article-choice')).toHaveCount(1);
  await openWorkspace(page, '总览');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  await page
    .locator('.ai-task-queue')
    .getByRole('button', {name: '整理暂缓合成文档', exact: true})
    .click();
  await expect(page.locator('.intake-document-meta')).toContainText(
    '整理暂缓合成文档',
  );
  await page.getByRole('button', {name: '拒绝', exact: true}).click();
  await openWorkspace(page, '总览');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  await expect(queue).not.toContainText('待你决定');
  expect(
    operations.filter((op) => op === 'task_start' || op === 'task_control'),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('overview-resolved-holds.png'),
  });
});

test('inbox previews show sources and generate summaries only on explicit owner action', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const ids = [
    '12345678-0000-4000-8000-000000000091',
    '12345678-0000-4000-8000-000000000092',
  ];
  const snapshots = ids.map((snapshotId, index) => ({
    ...SYNTHETIC_SNAPSHOT,
    snapshotId,
    sourceKey: `Synthetic inbox ${index.toString()}`,
    resourceKind: 'remote_document' as const,
  }));
  const records = snapshots.map((s) => ({
    snapshotId: s.snapshotId,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      receipt: 'pending',
      decision: 'pending',
      origin: 'system',
      reason: '',
      preparation: 'received',
    },
  }));
  const summaries = new Map<
    string,
    {text: string; model: string; promptVersion: string; createdAt: string}
  >();
  let calls = 0,
    decisions = 0,
    priceClosed = false;
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({json: {status: 'ok', snapshots, totalCount: 2}}),
  );
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {snapshotId: string; snapshotIds: string[]};
    };
    if (operation === 'intake_status')
      return route.fulfill({json: {result: {records}}});
    if (operation === 'ingestion_status')
      return route.fulfill({
        json: {
          result: {modelConfigured: true, policy: {settings: {}}, items: []},
        },
      });
    if (operation === 'intake_receive') {
      decisions++;
      return route.fallback();
    }
    if (operation === 'intake_previews')
      return route.fulfill({
        json: {
          result: {
            previews: input.snapshotIds.map((snapshotId) => ({
              snapshotId,
              title:
                snapshotId === ids[0]
                  ? '合成研究：完整标题'
                  : '合成资料：第二篇',
              excerpt: '这是一段来自已接收正文的合成阅读预览。',
              source: {
                name: '合成科学期刊',
                kind: 'rss_atom',
                host: 'example.invalid',
              },
              ...(summaries.has(snapshotId)
                ? {summary: summaries.get(snapshotId)}
                : {}),
            })),
            failed: [],
          },
        },
      });
    if (operation === 'intake_summarize') {
      if (priceClosed)
        return route.fulfill({
          status: 400,
          json: {error: {code: 'ai_price_window_closed'}},
        });
      if (!summaries.has(input.snapshotId)) {
        calls++;
        summaries.set(input.snapshotId, {
          text: '这份合成材料说明一种机制，并描述其适用条件与限制。',
          model: 'synthetic-model',
          promptVersion: 'struinfo.inbox-summary.v1',
          createdAt: '2040-01-01T00:00:00Z',
        });
      }
      return route.fulfill({json: {result: summaries.get(input.snapshotId)}});
    }
    return route.fallback();
  });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '收件箱');

  const list = page.locator('.intake-article-strip');
  const meta = page.locator('.intake-document-meta');
  await expect(list).toContainText('合成研究：完整标题');
  await expect(meta).toContainText('合成科学期刊');
  const menu = page.getByRole('button', {name: '摘要设置', exact: true});
  await menu.click();
  const toggle = page.getByRole('checkbox', {
    name: '启用按需 AI 摘要',
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  expect(calls).toBe(0);
  await toggle.check();
  expect(calls).toBe(0);
  await page.getByRole('button', {name: '生成本篇摘要', exact: true}).click();
  await expect(meta.locator('.intake-summary')).toBeVisible();
  expect(calls).toBe(1);
  expect(decisions).toBe(0);
  await list.locator('.intake-article-choice button').nth(1).click();
  priceClosed = true;
  await menu.click();
  await page.getByRole('button', {name: '生成本篇摘要', exact: true}).click();
  await expect(page.locator('.journey-feedback')).toContainText(
    '当前为高价时段',
  );
  expect(calls).toBe(1);
  priceClosed = false;
  await list.getByRole('checkbox').nth(0).check();
  await list.getByRole('checkbox').nth(1).check();
  await menu.click();
  await page.getByRole('button', {name: '生成所选摘要', exact: true}).click();
  await expect(meta.locator('.intake-summary')).toBeVisible();
  expect(calls).toBe(2);
  expect(decisions).toBe(0);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  for (const theme of ['浅色', '深色']) {
    await page.emulateMedia({colorScheme: theme === '深色' ? 'dark' : 'light'});
    await page.screenshot({
      path: testInfo.outputPath('inbox-summary-' + theme + '.png'),
      fullPage: true,
    });
  }
  await toggle.uncheck();
  await page.reload();
  await openWorkspace(page, '收件箱');
  await menu.click();
  await expect(toggle).not.toBeChecked();
  expect(calls).toBe(2);
});

async function installJourneyApi(
  page: Page,
  manualSplitRequests: string[] = [],
) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await installCurrentProductApi(page, {manualSplitRequests});
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: [
          'manual-core',
          'processing_runs',
          'source_subscriptions',
          'ai_query_synthesis',
          'ai_entry_translation',
        ],
      },
    }),
  );
  const sourceId = '99999999-9999-4999-8999-999999999999';
  const text =
    '# 合成资料的完整上下文\n\n第一段说明一个完整问题与背景。\n\n第二段给出论据与限制。\n\n第三段保留原文结论。';
  const snapshot = {
    ...SYNTHETIC_SNAPSHOT,
    structures: [
      {
        ...SYNTHETIC_SNAPSHOT.structures[0],
        normalizedText: text,
        fragments: [
          {
            ...SYNTHETIC_SNAPSHOT.structures[0]?.fragments[0],
            nodeKind: 'section',
            selectedText: text,
            codePointRange: {start: 0, end: Array.from(text).length},
          },
        ],
      },
    ],
  };
  let receipt: IntakeRecord = {
    snapshotId: SNAPSHOT_ID,
    version: 1,
    updatedAt: '2040-01-01T00:00:00Z',
    value: {
      receipt: 'pending',
      decision: 'held',
      origin: 'model',
      reason: '合成材料需要核对上下文',
      preparation: 'received',
    },
  };
  const mutations: {operation: string; input: unknown}[] = [];
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots: [SYNTHETIC_DOCUMENT], totalCount: 1},
    }),
  );
  await page.route('**/api/v1/evidence/snapshots/*', (route) =>
    route.fulfill({json: {status: 'ok', snapshot}}),
  );
  await page.route('**/api/v1/source-subscriptions', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        revision: 1,
        connectors: [],
        subscriptions: [
          {
            subscriptionId: sourceId,
            label: '合成研究通讯',
            description: '解释研究方法、实验结果及其限制。',
            kind: 'rss_atom',
            sourceAlias: 'synthetic-research',
            feedUrl: 'https://example.invalid/rss',
            itemLimit: 5,
            enabled: true,
            isPrivate: false,
            intervalMinutes: 60,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/reports/commands', (route) =>
    route.fulfill({json: {result: {reports: [], model: null}}}),
  );
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const command = route.request().postDataJSON() as {
      operation: string;
      input: Record<string, unknown>;
    };
    let result: unknown = {};
    if (command.operation === 'intake_status') result = {records: [receipt]};
    else if (command.operation === 'intake_origins')
      result = {
        origins: [
          {
            snapshotId: SNAPSHOT_ID,
            subscriptionId: sourceId,
            kind: 'subscription',
          },
        ],
      };
    else if (command.operation === 'intake_previews')
      result = {
        previews: [
          {
            snapshotId: SNAPSHOT_ID,
            title: '合成资料的完整上下文',
            excerpt: '合成材料解释一个完整问题。',
            source: {
              name: '合成研究通讯',
              kind: 'rss_atom',
              host: 'example.invalid',
            },
          },
        ],
        failed: [],
      };
    else if (command.operation === 'intake_receive') {
      mutations.push(command);
      receipt = {
        ...receipt,
        version: receipt.version + 1,
        value: {
          ...receipt.value,
          receipt:
            command.input.action === 'accept'
              ? 'accepted'
              : command.input.action === 'reject'
                ? 'rejected'
                : 'pending',
          receiptOrigin: 'manual',
        },
      };
      result = {records: [receipt], failed: []};
    } else if (command.operation === 'ingestion_status')
      result = {
        modelConfigured: false,
        policy: {
          revision: 0,
          settings: {
            enabled: false,
            paused: false,
            subscriptionIds: [],
            manualUploads: false,
            model: '',
            maxEntries: 12,
            maxModelCalls: 24,
            maxDocumentsPerDay: 10,
          },
        },
        items: [],
      };
    else if (command.operation === 'subscriptions_list') result = [];
    else if (command.operation === 'system_status')
      result = {role: 'all', agentEnabled: false, grants: []};
    await route.fulfill({json: {result}});
  });
  return {mutations, snapshot};
}

test('preserves the workspace on reload and opens new visits at overview', async ({
  page,
  context,
}) => {
  await installCurrentProductApi(page);
  await page.goto('/');
  const shell = page.locator('.product-shell');
  await expect(shell).toHaveAttribute('data-section', 'overview');
  for (const [label, section] of [
    ['源管理', 'import'],
    ['文档阅读', 'documents'],
    ['数据库', 'query'],
    ['设置', 'settings'],
  ] as const) {
    await page.getByRole('button', {name: label, exact: true}).click();
    await expect(shell).toHaveAttribute('data-section', section);
    await page.reload();
    await expect(shell).toHaveAttribute('data-section', section);
  }
  await page.goto('/');
  await expect(shell).toHaveAttribute('data-section', 'overview');
  await openWorkspace(page, '工作台');
  const reopened = await context.newPage();
  await installCurrentProductApi(reopened);
  await reopened.goto('/');
  await expect(reopened.locator('.product-shell')).toHaveAttribute(
    'data-section',
    'overview',
  );
  await reopened.close();
});

test('journey: inline splitting stays a draft until explicit confirmation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  const requests: string[] = [];
  const {snapshot} = await installJourneyApi(page, requests);
  await page.goto('/');
  await openWorkspace(page, '工作台');
  await openDocumentEditor(page);
  await expect(
    page.getByRole('button', {name: '修改分段', exact: true}),
  ).toBeEnabled();
  await page.getByRole('button', {name: '修改分段', exact: true}).click();
  await expect(page.locator('.inline-structure-body')).toContainText(
    '第三段保留原文结论',
  );
  await page
    .getByRole('button', {name: '＋ 在这里分段', exact: true})
    .first()
    .click();
  expect(requests).toHaveLength(0);
  await expect(page.getByText('分段草稿 · 2 条')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('03-inline-split.png'),
    fullPage: true,
  });
  await page.getByRole('button', {name: '确认分段并入库', exact: true}).click();
  await expect.poll(() => requests.length).toBe(1);
  const saved = JSON.parse(requests[0] ?? '{}') as {
    groups: {fragments: {startCodePoint: number; endCodePoint: number}[]}[];
  };
  expect(saved.groups).toHaveLength(2);
  expect(
    saved.groups
      .flatMap((g) => g.fragments)
      .reduce((n, p) => n + p.endCodePoint - p.startCodePoint, 0),
  ).toBe(Array.from(snapshot.structures[0]?.normalizedText ?? '').length);
});

test('journey: data reading exposes search and cited answers in the same workspace', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await installJourneyApi(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/v1/research/commands', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.operation !== 'research_answer') return route.fallback();
    requests.push(request.input as Record<string, unknown>);
    const failure = [
      'ai_provider_incomplete_response',
      'ai_query_invalid_citations',
    ][requests.length - 1];
    if (failure) {
      await route.fulfill({
        status: 502,
        json: {error: {code: failure}},
      });
      return;
    }
    await route.fulfill({
      json: {
        result: {
          status: 'ok',
          requestId: request.requestId,
          querySha256: 'a'.repeat(64),
          providerKey: 'synthetic',
          model: 'synthetic-model',
          promptVersion: 'synthetic-v1',
          answer:
            '合成资料说明了方法及其适用条件。\n\n1. 适用条件明确。\n2. 缺少长期结果。',
          evidenceStatus: 'supported',
          claims: [{statement: '方法有明确边界。', evidenceRefs: ['E01']}],
          limitations: ['材料不包含长期结果。'],
          evidence: [
            {
              handle: 'E01',
              entryId: ENTRY_ID,
              entryRevision: 1,
              snapshotId: SNAPSHOT_ID,
              fragmentIds: [FRAGMENT_ID],
              titlePath: '合成资料的完整上下文',
              excerpt: '完整问题与背景',
              truncated: false,
              contentKeywords: [],
              domains: [],
            },
          ],
        },
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '查询');
  await expect(page.locator('.entry-result-list')).toContainText(
    SYNTHETIC_ENTRY.value.titlePath,
  );
  await page.getByRole('button', {name: 'AI 提问', exact: true}).click();
  await page
    .getByRole('searchbox', {name: '关键词或问题'})
    .fill('这些材料介绍的方法有什么限制？');
  for (const message of ['AI 回答尚未完整生成', 'AI 回答缺少有效引用']) {
    await page
      .getByRole('search')
      .getByRole('button', {name: '提问', exact: true})
      .click();
    await expect(
      page.locator('.database-research-results').getByRole('alert'),
    ).toContainText(message);
  }
  await page
    .getByRole('search')
    .getByRole('button', {name: '提问', exact: true})
    .click();
  await expect(page.locator('.research-answer')).toHaveText(
    '合成资料说明了方法及其适用条件。\n\n1. 适用条件明确。\n2. 缺少长期结果。',
  );
  expect(requests[0]).toMatchObject({
    mode: 'local',
    question: '这些材料介绍的方法有什么限制？',
    query: {includePrivate: false},
  });
  expect(new Set(requests.map((r) => r.requestKey)).size).toBe(1);
  await page.screenshot({path: testInfo.outputPath('p8-question.png')});
  await page.getByRole('button', {name: '查看条目', exact: true}).click();
  await expect(page.locator('.entry-readonly-detail')).toContainText(
    SYNTHETIC_ENTRY.value.body,
  );
});

test('journey: every workspace fits narrow and wide viewports with local scrolling', async ({
  page,
}, testInfo) => {
  await installJourneyApi(page, []);
  await page.goto('/');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    for (const name of ['源管理', '文档阅读', '数据库', '设置']) {
      await page.getByRole('button', {name, exact: true}).click();
      if ([320, 768, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(name + '-' + String(width) + '.png'),
        });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 1) {
        console.log(
          JSON.stringify(
            await page.evaluate(() =>
              Array.from(document.querySelectorAll('body *'))
                .filter((e) => {
                  const b = e.getBoundingClientRect();
                  return (
                    b.width > 0 &&
                    (b.right > window.innerWidth + 1 || b.left < -1)
                  );
                })
                .slice(0, 15)
                .map((e) => ({
                  node: e.tagName,
                  classes: e.className,
                  width: e.getBoundingClientRect().width,
                  right: e.getBoundingClientRect().right,
                })),
            ),
          ),
        );
        await page.screenshot({
          path: testInfo.outputPath(
            'overflow-' + name + '-' + String(width) + '.png',
          ),
          fullPage: true,
        });
      }
      expect(overflow, name + ' at ' + String(width)).toBeLessThanOrEqual(1);
    }
  }
});

test('journey: temporary intake translation shows local progress without accepting or changing evidence', async ({
  page,
}) => {
  const fixture = await installJourneyApi(page);
  const gate = controlledGate();
  let translations = 0;
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {snapshotId: string};
    };
    if (operation === 'ingestion_status')
      return route.fulfill({
        json: {
          result: {
            modelConfigured: true,
            policy: {
              revision: 0,
              settings: {
                enabled: false,
                paused: false,
                subscriptionIds: [],
                manualUploads: false,
                model: 'synthetic',
                maxEntries: 12,
                maxModelCalls: 24,
                maxDocumentsPerDay: 10,
              },
            },
            items: [],
          },
        },
      });
    if (operation === 'intake_translate') {
      expect(input.snapshotId).toBe(SNAPSHOT_ID);
      translations++;
      await gate.promise;
      return route.fulfill({
        json: {
          result: {
            title: '临时合成译文',
            body: '这是一份仅用于当前阅读的合成译文。',
          },
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/');
  await openWorkspace(page, '文档入口');
  await page.getByRole('button', {name: 'AI 临时翻译', exact: true}).click();
  await expect(
    page.getByRole('button', {name: '正在翻译…', exact: true}),
  ).toBeDisabled();
  await expect(
    page.locator('.primary-navigation .ai-flow-overlay'),
  ).toHaveCount(0);
  gate.release();
  await expect(
    page.getByRole('region', {name: '待审文档临时译文'}),
  ).toContainText('这是一份仅用于当前阅读的合成译文。');
  await expect(
    page.getByRole('button', {name: '查看原文', exact: true}),
  ).toBeEnabled();
  expect(fixture.mutations).toHaveLength(0);
  expect(translations).toBe(1);
  await page.getByRole('button', {name: '查看原文', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '待审核文档全文'}),
  ).toContainText('第一段说明一个完整问题与背景。');
  expect(translations).toBe(1);
  expect(fixture.mutations).toHaveLength(0);
});

test('batch document controls preserve checkpoints and expose cancellation without a model', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const queueItems = [
    {
      snapshotId: SNAPSHOT_ID,
      taskId: ENTRY_ID,
      expectedVersion: 2,
      title: '合成：格式错误的资料',
      action: 'resume',
      taskStatus: 'failed',
      errorCode: 'ai_provider_invalid_response',
    },
    {
      snapshotId: SNAPSHOT_ID,
      taskId: ENTRY_ID,
      expectedVersion: 2,
      title: '合成：格式错误的资料',
      action: 'cancel',
      taskStatus: 'failed',
      errorCode: 'ai_provider_invalid_response',
    },
    {
      snapshotId: RESOURCE_ID,
      taskId: REVISION_ID,
      expectedVersion: 4,
      title: 'synthetic-feed#0123456789abcdef01234567',
      canonicalUri: 'https://example.test/synthetic-long-article',
      action: 'cancel',
      taskStatus: 'failed',
      errorCode: 'ai_split_input_unsupported',
    },
    {
      snapshotId: STRUCTURE_ID,
      taskId: NODE_ID,
      expectedVersion: 1,
      title: '合成：等待核对的文档',
      action: 'cancel',
      taskStatus: 'paused',
      errorCode: 'intake_held',
    },
  ];
  const writes: {
    action: string;
    items: {snapshotId: string; taskId: string; expectedVersion: number}[];
  }[] = [];
  let model = true;
  let queueReads = 0;
  let runtimeReads = 0;
  await page.route('**/api/v1/ai-tasks/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: (typeof writes)[number];
    };
    if (operation === 'system_status') {
      runtimeReads++;
      return route.fulfill({
        json: {
          result: {
            role: 'all',
            agentEnabled: false,
            grants: [],
            ...(model ? {model: 'synthetic-model'} : {}),
          },
        },
      });
    }
    if (operation === 'document_queue_status') {
      queueReads++;
      return route.fulfill({
        json: {
          result: {items: queueItems, held: 2, duplicates: 0, batchLimit: 32},
        },
      });
    }
    if (operation === 'document_queue_apply') {
      writes.push(input);
      return route.fulfill({
        json: {
          result:
            input.action === 'cancel'
              ? {
                  queued: [],
                  cancelled: [input.items[0]],
                  failed: [
                    {snapshotId: RESOURCE_ID, code: 'stale_task_version'},
                  ],
                }
              : {queued: input.items, cancelled: [], failed: []},
        },
      });
    }
    return route.fallback();
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  const resume = page.getByRole('button', {
    name: '批量从断点继续（1）',
    exact: true,
  });
  await expect(resume).toBeEnabled();
  await resume.click();
  const dialog = page.locator('.document-queue-dialog');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(
    dialog.getByText('从上次进度继续，使用剩余额度。', {exact: false}),
  ).toBeVisible();
  await dialog
    .getByRole('button', {name: '确认批量从断点继续（1）', exact: true})
    .click();
  expect(writes[0]).toEqual({
    action: 'resume',
    items: [{snapshotId: SNAPSHOT_ID, taskId: ENTRY_ID, expectedVersion: 2}],
  });
  await expect(
    page.getByText('已加入队列 1 篇。按现有许可和价格时段执行。', {
      exact: true,
    }),
  ).toBeVisible();
  model = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(resume).toBeDisabled();
  const cancel = page.getByRole('button', {
    name: '批量取消任务（3）',
    exact: true,
  });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  await expect(
    dialog.getByText('synthetic long article · example.test', {exact: true}),
  ).toBeVisible();
  await expect(dialog).not.toContainText('0123456789abcdef');
  await expect(dialog.getByRole('checkbox', {checked: true})).toHaveCount(0);
  await expect(
    dialog.getByRole('button', {name: '确认取消所选（0）'}),
  ).toBeDisabled();
  await dialog.getByRole('button', {name: '仅选失败任务', exact: true}).click();
  await expect(dialog.getByRole('checkbox', {checked: true})).toHaveCount(2);
  // Background status refresh must not silently replace the versions the owner reviewed.
  const beforeRefresh = runtimeReads;
  const frozenQueueReads = queueReads;
  const changingItem = queueItems[1];
  if (!changingItem) throw new Error('Missing synthetic task');
  changingItem.expectedVersion = 3;
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect.poll(() => runtimeReads).toBeGreaterThan(beforeRefresh);
  expect(queueReads).toBe(frozenQueueReads);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Dialog has no layout');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await expect(
      dialog.getByRole('button', {name: '确认取消所选（2）'}),
    ).toBeInViewport();
    await expect(
      dialog.getByRole('button', {name: '返回队列', exact: true}),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath('batch-cancel-desktop.png'),
  });
  await page.setViewportSize({width: 390, height: 900});
  await page.screenshot({
    path: test.info().outputPath('batch-cancel-mobile.png'),
  });
  await dialog.getByRole('button', {name: '确认取消所选（2）'}).click();
  expect(writes[1]).toEqual({
    action: 'cancel',
    items: [
      {snapshotId: SNAPSHOT_ID, taskId: ENTRY_ID, expectedVersion: 2},
      {snapshotId: RESOURCE_ID, taskId: REVISION_ID, expectedVersion: 4},
    ],
  });
  await expect(
    page.getByText(/已请求取消 1 篇；未成功 1 篇：任务已更新/u),
  ).toBeVisible();
  await cancel.click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', {name: '展开任务队列', exact: true}),
  ).toBeFocused();
  expect(writes).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('batch controls recover from unavailable queue reads and keep an empty queue inactive', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  const gate = controlledGate();
  let reads = 0;
  let writes = 0;
  await page.route('**/api/v1/ai-tasks/commands', async (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'document_queue_apply') writes++;
    if (operation !== 'document_queue_status') return route.fallback();
    reads++;
    if (reads === 1) {
      await gate.promise;
      return route.fulfill({status: 503, json: {code: 'ai_operation_failed'}});
    }
    return route.fulfill({
      json: {result: {items: [], held: 0, duplicates: 0, batchLimit: 32}},
    });
  });
  await page.goto('/');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  const controls = page.locator('.document-queue-controls');
  await expect(
    controls.getByRole('button', {name: '批量取消任务', exact: true}),
  ).toBeDisabled();
  gate.release();
  await expect(controls.getByRole('alert')).toBeVisible();
  await controls.getByRole('button', {name: '重新读取', exact: true}).click();
  await expect(controls.getByRole('alert')).toHaveCount(0);
  await expect(
    controls.getByRole('button', {name: '批量取消任务（0）', exact: true}),
  ).toBeDisabled();
  await expect(
    controls.getByRole('button', {name: '批量从断点继续（0）', exact: true}),
  ).toBeDisabled();
  expect(writes).toBe(0);
});

test('backfills selected publication dates across sources with previews and no AI activation', async ({
  page,
}) => {
  await installJourneyApi(page);
  const sourceIds = [
    '11111111-1111-4111-8111-111111111112',
    '11111111-1111-4111-8111-111111111113',
  ];
  const sources = sourceIds.map((subscriptionId, i) => ({
    subscriptionId,
    label: '合成历史来源 ' + String(i + 1),
    kind: 'rss_atom',
    sourceAlias: 'synthetic-history',
    feedUrl: 'https://example.invalid/feed',
    itemLimit: 5,
    enabled: false,
    isPrivate: false,
    intervalMinutes: 60,
  }));
  await page.route('**/api/v1/source-subscriptions', (route) =>
    route.fulfill({
      json: {status: 'ok', revision: 1, connectors: [], subscriptions: sources},
    }),
  );
  const articles = [
    {
      id: 'a'.repeat(64),
      subscriptionId: sourceIds[0],
      title: '合成的过去文章甲',
      publishedAt: '2024-01-02T00:00:00Z',
      access: 'public',
      url: 'https://example.invalid/a',
    },
    {
      id: 'b'.repeat(64),
      subscriptionId: sourceIds[1],
      title: '合成的过去文章乙',
      publishedAt: '2024-06-02T00:00:00Z',
      access: 'unknown',
      url: 'https://example.invalid/b',
    },
    {
      id: 'c'.repeat(64),
      subscriptionId: sourceIds[0],
      title: '合成的近期文章',
      publishedAt: '2026-01-02T00:00:00Z',
      access: 'public',
      url: 'https://example.invalid/c',
    },
  ];
  articles.push(
    {
      id: 'd'.repeat(64),
      subscriptionId: sourceIds[0],
      title: '合成的较新文章甲',
      publishedAt: '2024-09-02T00:00:00Z',
      access: 'public',
      url: 'https://example.invalid/d',
    },
    {
      id: 'e'.repeat(64),
      subscriptionId: sourceIds[1],
      title: '合成的较早文章乙',
      publishedAt: '2024-02-02T00:00:00Z',
      access: 'public',
      url: 'https://example.invalid/e',
    },
  );
  const states = sources.map((s) => ({
    ...s,
    count: 0,
    pending: 1,
    status: 'more',
    methods: [],
    errors: [],
  }));
  const imports: string[] = [];
  let preparedLimit: number | undefined;
  const planId = '33333333-3333-4333-8333-333333333333';
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        from?: string;
        to?: string;
        offset?: number;
        id?: string;
        ids?: string[];
        subscriptionId?: string;
        subscriptionIds?: string[];
        perSourceLimit?: number;
        planId?: string;
      };
    };
    if (!operation.startsWith('history_')) {
      await route.fallback();
      return;
    }
    let result: unknown;
    if (operation === 'history_open')
      result = {
        sessionId: '22222222-2222-4222-8222-222222222223',
        sources: states,
      };
    else if (operation === 'history_scan') {
      const state = states.find(
        (s) => s.subscriptionId === input.subscriptionId,
      );
      if (state) {
        state.pending = 0;
        state.count = 2;
        state.status = 'index_complete';
      }
      result = {sources: states};
    } else if (operation === 'history_preview')
      result = {
        item: articles.find((a) => a.id === input.id),
        body:
          '# 合成预览\n\n' +
          '这里是可供判断的完整合成正文，不触发补收或模型。\n\n'.repeat(36),
        access: 'public',
      };
    else if (operation === 'history_prepare_import') {
      preparedLimit = input.perSourceLimit;
      result = {planId};
    } else if (operation === 'history_import') {
      expect(input.planId).toBe(planId);
      imports.push(...(input.ids ?? []));
      result = {
        results: input.ids?.map((id) => ({
          id,
          status: 'imported',
          snapshotId: SNAPSHOT_ID,
        })),
      };
    } else {
      const rows = articles.filter(
        (a) =>
          (!input.subscriptionIds ||
            input.subscriptionIds.includes(a.subscriptionId ?? '')) &&
          (!input.from || a.publishedAt.slice(0, 10) >= input.from) &&
          (!input.to || a.publishedAt.slice(0, 10) <= input.to),
      );
      const counts = new Map<string, number>();
      const selected = [...rows]
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .filter((a) => {
          if (imports.includes(a.id)) return false;
          const key = a.subscriptionId ?? '',
            count = counts.get(key) ?? 0;
          if (
            input.perSourceLimit !== undefined &&
            count >= input.perSourceLimit
          )
            return false;
          counts.set(key, count + 1);
          return true;
        });
      result =
        operation === 'history_select'
          ? {ids: selected.map((a) => a.id), articles: selected}
          : {
              sessionId: '22222222-2222-4222-8222-222222222223',
              sources: states,
              articles: rows,
              total: rows.length,
              undated: 0,
              offset: 0,
            };
    }
    await route.fulfill({json: {result}});
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  await openWorkspace(page, '源管理');
  await page.getByRole('button', {name: /往期补收/}).click();
  const workspace = page.getByRole('region', {name: '补收往期', exact: true});
  await workspace.getByRole('button', {name: '全选来源', exact: true}).click();
  await workspace.getByLabel('发布于', {exact: true}).fill('2024-01-01');
  await workspace.getByLabel('截止到', {exact: true}).fill('2024-12-31');
  await workspace.getByLabel('每个来源最多补收').fill('1');
  const enqueue = workspace.getByRole('button', {name: /加入待审核队列/u});
  await expect(enqueue).toBeDisabled();
  await workspace
    .getByRole('button', {name: '查询选定时间段的内容', exact: true})
    .click();
  await expect(
    page
      .getByRole('dialog', {name: '补收往期', exact: true})
      .getByRole('button', {name: '关闭', exact: true}),
  ).toBeEnabled();
  await workspace
    .getByRole('button', {name: '预览', exact: true})
    .first()
    .click();
  await expect(page.locator('.history-preview')).toContainText('完整合成正文');
  const readingBox = await page
    .getByRole('region', {name: '历史文章预览'})
    .boundingBox();
  expect(readingBox?.height).toBeGreaterThan(500);
  expect(imports).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-preview')).not.toBeVisible();
  await expect(
    workspace.getByText('4 篇符合条件', {exact: true}),
  ).toBeVisible();
  await expect(
    workspace.getByText('已选 2 篇 · 2 个来源', {exact: true}),
  ).toBeVisible();
  const flowBox = await workspace.getByLabel('补收步骤').boundingBox();
  expect((flowBox?.y ?? 900) + (flowBox?.height ?? 900)).toBeLessThanOrEqual(
    900,
  );
  await page.screenshot({
    path: test.info().outputPath('history-flow-desktop.png'),
  });
  const resultSource = workspace.getByLabel('筛选查询结果来源');
  await resultSource.selectOption(sourceIds[0] ?? '');
  await expect(
    workspace.getByText('2 篇符合条件', {exact: true}),
  ).toBeVisible();
  await expect(
    workspace.getByRole('heading', {name: '合成的过去文章乙', exact: true}),
  ).not.toBeVisible();
  await expect(
    workspace.getByRole('checkbox', {
      name: '选择 合成的过去文章甲',
      exact: true,
    }),
  ).toBeDisabled();
  await workspace
    .getByRole('checkbox', {name: '选择 合成的较新文章甲', exact: true})
    .uncheck();
  await workspace
    .getByRole('checkbox', {name: '选择 合成的过去文章甲', exact: true})
    .check();
  await expect(
    workspace.getByText('已选 2 篇 · 2 个来源（当前来源 1 篇）', {exact: true}),
  ).toBeVisible();
  await resultSource.selectOption('all');
  await workspace.getByLabel('截止到', {exact: true}).fill('2024-06-30');
  await expect(enqueue).toBeDisabled();
  await expect(workspace.getByText(/来源、时间或数量已更改/u)).toBeVisible();
  expect(imports).toEqual([]);
  await workspace
    .getByRole('button', {name: '查询选定时间段的内容', exact: true})
    .click();
  await expect(enqueue).toBeEnabled();
  await enqueue.click();
  await expect(workspace.getByRole('status')).toContainText(
    '已放入待审核 2 篇',
  );
  expect(new Set(imports)).toEqual(new Set(['a'.repeat(64), 'b'.repeat(64)]));
  expect(preparedLimit).toBe(1);
  const divider = workspace.getByRole('separator', {name: '调整列表宽度'});
  const before = await divider.getAttribute('aria-valuenow');
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  expect(await divider.getAttribute('aria-valuenow')).not.toBe(before);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await expect(
      workspace.getByRole('button', {name: /加入待审核队列/u}),
    ).toBeAttached();
  }
});

test('generates optional source introductions as editable drafts without changing subscriptions or accepting articles', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: ['source_subscriptions'],
      },
    }),
  );
  const source = {
    subscriptionId: '99999999-1111-4111-8111-111111111111',
    kind: 'rss_atom',
    label: 'Synthetic publication',
    description: 'A manual introduction',
    enabled: false,
    sourceAlias: 'synthetic-description',
    isPrivate: false,
    intervalMinutes: 1440,
    feedUrl: 'https://example.invalid/feed',
    itemLimit: 20,
  };
  let saved = [source],
    saves = 0,
    generations = 0,
    blocked = false;
  await page.route('**/api/v1/source-subscriptions', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        subscriptions: typeof saved;
      };
      saved = body.subscriptions;
      saves += 1;
    }
    return route.fulfill({
      json: {
        status: route.request().method() === 'PUT' ? 'applied' : 'ok',
        revision: saves,
        subscriptions: saved,
        connectors: [],
      },
    });
  });
  await page.route('**/api/v1/ingestion/commands', (route) => {
    const body = route.request().postDataJSON() as {
      operation: string;
      input: unknown;
    };
    if (body.operation !== 'source_description_generate')
      return route.fallback();
    generations += 1;
    expect(body.input).not.toHaveProperty('authentication');
    return route.fulfill({
      status: blocked ? 422 : 200,
      json: blocked
        ? {error: {code: 'ai_price_window_closed'}}
        : {
            result: {
              text: '关注合成系统设计，发布技术分析与教程。',
              sampleCount: 6,
            },
          },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '源管理');
  const existing = page.locator('.source-map .source-edit-layout');
  const description = existing.getByRole('textbox', {
    name: '来源简介',
    exact: true,
  });
  await expect(description).toHaveValue('A manual introduction');
  expect(generations).toBe(0);
  await existing
    .getByRole('button', {name: 'AI 生成简介', exact: true})
    .click();
  await expect(existing.getByText('AI 简介草稿', {exact: true})).toBeVisible();
  await expect(description).toHaveValue('A manual introduction');
  expect(saves).toBe(0);
  await existing
    .getByRole('textbox', {name: '来源名称', exact: true})
    .fill('Synthetic changed publication');
  await expect(
    existing.getByText('来源资料已变化，生成的旧草稿未应用，请重新生成。'),
  ).toBeVisible();
  await expect(
    existing.getByRole('button', {name: '使用这份简介'}),
  ).toHaveCount(0);
  await existing
    .getByRole('button', {name: 'AI 生成简介', exact: true})
    .click();
  await existing
    .getByRole('button', {name: '使用这份简介', exact: true})
    .click();
  await expect(description).toHaveValue(
    '关注合成系统设计，发布技术分析与教程。',
  );
  expect(saves).toBe(0);
  await page.getByRole('button', {name: '保存设置', exact: true}).click();
  await expect(page.getByText('订阅已保存', {exact: true})).toBeVisible();
  expect(saved[0]).toMatchObject({
    enabled: false,
    description: '关注合成系统设计，发布技术分析与教程。',
    feedUrl: source.feedUrl,
    itemLimit: 20,
  });
  blocked = true;
  await existing
    .getByRole('button', {name: 'AI 生成简介', exact: true})
    .click();
  await expect(existing.getByRole('alert')).toContainText(
    '请在低价时段再点击生成',
  );
  await existing
    .getByRole('combobox', {name: '文档隐私', exact: true})
    .selectOption('true');
  await expect(
    existing.getByRole('button', {name: 'AI 生成简介', exact: true}),
  ).toBeDisabled();
  await page.getByRole('button', {name: '＋ 添加来源', exact: true}).click();
  const draft = page.locator('.source-map .source-edit-layout');
  await draft
    .getByRole('combobox', {name: '接入类型', exact: true})
    .selectOption('rss_atom');
  await expect(
    draft.getByRole('button', {name: 'AI 生成简介', exact: true}),
  ).toBeDisabled();
  await draft
    .getByLabel('来源名称', {exact: true})
    .fill('Synthetic new source');
  await draft.getByRole('button', {name: '编辑参数 ↗', exact: true}).click();
  const parameters = page.getByRole('dialog', {name: '接收参数', exact: true});
  await parameters
    .getByLabel('RSS / Atom 地址')
    .fill('https://example.invalid/new-feed');
  await parameters.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(
    draft.getByRole('button', {name: 'AI 生成简介', exact: true}),
  ).toBeEnabled();
  blocked = false;
  await draft.getByRole('button', {name: 'AI 生成简介', exact: true}).click();
  await expect(draft.getByText('AI 简介草稿', {exact: true})).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  expect(generations).toBe(4);
  expect(saves).toBe(1);
});

test('approved theme animates observed completions once and respects reduced motion', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page, {restructureRequests: []});
  let entryCount = 20;
  let completed = false;
  const task = (): AiTask => ({
    taskId: ENTRY_ID,
    version: 1,
    actorKind: 'automation',
    model: 'synthetic-model',
    runtimeStatus: 'running',
    request: {kind: 'document', snapshotId: SNAPSHOT_ID},
    state: {
      status: 'running',
      phase: completed ? 'tags' : 'split',
      calls: 1,
      steps: completed
        ? [{kind: 'split', complete: true, proposalId: REVISION_ID}]
        : [],
    },
  });
  await page.route('**/api/v1/entry-documents*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        documents: [{...SYNTHETIC_DOCUMENT, entryCount}],
      },
    }),
  );
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 1,
        snapshots: [SYNTHETIC_SNAPSHOT],
      },
    }),
  );
  await page.route('**/api/v1/ai-tasks/commands', (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'tasks_list')
      return route.fulfill({json: {result: [task()]}});
    return route.fallback();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  await page.emulateMedia({colorScheme: 'dark'});
  const split = page.locator('[data-flow-stage="split"]');
  const tags = page.locator('[data-flow-stage="tags"]');
  const number = page.locator(
    '[data-overview-metric="entries"] [data-overview-number]',
  );
  await expect(number).toHaveText('20');
  await expect(split).toHaveAttribute('data-flowing', 'true');
  await expect(page.locator('.overview-stat-delta')).toHaveCount(0);
  const nodeBox = await split.boundingBox();
  const detailsBox = await page.locator('.overview-bottom').boundingBox();
  if (!nodeBox || !detailsBox)
    throw new Error('Overview panels must be visible');
  expect(nodeBox.y + nodeBox.height + 8).toBeLessThanOrEqual(detailsBox.y);
  expect(nodeBox.width).toBeLessThanOrEqual(208);

  await page.getByRole('button', {name: '全部消息', exact: false}).click();
  const refresh = page.getByRole('button', {name: '刷新总览', exact: true});
  const dialog = page.getByRole('dialog', {name: '全部消息', exact: true});
  // Statistics and task state can arrive separately in the same charging period.
  entryCount = 23;
  await refresh.click();
  await expect(page.locator('.ef-energy-stat')).toHaveCount(1);
  completed = true;
  await refresh.click();
  await expect(tags).toHaveAttribute('data-motion-target', 'true');
  await dialog.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page.locator('.ef-result-transfer')).toHaveAttribute(
    'data-phase',
    'flight',
  );
  await expect(page.locator('.ef-energy-stat')).toHaveAttribute(
    'data-energy',
    '2',
  );
  await expect(number).toHaveText('20');
  await page.screenshot({
    path: testInfo.outputPath('overview-observed-transfer.png'),
  });
  await expect(number).toHaveText('23');
  await expect(page.locator('.overview-stat-delta')).toHaveCount(0);

  await page.getByRole('button', {name: '全部消息', exact: false}).click();
  await refresh.click();
  await expect(page.locator('[data-motion-source]')).toHaveCount(0);
  await expect(number).toHaveText('23');
  await page.emulateMedia({reducedMotion: 'reduce'});
  entryCount = 24;
  await refresh.click();
  await expect(number).toHaveText('24');
  await expect(page.locator('.ef-node-ring').first()).not.toBeVisible();
  await expect(page.locator('.overview-stat-delta')).toHaveCount(0);
  await dialog.getByRole('button', {name: '关闭', exact: true}).click();
  await page.screenshot({
    path: testInfo.outputPath('overview-reduced-motion.png'),
  });
  expect(errors).toEqual([]);
});

test('overview flow shows live stages, concurrent limits, messages and accessible node navigation', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/evidence?*', (route) =>
    route.fulfill({
      json: {status: 'ok', snapshots: [SYNTHETIC_SNAPSHOT], totalCount: 1},
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let concurrency = 2;
  let offline = false;
  const price = {
    policy: {
      revision: 1,
      enabled: true,
      operationsAllowed: true,
      maxConcurrentRequests: 2,
    },
    rule: 'synthetic',
    timeZone: 'Asia/Shanghai',
    provider: 'synthetic',
    applicable: true,
    peak: false,
    blocked: false,
    checkedAt: '2040-01-02T01:00:00Z',
    nextAllowedAt: null,
  };
  const tasks = [
    {
      taskId: ENTRY_ID,
      version: 1,
      model: 'synthetic-model',
      actorKind: 'automation',
      runtimeStatus: 'running',
      request: {kind: 'document', snapshotId: SNAPSHOT_ID},
      state: {status: 'running', phase: 'split', calls: 1, steps: []},
    },
    {
      taskId: REVISION_ID,
      version: 1,
      model: 'synthetic-model',
      actorKind: 'owner',
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: RESOURCE_ID},
      state: {
        status: 'failed',
        phase: 'tags',
        calls: 1,
        steps: [],
        errorCode: 'ai_provider_invalid_response',
      },
    },
    {
      taskId: STRUCTURE_ID,
      version: 1,
      model: 'synthetic-model',
      actorKind: 'owner',
      runtimeStatus: 'idle',
      request: {kind: 'document', snapshotId: NODE_ID},
      state: {
        status: 'paused',
        phase: 'relations',
        calls: 1,
        steps: [],
        errorCode: 'ai_price_window_closed',
      },
    },
  ];
  await page.route('**/api/v1/ai-tasks/commands', (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'system_status')
      return route.fulfill({
        status: offline ? 503 : 200,
        json: offline
          ? {error: {code: 'unavailable'}}
          : {
              result: {
                role: 'all',
                agentEnabled: false,
                grants: [],
                model: 'synthetic-model',
                aiPrice: {
                  ...price,
                  policy: {...price.policy, maxConcurrentRequests: concurrency},
                },
              },
            },
      });
    if (operation === 'tasks_list')
      return route.fulfill({json: {result: tasks}});
    return route.fallback();
  });
  await page.route('**/api/v1/ingestion/commands', (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation === 'intake_status')
      return route.fulfill({
        json: {
          result: {
            records: [
              {
                snapshotId: RESOURCE_ID,
                version: 1,
                updatedAt: price.checkedAt,
                value: {
                  receipt: 'pending',
                  decision: 'pending',
                  origin: 'system',
                  preparation: 'received',
                  reason: '',
                },
              },
            ],
          },
        },
      });
    if (operation === 'ingestion_status')
      return route.fulfill({
        json: {
          result: {
            policy: {revision: 1, settings: {enabled: true, paused: false}},
            items: [],
            modelConfigured: true,
          },
        },
      });
    return route.fallback();
  });
  await page.route('**/api/v1/research/commands', (route) =>
    route.fulfill({json: {result: {notices: [], jobs: [], schedules: []}}}),
  );
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  const nodes = page.locator('.ov-pipeline .flow-node');
  await expect(nodes).toHaveCount(6);
  await expect(page.locator('.ov-step-title')).toHaveText([
    '接收',
    '入库',
    '拆分',
    '标签',
    '联系',
    '报告',
  ]);
  await expect(page.locator('[data-overview-metric]')).toHaveCount(5);
  await expect(nodes.nth(0)).toHaveAttribute('data-tone', 'review');
  await expect(page.locator('[data-flow-stage="split"]')).toHaveAttribute(
    'data-tone',
    'working',
  );
  await expect(page.locator('[data-flow-stage="split"]')).toContainText(
    'AI 自动',
  );
  await expect(page.locator('[data-flow-stage="tags"]')).toHaveAttribute(
    'data-tone',
    'failed',
  );
  await expect(page.locator('[data-flow-stage="relations"]')).toHaveAttribute(
    'data-tone',
    'waiting',
  );
  await page.locator('[data-flow-stage="split"]').locator('..').click();
  await expect(
    page.getByRole('dialog', {name: '拆分 · 工序状态'}),
  ).toContainText('整理文档结构');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '展开任务队列', exact: true}).click();
  const queue = page.getByRole('dialog', {name: '任务队列', exact: true});
  await expect(queue).toContainText('模型请求并发上限 2');
  concurrency = 4;
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(queue).toContainText('模型请求并发上限 4');
  await page.keyboard.press('Escape');
  await expect(queue).not.toBeVisible();
  await expect(
    page.getByRole('button', {name: '展开任务队列', exact: true}),
  ).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({colorScheme: theme === 'dark' ? 'dark' : 'light'});
    for (const [width, height] of [
      [2560, 1280],
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [768, 900],
      [390, 844],
      [320, 700],
    ] as const) {
      await page.setViewportSize({width, height});
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (width >= 1024)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollHeight - innerHeight,
          ),
          JSON.stringify(
            await page
              .locator(
                '.editorial-overview, .overview-flow, .overview-flow__track, .overview-flow__lower',
              )
              .evaluateAll((nodes) =>
                nodes.map((n) => ({
                  class: n.getAttribute('class'),
                  top: n.getBoundingClientRect().top,
                  height: n.getBoundingClientRect().height,
                  scroll: n.scrollHeight,
                })),
              ),
          ),
        ).toBeLessThanOrEqual(1);
      if (width === 2560) {
        const geometry = await nodes.evaluateAll((elements) =>
          elements.map((element) => ({
            width: element.getBoundingClientRect().width,
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
          })),
        );
        expect(geometry.every((box) => Math.abs(box.width - 208) < 1)).toBe(
          true,
        );
        const gaps = geometry.slice(1).map((box, index) => {
          const previous = geometry[index];
          if (!previous) throw new Error('Missing preceding workflow node');
          return box.left - previous.right;
        });
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
        expect(gaps[0]).toBeGreaterThan(100);
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `overview-flow-${theme}-${String(width)}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({width: 1440, height: 900});
  await page.emulateMedia({reducedMotion: 'reduce'});
  expect(
    await nodes
      .nth(2)
      .evaluate((el) => getComputedStyle(el, '::after').animationName),
  ).toBe('none');
  await nodes.nth(5).locator('..').focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('dialog', {name: '报告 · 工序状态'})
    .getByRole('button', {name: '打开报告', exact: false})
    .click();
  await expect(page.locator('.product-shell')).toHaveAttribute(
    'data-section',
    'reports',
  );
  await page
    .getByRole('dialog', {name: '报告', exact: true})
    .getByRole('button', {name: '关闭', exact: true})
    .click();
  await openWorkspace(page, '总览');
  offline = true;
  await page.getByRole('button', {name: '全部消息', exact: false}).click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-flow-stage="split"]')).toHaveAttribute(
    'data-tone',
    'unknown',
  );
  await expect(page.locator('[data-flow-stage="split"]')).toHaveAttribute(
    'data-flowing',
    'false',
  );
  await expect(
    page.getByRole('switch', {name: '允许 AI 操作', exact: true}),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test('P4 edits evidence-bound annotations and keeps the panel usable across widths', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page, {manualSplitRequests: []});
  let vocabulary: AnnotationVocabulary = {
    revision: 0,
    dimensions: [],
    terms: [],
    aliases: [],
    relations: [],
  };
  let saved: AnnotationDraft | undefined;
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: {
        vocabulary: AnnotationVocabulary;
        annotation: AnnotationDraft;
        expectedRevision: number;
      };
    };
    let result: unknown;
    if (operation === 'entry_annotations_read')
      result = {entry: SYNTHETIC_ENTRY, vocabulary};
    else if (operation === 'annotation_vocabulary_save') {
      vocabulary = {...input.vocabulary, revision: vocabulary.revision + 1};
      result = {vocabulary};
    } else if (operation === 'annotation_vocabulary') result = {vocabulary};
    else if (operation === 'entry_annotations_save') {
      expect(input.expectedRevision).toBe(1);
      saved = input.annotation;
      result = {status: 'applied'};
    } else {
      await route.fallback();
      return;
    }
    await route.fulfill({json: {status: 'ok', result}});
  });
  await page.goto('/');
  await openWorkspace(page, '工作台');
  await openDocumentEditor(page);
  await page
    .locator('.reader-editor-actions')
    .getByRole('button', {name: '条目标注', exact: true})
    .click();
  const panel = page.getByRole('region', {name: '条目标注', exact: true});
  await panel.getByRole('button', {name: '词表设置', exact: true}).click();
  await panel
    .getByRole('button', {name: '使用六个起始维度', exact: true})
    .click();
  await panel.getByRole('button', {name: '保存词表设置', exact: true}).click();
  await expect(panel.getByText('词表已保存。')).toBeVisible();
  expect(vocabulary.dimensions).toHaveLength(6);
  await panel.getByRole('button', {name: '本条标注', exact: true}).click();
  await panel
    .getByRole('combobox', {name: '标注维度', exact: true})
    .selectOption({label: '核心议题'});
  await panel
    .getByRole('textbox', {name: '标签名称', exact: true})
    .fill('浏览器验证');
  await panel
    .getByRole('textbox', {name: '具体含义', exact: true})
    .fill('合成界面测试');
  await panel
    .getByRole('textbox', {name: '正文依据', exact: true})
    .fill('不存在的引用');
  await panel.getByRole('button', {name: '添加到本条', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('原句');
  await panel
    .getByRole('textbox', {name: '正文依据', exact: true})
    .fill(SYNTHETIC_ENTRY.value.body);
  await panel.getByRole('button', {name: '添加到本条', exact: true}).click();
  await panel
    .getByRole('combobox', {name: '阅读状态', exact: true})
    .selectOption('read');
  await panel.getByRole('button', {name: '保存标注草稿', exact: true}).click();
  await expect(panel.getByText('标注草稿已保存，请确认文档。')).toBeVisible();
  expect(saved?.labels[0]?.evidence.quote).toBe(SYNTHETIC_ENTRY.value.body);
  expect(saved?.readingState).toBe('read');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    await panel
      .getByRole('button', {name: '关闭条目标注', exact: true})
      .focus();
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await panel.evaluate((el) => {
      el.scrollTop = 0;
      for (const child of el.querySelectorAll('*'))
        if (child.scrollHeight > child.clientHeight) child.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath('p4-annotation-' + width.toString() + '.png'),
      animations: 'disabled',
    });
    await expect(
      panel.getByRole('button', {name: '关闭条目标注', exact: true}),
    ).toBeInViewport();
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.emulateMedia({colorScheme: 'dark'});
  await page.screenshot({
    path: testInfo.outputPath('p4-dark.png'),
    animations: 'disabled',
  });
  await page.emulateMedia({colorScheme: 'light'});
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await page.setViewportSize({width: 1440, height: 1000});
  await openWorkspace(page, '数据阅览');
  await openQuerySettings(page);
  const fields = page.getByRole('group', {name: '结构化分类', exact: true});
  await fields
    .getByRole('combobox', {name: '标注状态', exact: true})
    .selectOption('none');
  await fields
    .getByRole('combobox', {name: '阅读进度', exact: true})
    .selectOption('read');
  await page.screenshot({
    path: testInfo.outputPath('p4-query.png'),
    animations: 'disabled',
  });
  const searched = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/v1/entries/search') &&
      request.method() === 'POST',
  );
  await submitQuery(page);
  expect((await searched).postDataJSON()).toMatchObject({
    annotationFilter: {status: 'none', readingState: 'read'},
  });
});

test('P5 separates candidates, topics and metered work without compressing reading', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  const topicId = '00000000-0000-4000-8000-000000000101';
  const jobId = '00000000-0000-4000-8000-000000000102';
  let decision = 'included',
    version = 1,
    started = false;
  let selectedScope: unknown;
  await page.route('**/api/v1/ingestion/commands', async (route) => {
    const {operation, input} = route.request().postDataJSON() as {
      operation: string;
      input: Record<string, unknown>;
    };
    let result: unknown;
    if (operation === 'topics_list')
      result = {
        topics: [
          {
            id: topicId,
            version,
            stale: false,
            value: {
              name: '带宽与计算效率',
              scope: '讨论内存访问对计算速度的影响。',
              summary: '两份材料解释带宽约束。',
              members: [
                {
                  entryId: ENTRY_ID,
                  revision: 1,
                  quote: SYNTHETIC_ENTRY.value.body,
                  reason: '说明内存访问的开销。',
                  decision,
                  origin: 'ai',
                },
              ],
              relations: [],
            },
            entries: [
              {entryId: ENTRY_ID, title: '合成条目：内存访问', stale: false},
            ],
          },
        ],
        jobs: started
          ? [
              {
                id: jobId,
                version: 1,
                status: 'queued',
                errorCode: 'ai_price_window_closed',
                attempts: 0,
                maxAttempts: 2,
                budgetId: 'synthetic-p5',
                chargedNanoCny: 0,
                usageKnown: true,
                entries: [{entryId: ENTRY_ID, title: '合成条目：内存访问'}],
              },
            ]
          : [],
      };
    else if (operation === 'topic_member_set') {
      decision = (input.member as {decision: string}).decision;
      version++;
      result = {topicId};
    } else if (operation === 'topics_preview')
      result = {
        candidates: [
          {
            entryId: EXPLORATION_ENTRY_ID,
            revision: 1,
            title: '合成条目：优化内存访问',
            source: 'synthetic.invalid',
            score: 2,
            reasons: ['共同标注：内存带宽', '正文词语：缓存、访问'],
            samples: 2,
            uncertain: true,
          },
        ],
      };
    else if (operation === 'topic_job_start') {
      selectedScope = input.scope;
      started = true;
      result = {jobId, reused: false};
    } else return route.fallback();
    return route.fulfill({json: {result}});
  });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '数据阅览');
  const trigger = page.getByRole('button', {name: '主题与联系', exact: true});
  await trigger.click();
  const panel = page.locator('.content-topics-panel:visible');
  await expect(
    panel.getByRole('heading', {name: '带宽与计算效率'}),
  ).toBeVisible();
  await panel.getByRole('button', {name: '排除', exact: true}).click();
  await expect(panel.getByText('已排除', {exact: true})).toBeVisible();
  await panel.getByRole('button', {name: '相似候选', exact: true}).click();
  await panel.getByRole('button', {name: '查找候选', exact: true}).click();
  await expect(
    panel.getByText('共同标注：内存带宽；正文词语：缓存、访问'),
  ).toBeVisible();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('p5-candidates-' + String(width) + '.png'),
      animations: 'disabled',
    });
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await panel
    .getByRole('textbox', {name: '已有批次预算编号'})
    .fill('synthetic-p5');
  await panel.getByRole('button', {name: '让 AI 检查并归组'}).click();
  await expect(panel.getByRole('heading', {name: '等待运行'})).toBeVisible();
  expect(selectedScope).toMatchObject({
    entryId: ENTRY_ID,
    candidateLimit: 8,
    crossConditions: false,
  });
  await expect(panel.getByText(/0.0000 元/)).toBeVisible();
  await page.emulateMedia({colorScheme: 'dark'});
  await page.screenshot({
    path: testInfo.outputPath('p5-dark.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('P8 accepted five-page integration and viewport', async ({page}, info) => {
  await installCurrentProductApi(page, {manualSplitRequests: []});
  await page.route('**/api/v1/workspace', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: ['source_subscriptions'],
      },
    }),
  );
  let sources = [
    {
      subscriptionId: '99999999-1111-4111-8111-111111111111',
      kind: 'rss_atom',
      label: '合成技术来源',
      description: '技术文章与教程。',
      enabled: false,
      sourceAlias: 'synthetic-source',
      isPrivate: false,
      intervalMinutes: 1440,
      feedUrl: 'https://example.invalid/feed',
      itemLimit: 20,
    },
  ];
  let revision = 0;
  await page.route('**/api/v1/source-subscriptions', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        expectedRevision: number;
        subscriptions: typeof sources;
      };
      expect(body.expectedRevision).toBe(revision);
      sources = body.subscriptions;
      revision++;
    }
    return route.fulfill({
      json: {
        status: route.request().method() === 'PUT' ? 'applied' : 'ok',
        revision,
        subscriptions: sources,
        connectors: [],
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({width: 1600, height: 1000});
  await page.emulateMedia({colorScheme: 'dark'});
  await page.goto('/');
  await expect(page.locator('.overview-home')).toBeVisible();
  await page.screenshot({path: info.outputPath('p8-overview.png')});
  const nav = page.getByRole('navigation', {name: '产品工作区'});
  await nav.getByRole('button', {name: '源管理', exact: true}).click();
  await expect(page.getByLabel('来源名称', {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('p8-sources.png')});
  await page.getByLabel('来源名称', {exact: true}).fill('合成来源 · 已保存');
  await page.getByRole('button', {name: '保存设置', exact: true}).click();
  await expect.poll(() => sources[0]?.label).toBe('合成来源 · 已保存');
  await page.getByRole('button', {name: '接收记录与计划'}).click();
  await page.screenshot({path: info.outputPath('p8-source-drawer.png')});
  await nav.getByRole('button', {name: '文档阅读', exact: true}).click();
  await expect(page.locator('.reader-study')).toBeVisible();
  await page.screenshot({path: info.outputPath('p8-reading.png')});
  await nav.getByRole('button', {name: '数据库', exact: true}).click();
  await expect(page.locator('.database-blank')).toBeVisible();
  await page.screenshot({path: info.outputPath('p8-database-idle.png')});
  await page
    .getByRole('search')
    .getByRole('button', {name: '搜索', exact: true})
    .click();
  await expect(page.locator('.query-studio-results')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator('.search-module').boundingBox())?.y ?? 1000,
    )
    .toBeLessThan(70);
  await page.screenshot({path: info.outputPath('p8-database-results.png')});
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await expect(page.locator('.settings-main')).toBeVisible();
  await page.screenshot({path: info.outputPath('p8-settings.png')});
  for (const name of [
    'AI 执行',
    '自动处理',
    '标签与词表',
    '联网与通知',
    '数据与维护',
  ]) {
    await page
      .locator('.settings-nav')
      .getByRole('link', {name, exact: true})
      .click();
    await page.screenshot({
      path: info.outputPath('p8-settings-' + encodeURIComponent(name) + '.png'),
    });
  }
  expect(errors).toEqual([]);
});

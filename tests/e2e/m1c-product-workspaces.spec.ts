import type {
  ReportRecord,
  ReportRequest,
  ReportEdit,
} from '../../apps/web/src/api/report_client.js';
import type {AiPolicy} from '../../apps/web/src/api/ai_workflow_client.js';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {EntryMarkdownExportService} from '../../apps/server/src/modules/entries/information_entry_markdown_export_service.js';
import type {CurrentInformationEntry} from '../../apps/server/src/modules/entries/information_entry_contract.js';
import type {EntryMarkdownExportRepositoryPort} from '../../apps/server/src/modules/entries/information_entry_markdown_export.js';
import {Buffer} from 'node:buffer';
import {DEFAULT_WORKSPACE_UI_PREFERENCES} from '../../apps/web/src/api/workspace_ui_preferences.js';

import {expect, test, type Locator, type Page} from '@playwright/test';

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
        operation === 'intake_status'
          ? {records: []}
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
                      maxRelations: 4,
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

async function openQuerySettings(page: Page, name = '筛选与匹配方式') {
  const trigger = page.getByRole('button', {name, exact: true});
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
}

async function clickVisibleUnobscured(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    element.scrollIntoView({block: 'center', inline: 'center'});
  });
  const isUnobscured = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return (
      topmost === element || (topmost !== null && element.contains(topmost))
    );
  });
  expect(isUnobscured).toBe(true);
  await locator.evaluate((element) => {
    globalThis.setTimeout(() => {
      if (element instanceof HTMLElement) element.click();
    }, 0);
  });
}

test('keeps secondary disclosure widths stable when opened', async ({page}) => {
  test.setTimeout(90_000);
  await installCurrentProductApi(page);
  for (const width of [390, 1440, 2220]) {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/');
    const navigation = page.getByRole('navigation', {name: '产品工作区'});
    for (const [name, selector, count] of [
      ['拆分', '.split-studio-grid__tools > details', 4],
      ['标签', '.tags-studio-grid__rules > details', 3],
    ] as const) {
      await openWorkspace(page, name, navigation);
      const drawers = page.locator(selector);
      await expect(drawers).toHaveCount(count);
      for (const drawer of await drawers.all()) {
        const summary = drawer.locator(':scope > summary');
        await expect(drawer).toHaveJSProperty('open', false);
        const closedBounds = await drawer.boundingBox();
        await summary.click();
        await expect(drawer).toHaveJSProperty('open', true);
        await expect(
          drawer.locator(':scope > :not(summary)').first(),
        ).toBeVisible();
        const openBounds = await drawer.boundingBox();
        if (closedBounds === null || openBounds === null)
          throw new Error('Missing disclosure bounds');
        expect(
          Math.abs(openBounds.width - closedBounds.width),
        ).toBeLessThanOrEqual(1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      for (const drawer of await drawers.all()) {
        await drawer.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        await expect(drawer).toHaveJSProperty('open', false);
      }
    }
  }
});

test('explains split prerequisites and keeps the working-copy controls usable', async ({
  page,
}) => {
  const productRequests = await installCurrentProductApi(page, {
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
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await openWorkspace(page, '拆分');
  for (const name of ['拆分前全文修改', '调整已经拆分的结构']) {
    await page
      .locator('.split-studio-grid__tools > details > summary')
      .filter({hasText: name})
      .click();
  }
  const workingCopy = page.locator('.information-document-working-copy');
  await expect(workingCopy.getByRole('status')).toHaveText(
    '请先在来源文档导航中选择一份具体文档，再修改拆分前全文。',
  );
  await expect(
    page.getByText(
      '请先在来源文档导航中选择一份具体文档，再调整已有条目结构。',
      {exact: true},
    ),
  ).toBeVisible();
  expect(workingCopyMethods).toEqual([]);
  expect(
    productRequests.filter((request) => request.includes('/restructure')),
  ).toEqual([]);
  await page
    .getByRole('combobox', {name: '选择来源文档', exact: true})
    .selectOption(SNAPSHOT_ID);
  await expect(
    page.getByText('当前文档尚未生成条目，完成首次拆分后才能调整已有结构。', {
      exact: true,
    }),
  ).toBeVisible();
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
    .getByRole('combobox', {name: '选择来源文档', exact: true})
    .selectOption('');
  await expect(editor).toHaveCount(0);
  await expect(workingCopy.getByRole('status')).toContainText('请先');
  expect(workingCopyMethods).toEqual(['GET', 'PUT']);
});

test('exposes only the current document-to-entry workflow', async ({page}) => {
  const productRequests = await installCurrentProductApi(page);
  await page.goto('/');

  await expect(
    page.getByRole('heading', {name: '资料库', exact: true}),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  const sections = [
    {
      name: '导入',
      guide: '导入页操作指南',
      instructions: ['选择文件并填写来源信息', '确认隐私范围后开始导入'],
    },
    {
      name: '拆分',
      guide: '拆分页操作指南',
      instructions: ['选择来源文档', '拆分并保存结构'],
    },
    {
      name: '标签',
      guide: '标签页操作指南',
      instructions: ['先选择文档，再选择条目', '检查关键词并完成评分'],
    },
    {
      name: '联系',
      guide: '联系页操作指南',
      instructions: ['选择起点与终点', '确认后保存联系与权重'],
    },
    {
      name: '查询',
      guide: '查询页操作指南',
      instructions: ['输入关键词，按需展开筛选', '阅读正文并查看来源'],
    },
    {
      name: '知识',
      guide: '知识页操作指南',
      instructions: ['从上方选择中心条目', '在底部检查并编辑关系'],
    },
  ] as const;

  for (const section of sections) {
    await openWorkspace(page, section.name, navigation);
    await expect(
      page.getByRole('heading', {
        name:
          section.name === '导入'
            ? '收件箱'
            : section.name === '知识'
              ? '专题'
              : section.name,
        exact: true,
      }),
    ).toBeVisible();
    if (section.name === '导入') {
      await expect(
        page.getByRole('button', {name: '导入文档', exact: true}),
      ).toBeVisible();
      continue;
    }
    const guide = page.getByLabel(section.guide, {exact: true});
    await expect(guide).toBeVisible();
    await guide.locator('summary').click();
    for (const instruction of section.instructions) {
      await expect(guide).toContainText(instruction);
    }
  }
  await expect(page.getByRole('region', {name: '选择知识中心'})).toBeVisible();
  await expect(page.getByRole('group', {name: '条目关系图'})).toBeVisible();

  await expect(page.getByText('审核与知识入库', {exact: true})).toHaveCount(0);
  await expect(page.getByText('知识变更集', {exact: true})).toHaveCount(0);
  expect(
    productRequests.some((request) =>
      /\/api\/v1\/(curation|knowledge|search)(?:\/|$)/u.test(request),
    ),
  ).toBe(false);
  expect(productRequests).toContain('POST /api/v1/entries/search');
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
  await page.getByText('联系权重设置', {exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '联系权重', exact: true}),
  ).toBeVisible();

  await page.getByLabel('内容相似度数值').fill('50');
  await page.getByLabel('类型相似度数值').fill('25');
  await page.getByLabel('领域相似度数值').fill('25');
  await page
    .getByRole('button', {name: '保存权重并重建联系', exact: true})
    .click();
  await expect(
    page.getByText('联系设置已保存并生效', {exact: true}),
  ).toBeVisible();

  await navigation.getByRole('button', {name: '查询', exact: true}).click();
  await openQuerySettings(page);
  await page.getByLabel('隐私结果').selectOption({label: '公开与隐私结果'});
  await page.getByRole('button', {name: '搜索', exact: true}).click();

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

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await navigation.getByRole('button', {name: '查询', exact: true}).click();
  await page
    .locator('.query-sidebar-section > details > summary', {
      hasText: '更多工具',
    })
    .click();

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
  await expect(
    page.getByText('不会改变搜索结果', {exact: false}),
  ).toBeVisible();
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
  await page.getByLabel('搜索信息条目').fill('新的查询范围');
  await expect(
    page.getByRole('heading', {name: '合成探索 Entry', exact: true}),
  ).toBeHidden();
  await expect(
    page.getByText('选择一个查询结果后，可以生成探索推荐。', {
      exact: true,
    }),
  ).toBeHidden();
  await page
    .locator('.query-sidebar-section > details > summary', {
      hasText: '更多工具',
    })
    .click();
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

test('keeps the preference panel responsive and ignores superseded local results', async ({
  page,
}) => {
  const suggestionGate = controlledGate();
  const trialGate = controlledGate();
  const suggestionScopes: boolean[] = [];
  const trialScopes: boolean[] = [];
  await installCurrentProductApi(page, {
    preferenceSuggestionGate: suggestionGate.promise,
    preferenceSuggestionScopes: suggestionScopes,
    preferenceTrialGate: trialGate.promise,
    preferenceTrialScopes: trialScopes,
  });
  await page.setViewportSize({width: 320, height: 720});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '标签', navigation);
  const tagsTools = page.locator('.tags-studio-grid__rules');
  await expect(tagsTools.getByText('点击展开', {exact: true})).toHaveCount(3);
  await page
    .locator('.tags-studio-grid__rules summary', {hasText: '偏好规则'})
    .click();
  await expect(
    page.getByRole('heading', {name: '偏好规则', exact: true}),
  ).toBeVisible();

  const privateScope = page.getByRole('checkbox', {
    name: '本次建议与试运行包含隐私条目',
    exact: true,
  });
  const generate = page.getByRole('button', {
    name: '生成规则建议',
    exact: true,
  });
  await generate.click();
  await expect.poll(() => suggestionScopes.length).toBe(1);
  await privateScope.check();
  await generate.click();
  await expect(page.getByText('当前隐私候选', {exact: true})).toBeVisible();
  const lateSuggestionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      '/api/v1/entries/preferences/profile/suggestions',
  );
  suggestionGate.release();
  await lateSuggestionResponse;
  await expect(page.getByText('迟到公开候选', {exact: true})).toHaveCount(0);
  expect(suggestionScopes).toEqual([false, true]);

  const trial = page.getByRole('button', {name: /试算最多 100 条/u});
  await trial.click();
  await expect.poll(() => trialScopes.length).toBe(1);
  await privateScope.uncheck();
  await trial.click();
  await expect(page.getByText('bbbbbbbb…', {exact: true})).toBeVisible();
  const lateTrialResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      '/api/v1/entries/preferences/profile/trial',
  );
  trialGate.release();
  await lateTrialResponse;
  await expect(page.getByText('aaaaaaaa…', {exact: true})).toHaveCount(0);
  expect(trialScopes).toEqual([true, false]);

  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('heading', {name: '偏好规则', exact: true}),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const generateBounds = await generate.boundingBox();
    const trialBounds = await trial.boundingBox();
    if (generateBounds === null || trialBounds === null)
      throw new Error('Missing preference actions');
    expect(generateBounds.width).toBeLessThan(240);
    expect(trialBounds.width).toBeLessThan(240);
    const tools = page.locator('.entry-preference-profile__tools > section');
    const suggestionPanelBounds = await tools.first().boundingBox();
    const trialPanelBounds = await tools.last().boundingBox();
    if (suggestionPanelBounds === null || trialPanelBounds === null)
      throw new Error('Missing preference tool panels');
    if (Math.abs(suggestionPanelBounds.x - trialPanelBounds.x) > 1) {
      expect(
        Math.abs(suggestionPanelBounds.y - trialPanelBounds.y),
      ).toBeLessThanOrEqual(1);
    } else {
      expect(trialPanelBounds.y).toBeGreaterThanOrEqual(
        suggestionPanelBounds.y + suggestionPanelBounds.height,
      );
    }
  }

  await page.route(
    '**/api/v1/entries/preferences/profile/suggestions',
    (route) =>
      route.fulfill({
        json: {
          status: 'ok',
          includePrivate: false,
          visibleEntryCount: 64,
          totalCandidateCount: 64,
          truncated: false,
          candidates: Array.from({length: 64}, (_, index) => ({
            dimension: 'usefulness',
            featureKind: 'content_keyword',
            featureIdentity: 'synthetic-' + String(index),
            displayValue: '合成建议 ' + String(index + 1),
            effect: 'prefer',
            suggestedWeight: 4,
            positiveCount: 3,
            neutralCount: 0,
            negativeCount: 0,
            positiveEntryIds: [ENTRY_ID],
            neutralEntryIds: [],
            negativeEntryIds: [],
          })),
        },
      }),
  );
  await generate.click();
  const suggestions = page.getByRole('list', {
    name: '偏好规则建议',
    exact: true,
  });
  await expect(suggestions.locator(':scope > li')).toHaveCount(64);
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    expect((await suggestions.boundingBox())?.height).toBeLessThanOrEqual(448);
    await suggestions.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() => suggestions.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    expect(
      await generate.evaluate((node) =>
        node.closest('.entry-preference-suggestion-list'),
      ),
    ).toBeNull();
  }
  await suggestions
    .getByRole('button', {name: '把建议加入规则：合成建议 64', exact: true})
    .click();
  await expect(
    page
      .getByRole('list', {name: '偏好规则草稿', exact: true})
      .getByRole('textbox', {name: '显示名称', exact: true}),
  ).toHaveValue('合成建议 64');
});

test('keeps automation audit exact, responsive, and isolated from late run lists', async ({
  page,
}) => {
  const runListGate = controlledGate();
  const runListRequests: string[] = [];
  await installCurrentProductApi(page, {
    automationRunListGate: runListGate.promise,
    automationRunListRequests: runListRequests,
  });
  await page.setViewportSize({width: 320, height: 720});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await navigation.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '处理流程', exact: true}).click();
  await page
    .locator('.settings-content summary')
    .filter({hasText: '自动分流'})
    .click();
  const panel = page.locator('.entry-automation-policy');
  await expect(
    panel.getByRole('heading', {name: '自动分流', exact: true}),
  ).toBeVisible();
  await expect(panel.getByText('aaaaaaaa…aaaa', {exact: true})).toBeVisible();
  await expect(
    panel.getByRole('checkbox', {
      name: '继续处理后生成自动标签',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    panel.getByRole('checkbox', {
      name: '标签处理后重建相似联系',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    panel.getByText(
      '两项默认关闭，只处理“建议继续处理”的条目。自动标签会遵守排除词与别名；更新联系不会覆盖人工设置和知识图谱关系。',
      {exact: true},
    ),
  ).toBeVisible();

  await panel.getByRole('button', {name: '刷新记录', exact: true}).click();
  await expect.poll(() => runListRequests.length).toBe(2);
  await panel.getByRole('button', {name: '重新读取', exact: true}).click();
  await expect.poll(() => runListRequests.length).toBe(3);
  await expect(panel.getByText('cccccccc…cccc', {exact: true})).toBeVisible();

  const lateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/entries/automation/runs',
  );
  runListGate.release();
  await lateResponse;
  await expect(panel.getByText('bbbbbbbb…bbbb', {exact: true})).toHaveCount(0);
  await expect(panel.getByText('cccccccc…cccc', {exact: true})).toBeVisible();

  await panel
    .getByRole('button', {name: /读取运行 cccccccc…cccc 的详情/u})
    .click();
  await expect(
    panel.getByRole('heading', {name: '运行详情', exact: true}),
  ).toBeVisible();
  await expect(
    panel.getByText(
      '全部分流记录均已完成；这次运行只记录处理去向，没有修改条目内容。',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    panel.getByText('cccccccc-cccc-4ccc-8ccc-cccccccccccc', {exact: true}),
  ).toBeVisible();

  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      panel.getByRole('heading', {name: '运行详情', exact: true}),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('splits one immutable Fragment at an explicit caret and submits exact scalar ranges', async ({
  page,
}) => {
  test.slow();
  const manualSplitRequests: string[] = [];
  await installCurrentProductApi(page, {manualSplitRequests});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '拆分', navigation);
  await page
    .getByRole('combobox', {name: '选择来源文档', exact: true})
    .selectOption(SNAPSHOT_ID);
  const splitTools = page.locator('.split-studio-grid__tools');
  await expect(
    splitTools.locator(':scope > .entry-manual-split').first(),
  ).toBeVisible();
  await expect(splitTools.locator(':scope > *').first()).toHaveClass(
    /entry-manual-split/u,
  );
  await expect(splitTools.getByText('点击展开', {exact: true})).toHaveCount(4);
  await expect(
    page.getByRole('heading', {name: '人工拆分工作台', exact: true}),
  ).toBeVisible();
  const sourceText = page.getByLabel('条目 1 来源段 1 正文');
  await expect(sourceText).toHaveValue(SYNTHETIC_FRAGMENT_TEXT);
  await sourceText.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement))
      throw new Error('Expected a textarea.');
    element.focus();
    element.setSelectionRange(3, 3);
    element.dispatchEvent(new Event('select', {bubbles: true}));
    element.dispatchEvent(
      new KeyboardEvent('keyup', {bubbles: true, key: 'ArrowLeft'}),
    );
  });
  await expect(sourceText).toHaveJSProperty('selectionStart', 3);
  const splitAtCaret = page
    .getByRole('button', {name: '在光标处分开', exact: true})
    .first();
  await expect(splitAtCaret).toBeVisible();
  await expect(splitAtCaret).toBeEnabled();
  await clickVisibleUnobscured(splitAtCaret);

  await expect(
    page.getByText('2 条 · 2 个来源段', {exact: true}),
  ).toBeVisible();
  const saveManualSplit = page.getByRole('button', {
    name: '保存人工拆分并生成 2 条',
    exact: true,
  });
  await expect(saveManualSplit).toBeVisible();
  await expect(saveManualSplit).toBeEnabled();
  await clickVisibleUnobscured(saveManualSplit);
  await expect(page.getByText('人工拆分已保存', {exact: true})).toBeVisible({
    timeout: 15_000,
  });

  const submitted = JSON.parse(manualSplitRequests[0] ?? 'null') as unknown;
  expect(submitted).toEqual({
    snapshotId: SNAPSHOT_ID,
    includePrivate: false,
    groups: [
      {
        titlePath: SYNTHETIC_FRAGMENT_TEXT,
        fragments: [
          {fragmentId: FRAGMENT_ID, startCodePoint: 0, endCodePoint: 2},
        ],
      },
      {
        titlePath: 'Z',
        fragments: [
          {fragmentId: FRAGMENT_ID, startCodePoint: 2, endCodePoint: 3},
        ],
      },
    ],
  });
});

test('saves, previews, and applies one versioned local split rule', async ({
  page,
}) => {
  const splitRuleRequests: Readonly<{path: string; body: string}>[] = [];
  await installCurrentProductApi(page, {splitRuleRequests});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '拆分', navigation);
  await page
    .getByRole('combobox', {name: '选择来源文档', exact: true})
    .selectOption(SNAPSHOT_ID);
  const ruleSummary = page
    .locator('.workflow-tool-drawer > summary')
    .filter({hasText: '结构规则'});
  await ruleSummary.focus();
  await page.keyboard.press('Enter');

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

  await panel.getByRole('button', {name: '预览当前文档', exact: true}).click();
  await expect(panel.getByLabel('拆分规则预览结果')).toContainText(
    SYNTHETIC_FRAGMENT_TEXT,
  );
  await panel
    .getByRole('button', {name: '按已保存规则生成', exact: true})
    .click();
  await expect(panel.getByText('规则拆分已完成', {exact: true})).toBeVisible();

  expect(splitRuleRequests.map((item) => item.path)).toEqual([
    '/api/v1/entries/split-rules/profile',
    '/api/v1/entries/split-rules/trial',
    '/api/v1/entries/split-rules/apply',
  ]);
  expect(JSON.parse(splitRuleRequests[0]?.body ?? '{}')).toEqual({
    expectedRevision: 0,
    mode: 'merge_short_adjacent',
    minimumGroupCodePoints: 250,
    maximumGroupCodePoints: 2500,
    maximumFragmentsPerGroup: 6,
  });
  expect(JSON.parse(splitRuleRequests[2]?.body ?? '{}')).toEqual({
    snapshotId: SNAPSHOT_ID,
    includePrivate: false,
    expectedProfileRevision: 1,
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

test('previews and atomically applies a post-materialization scalar restructure', async ({
  page,
}) => {
  test.slow();
  const restructureRequests: Readonly<{path: string; body: string}>[] = [];
  await installCurrentProductApi(page, {restructureRequests});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await openWorkspace(page, '拆分', navigation);
  await page
    .getByRole('combobox', {name: '选择来源文档', exact: true})
    .selectOption(SNAPSHOT_ID);
  await page
    .locator('.split-studio-grid__tools > details > summary')
    .filter({hasText: '拆分前全文修改'})
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(
      '当前文档已经生成条目；如需改变结构，请使用“调整已经拆分的结构”。',
      {exact: true},
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', {name: '当前全文', exact: true}),
  ).toHaveCount(0);
  await page.locator('summary').filter({hasText: '调整已经拆分的结构'}).focus();
  await page.keyboard.press('Enter');

  await expect(
    page.getByRole('heading', {name: '重新拆分已有条目', exact: true}),
  ).toBeVisible();
  const sourceText = page.getByLabel('条目 1 来源段 1 正文');
  await sourceText.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement))
      throw new Error('Expected a textarea.');
    element.focus();
    element.setSelectionRange(3, 3);
    element.dispatchEvent(new Event('select', {bubbles: true}));
    element.dispatchEvent(
      new KeyboardEvent('keyup', {bubbles: true, key: 'ArrowLeft'}),
    );
  });
  const splitAtCaret = page
    .getByRole('button', {name: '在光标处分开', exact: true})
    .first();
  await expect(splitAtCaret).toBeVisible();
  await expect(splitAtCaret).toBeEnabled();
  await clickVisibleUnobscured(splitAtCaret);
  const previewRestructure = page.getByRole('button', {
    name: '预览修改',
    exact: true,
  });
  await expect(previewRestructure).toBeVisible();
  await expect(previewRestructure).toBeEnabled();
  await clickVisibleUnobscured(previewRestructure);

  await expect(
    page.getByRole('heading', {name: '本次将发生什么', exact: true}),
  ).toBeVisible({timeout: 15_000});
  await expect(page.getByText('1 → 2 条', {exact: true})).toBeVisible();
  const applyRestructure = page.getByRole('button', {
    name: '保存重新拆分',
    exact: true,
  });
  await expect(applyRestructure).toBeVisible();
  await expect(applyRestructure).toBeEnabled();
  await clickVisibleUnobscured(applyRestructure);
  await expect(page.getByText('条目结构已更新', {exact: true})).toBeVisible({
    timeout: 15_000,
  });

  const previewWrite = restructureRequests.find(
    (request) =>
      request.path.endsWith('/preview') &&
      (JSON.parse(request.body) as {groups?: unknown}).groups !== undefined,
  );
  const applyWrite = restructureRequests.find((request) =>
    request.path.endsWith('/apply'),
  );
  expect(previewWrite).toBeDefined();
  expect(applyWrite).toBeDefined();
  expect(JSON.parse(applyWrite?.body ?? '{}')).toMatchObject({
    snapshotId: SNAPSHOT_ID,
    includePrivate: false,
    planSha256: '9'.repeat(64),
    acknowledgeAnnotationChanges: false,
    acknowledgeRelationshipChanges: false,
    groups: [
      {
        fragments: [
          {fragmentId: FRAGMENT_ID, startCodePoint: 0, endCodePoint: 2},
        ],
      },
      {
        fragments: [
          {fragmentId: FRAGMENT_ID, startCodePoint: 2, endCodePoint: 3},
        ],
      },
    ],
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
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
    if (message.type() === 'error') errors.push(message.text());
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
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '查询', exact: true})
    .click();
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
  const query = navigation.getByRole('button', {name: '查询', exact: true});
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

test('floats query tools without resizing the reading area and preserves drafts', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const fixture = await installSavedQueryApi(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await openWorkspace(page, '查询');
  await expect(page.getByRole('region', {name: '条目查询结果'})).toBeVisible();

  for (const width of [320, 768, 1024, 1440, 2220]) {
    await page.setViewportSize({width, height: 1000});
    const triggers = page.locator(
      '.query-studio-settings .floating-tool-panel__trigger',
    );
    await expect(triggers).toHaveCount(3);
    for (const trigger of await triggers.all()) {
      await trigger.scrollIntoViewIfNeeded();
      const before = await page.locator('.query-studio-results').boundingBox();
      const documentHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const surface = page.locator(
        '.floating-tool-panel__surface:popover-open',
      );
      await expect(surface).toHaveCount(1);
      const after = await page.locator('.query-studio-results').boundingBox();
      expect(after).toEqual(before);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBe(documentHeight);
      const bounds = await surface.boundingBox();
      if (bounds === null) throw new Error('Floating tools are missing.');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000);
      expect(
        await surface.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.keyboard.press('Tab');
      await expect(surface.getByRole('button', {name: /^收起/u})).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    }
  }

  await page.setViewportSize({width: 1440, height: 900});
  const saved = await openSavedQueryPanel(page);
  const savedTrigger = saved.getByRole('button', {name: /^保存的查询/u});
  await saved.getByRole('textbox', {name: '查询名称'}).fill('合成悬浮菜单草稿');
  await openQuerySettings(page);
  await expect(savedTrigger).toHaveAttribute('aria-expanded', 'false');
  const filter = page.locator('.query-filter-drawer');
  const filterSurface = filter.locator('.floating-tool-panel__surface');
  await expect(filterSurface).toBeVisible();
  const body = filterSurface.locator('.floating-tool-panel__body');
  expect(
    await body.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await filter.getByRole('combobox', {name: '隐私结果'}).selectOption('all');
  await expect(filter.getByRole('combobox', {name: '隐私结果'})).toHaveValue(
    'all',
  );
  await page.keyboard.press('Escape');
  await openQuerySettings(page);
  await expect(filter.getByRole('combobox', {name: '隐私结果'})).toHaveValue(
    'all',
  );
  await filter.getByRole('button', {name: '清除筛选', exact: true}).click();
  await page.keyboard.press('Escape');

  await openSavedQueryPanel(page);
  await expect(saved.getByRole('textbox', {name: '查询名称'})).toHaveValue(
    '合成悬浮菜单草稿',
  );
  await savedTrigger.click();
  await expect(savedTrigger).toHaveAttribute('aria-expanded', 'false');
  await savedTrigger.focus();
  await savedTrigger.press('Enter');
  await expect(savedTrigger).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('searchbox', {name: '搜索信息条目'}).click();
  await expect(savedTrigger).toHaveAttribute('aria-expanded', 'false');

  await openQuerySettings(page, '索引维护');
  const indexTrigger = page.getByRole('button', {
    name: '索引维护',
    exact: true,
  });
  const indexSurface = page.locator(
    '.floating-tool-panel__surface:popover-open',
  );
  const repair = indexSurface.locator('summary');
  await repair.click();
  await repair.click();
  await expect(indexTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(indexSurface).toBeVisible();
  await indexSurface
    .getByRole('button', {name: '读取状态', exact: true})
    .click();
  await expect(
    indexSurface.getByRole('button', {name: '读取状态', exact: true}),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(indexTrigger).toBeFocused();

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
    await openSavedQueryPanel(page);
    await page.screenshot({
      path: testInfo.outputPath('floating-tools-' + colorScheme + '.png'),
    });
    await saved.getByRole('button', {name: /^收起/u}).click();
    await expect(savedTrigger).toHaveAttribute('aria-expanded', 'false');
  }
  expect(fixture.writes).toEqual([]);
  expect(errors).toEqual([]);
});

async function openSavedQueryPanel(page: Page) {
  const panel = page.locator('.saved-query-panel');
  const trigger = panel.getByRole('button', {name: /^保存的查询/u});
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
  return panel;
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
  const nav = page.getByRole('navigation', {name: '产品工作区'});
  await nav.getByRole('button', {name: '查询', exact: true}).click();
  await openQuerySettings(page);
  await page
    .getByRole('searchbox', {name: '搜索信息条目'})
    .fill('合成检索条件');
  await expect(page.getByText('条件已更改', {exact: true})).toHaveCount(0);
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
  await nav.getByRole('button', {name: '查询', exact: true}).click();
  await openQuerySettings(page);
  await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption({label: '合成常用查询'});
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await expect(page.getByRole('searchbox', {name: '搜索信息条目'})).toHaveValue(
    '合成检索条件',
  );
  await page.getByRole('button', {name: '出处与文档', exact: true}).click();
  await expect(
    page.getByText(SYNTHETIC_FRAGMENT_TEXT, {exact: true}).first(),
  ).toBeVisible();
  expect(sourceReads.at(-1)).toContain(SNAPSHOT_ID);
  expect(sourceReads.at(-1)).not.toContain('includePrivate=true');
  await page.getByRole('button', {name: '关闭来源原文'}).click();
  await expect(page.getByRole('searchbox', {name: '搜索信息条目'})).toHaveValue(
    '合成检索条件',
  );
  await page.getByRole('button', {name: '在图谱中查看', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '专题', exact: true}),
  ).toBeVisible();
  expect(graphReads.at(-1)).toMatchObject({
    centerEntryId: ENTRY_ID,
    includePrivate: false,
  });
  await page.getByRole('button', {name: '返回查询', exact: true}).click();
  await expect(page.getByRole('searchbox', {name: '搜索信息条目'})).toHaveValue(
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
    .getByRole('searchbox', {name: '搜索信息条目'})
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
  await nav.getByRole('button', {name: '查询', exact: true}).click();
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
  await page.getByRole('button', {name: '按保存的隐私范围打开'}).click();
  await expect.poll(() => searches.at(-1)?.onlyPrivate).toBe(true);
  await expect.poll(() => fixture.reads.at(-1)?.includePrivate).toBe(true);
  await openWorkspace(page, '总览', nav);
  const previousPrivateCalls = searches.filter(
    (query) => query.includePrivate === true,
  ).length;
  await nav.getByRole('button', {name: '查询', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '重新选择隐私范围'}),
  ).toBeVisible();
  expect(
    searches.filter((query) => query.includePrivate === true),
  ).toHaveLength(previousPrivateCalls);
  await page.getByRole('button', {name: '仅公开范围打开'}).click();
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
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '查询', exact: true})
    .click();
  await openQuerySettings(page);
  const panel = await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(WORKSPACE_ID);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
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
      const search = await page.locator('.query-studio-search').boundingBox();
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
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '查询', exact: true})
    .click();
  await openQuerySettings(page);
  const panel = await openSavedQueryPanel(page);
  await panel
    .getByRole('combobox', {name: '已保存查询'})
    .selectOption(WORKSPACE_ID);
  await panel.getByRole('button', {name: '打开查询', exact: true}).click();
  await page.getByRole('button', {name: '按保存的隐私范围打开'}).click();
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
    page.getByRole('heading', {name: '专题', exact: true}),
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
  if (await page.locator('.floating-tool-panel__surface:popover-open').count())
    await page.keyboard.press('Escape');
  const container = page
    .locator('.query-sidebar-section > details')
    .filter({has: page.locator('.entry-markdown-export')});
  if ((await container.getAttribute('open')) === null)
    await container.locator(':scope > summary').click();
  const panel = page.locator('.entry-markdown-export');
  if ((await panel.getAttribute('open')) === null)
    await panel.locator('summary').click();
  return panel;
}
async function openQueryForExport(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '查询', exact: true})
    .click();
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
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
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
    .getByRole('searchbox', {name: '搜索信息条目'})
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
    .getByRole('searchbox', {name: '搜索信息条目'})
    .fill('合成新的查询条件');
  await openMarkdownExportPanel(page);
  await expect(
    panel.getByRole('button', {name: '加入资料清单'}),
  ).toBeDisabled();
  await page
    .locator('.query-sidebar-section > details > summary')
    .filter({hasText: '更多工具'})
    .click();
  await expect(
    page.getByRole('button', {name: '加入比较', exact: true}),
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', {name: '开启或关闭关联联想'}),
  ).toBeDisabled();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toHaveCount(0);
  await page.clock.fastForward(301);
  await expect(panel.getByRole('button', {name: '加入资料清单'})).toBeEnabled();
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
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
  await expect(page.locator('.entry-pagination')).toContainText('第 2 页');
  await page.getByRole('searchbox', {name: '搜索信息条目'}).press('Enter');
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
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByRole('region', {name: '条目查询结果'})).toContainText(
    '合成导出条目 2',
  );
  await expect(page.locator('.entry-pagination')).toContainText('第 2 页');
});

test('loads an out-of-page association candidate and clears it when selection scope changes', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  const writes: {path: string; body: Record<string, unknown>}[] = [];
  const policy = {
    revision: 0,
    version: 'struinfo.entry-association.local-index.v1',
    contentWeight: 65,
    typeWeight: 15,
    domainWeight: 20,
    threshold: 1100,
    candidateLimit: 12,
    adjustmentStep: 1500,
  };
  await page.route('**/api/v1/entries/*/associations**', async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({json: {status: 'applied'}});
      return;
    }
    await route.fulfill({
      json: {
        status: 'ok',
        entryId: ENTRY_ID,
        totalCount: 1,
        policy,
        associations: [
          {
            relatedEntry: SYNTHETIC_EXPLORATION_ENTRY,
            effectiveScore: 7600,
            isBlocked: false,
          },
        ],
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '联系');
  const editor = page.locator('.association-pair-editor');
  await expect(editor.getByRole('button', {name: '保存新联系'})).toBeDisabled();
  await page.getByRole('button', {name: '载入编辑区', exact: true}).click();
  await expect(editor).toContainText(
    SYNTHETIC_EXPLORATION_ENTRY.value.titlePath,
  );
  await expect(editor.getByRole('button', {name: '增强此联系'})).toBeEnabled();
  await editor.getByRole('button', {name: '增强此联系'}).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.path).toContain(EXPLORATION_ENTRY_ID);
  expect(writes[0]?.body).toMatchObject({
    expectedRevision: 0,
    action: 'enhance',
  });
  await page.getByRole('checkbox', {name: '查看隐私条目与联系'}).check();
  await expect(editor).not.toContainText(
    SYNTHETIC_EXPLORATION_ENTRY.value.titlePath,
  );
  await page.getByRole('button', {name: '载入编辑区', exact: true}).click();
  await expect(editor).toContainText(
    SYNTHETIC_EXPLORATION_ENTRY.value.titlePath,
  );
  await page.getByRole('searchbox', {name: '查找联系条目'}).fill('changed');
  await expect(editor).not.toContainText(
    SYNTHETIC_EXPLORATION_ENTRY.value.titlePath,
  );
  expect(writes).toHaveLength(1);
});

test('keeps type coverage and its correction controls within the available workspace', async ({
  page,
}, testInfo) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/entries/type-review', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        coverage: {
          totalCount: 15000,
          classifiedCount: 10793,
          missingCount: 4207,
          byType: [
            {typeKeyword: 'factual_material', count: 7000},
            {typeKeyword: 'other', count: 3793},
          ],
        },
        items: [SYNTHETIC_ENTRY],
      },
    }),
  );
  await page.goto('/');
  await openWorkspace(page, '标签');
  await page.getByRole('button', {name: '类型覆盖与纠错', exact: true}).click();
  const panel = page.locator('.type-review-workbench');
  await expect(panel).toContainText('4,207');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 1000});
    const overflow = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [
        ...element.querySelectorAll(
          '.type-coverage-summary, .type-review-workbench__body, input, select, button',
        ),
      ]
        .filter((child) => {
          const rect = child.getBoundingClientRect();
          return (
            rect.width > 0 &&
            (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          );
        })
        .map((child) => child.className || child.tagName);
    });
    expect(overflow, 'Type panel at ' + String(width)).toEqual([]);
    expect(await page.locator('main').count()).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('type-review-' + String(width) + '.png'),
      fullPage: true,
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
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '查询', exact: true})
    .click();
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
    expect((await textRegion.boundingBox())?.height).toBeLessThanOrEqual(500);
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
  const rail = page.getByRole('complementary', {name: '最近处理任务'});
  await expect(rail.locator('.ai-stage-list li')).toHaveCount(1);
  await expect(rail.locator('.ai-stage-list')).toContainText('03 / 标签');
  await expect(rail.locator('.ai-stage-list')).toContainText('已取消');
  await expect(rail).toContainText('没有待处理项');
  await expect(rail).not.toContainText('NaN');
  await expect(rail.locator('.ai-stage-list')).not.toContainText('处理中');
  status = 'succeeded';
  totalUnits = 1;
  await page.getByRole('button', {name: '刷新总览', exact: true}).click();
  await expect(rail.locator('.ai-stage-list')).toContainText('已完成');
  await expect(rail.locator('.ai-stage-list li')).toHaveCount(1);
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({width, height: 900});
    const navigation = page.getByRole('navigation', {name: '产品工作区'});
    for (const label of ['收件箱', '资料库', '专题', '查询', '设置']) {
      await expect(
        navigation
          .getByRole('button', {name: label, exact: true})
          .locator('strong'),
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
  const requestedSources: string[] = [];
  await page.route('**/api/v1/evidence/snapshots/*', (route) => {
    const snapshotId = new URL(route.request().url()).pathname
      .split('/')
      .at(-1);
    const snapshot = snapshots.find((value) => value.snapshotId === snapshotId);
    requestedSources.push(snapshotId ?? '');
    return route.fulfill({json: {status: 'ok', snapshot}});
  });
  await page.goto('/');
  await openWorkspace(page, '导入');
  const list = page.getByRole('list', {name: '本页文档'});
  const pagination = page.getByRole('combobox', {name: '文档列表页码'});
  await expect(list.locator(':scope > li')).toHaveCount(20);
  await pagination.selectOption('2');
  await expect(list.locator(':scope > li')).toHaveCount(5);
  await expect(list).toContainText('synthetic-document-045');
  const sourceButton = list
    .getByRole('button', {name: '查看原文', exact: true})
    .last();
  await sourceButton.click();
  await expect(page.locator('.evidence-rail')).toBeVisible();
  expect(requestedSources.at(-1)).toBe(snapshots[44]?.snapshotId);
  await page.keyboard.press('Escape');
  await expect(sourceButton).toBeFocused();
  const filter = page.getByRole('searchbox', {name: '筛选已导入文档'});
  await filter.fill('synthetic-document-001');
  await expect(list.locator(':scope > li')).toHaveCount(1);
  await expect(pagination).toHaveValue('0');
  await filter.fill('no-match');
  await expect(list.locator(':scope > li')).toHaveCount(0);
  await expect(page.getByText('没有匹配的文档', {exact: true})).toBeVisible();
  await filter.fill('');
  await expect(list.locator(':scope > li')).toHaveCount(20);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.getByRole('button', {name: '下一页', exact: true}).click();
    await expect(pagination).toHaveValue('1');
    await expect(list).toContainText('synthetic-document-021');
    await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(0);
    expect((await list.boundingBox())?.height).toBeLessThanOrEqual(500);
    await page.getByRole('button', {name: '上一页', exact: true}).click();
  }
});

test('keeps subscription save outside a long scrollable list and locates new drafts', async ({
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
  let subscriptions = Array.from({length: 12}, (_, index) => ({
    subscriptionId:
      String(index).padStart(8, '0') + '-0000-4000-8000-000000000012',
    kind: 'rss_atom',
    label: 'Synthetic subscription ' + String(index + 1),
    enabled: false,
    sourceAlias: 'synthetic-' + String(index),
    isPrivate: false,
    routeAfterImport: false,
    intervalMinutes: 1440,
    feedUrl: 'https://example.invalid/feed-' + String(index),
    itemLimit: 20,
  }));
  let saves = 0;
  await page.route('**/api/v1/source-subscriptions', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        subscriptions: typeof subscriptions;
      };
      subscriptions = body.subscriptions;
      saves += 1;
      return route.fulfill({
        json: {status: 'applied', revision: saves, subscriptions},
      });
    }
    return route.fulfill({
      json: {
        status: 'ok',
        revision: saves,
        connectors: Array.from({length: 3}, (_, index) => ({
          connectorId: 'synthetic-connector-' + String(index),
          displayName:
            index === 0
              ? 'Synthetic' + 'LongConnectorName'.repeat(8)
              : 'Synthetic connector ' + String(index),
          origin: 'builtin',
          configurationMode: 'internal',
        })),
        subscriptions,
      },
    });
  });
  await page.goto('/');
  await openWorkspace(page, '导入');
  await page.getByRole('button', {name: '关闭手动导入'}).click();
  await page.getByRole('button', {name: '订阅信源', exact: true}).click();
  const list = page.getByRole('list', {name: '订阅列表'});
  await page.locator('summary').filter({hasText: '可用订阅渠道'}).click();
  const channels = page.getByLabel('可用订阅方式', {exact: true});
  await expect(channels.getByRole('listitem')).toHaveCount(3);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await expect(channels).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const last = list.locator(':scope > li').last();
    const disclosure = last.locator('summary');
    if (
      !(await last
        .locator('details')
        .evaluate((node) => node.hasAttribute('open')))
    )
      await disclosure.click();
    await last
      .getByRole('textbox', {name: '显示名称', exact: true})
      .fill('Synthetic edited ' + String(width));
    const save = page.getByRole('button', {name: '保存订阅设置', exact: true});
    expect(
      await save.evaluate((node) => !node.closest('.source-subscription-list')),
    ).toBe(true);
    expect((await list.boundingBox())?.height).toBeLessThanOrEqual(540);
    await save.click();
    await expect(page.getByText('订阅已保存', {exact: true})).toBeVisible();
    expect(subscriptions.at(-1)?.label).toBe(
      'Synthetic edited ' + String(width),
    );
  }
  expect(saves).toBe(3);
  await page.getByRole('button', {name: '新增订阅', exact: true}).click();
  const draft = list.locator(':scope > li').last();
  await expect(
    draft.getByRole('textbox', {name: '显示名称', exact: true}),
  ).toBeFocused();
  await draft.getByRole('button', {name: '删除', exact: true}).click();
  await expect(list.locator(':scope > li')).toHaveCount(12);
  await expect(
    page.getByRole('button', {name: '保存订阅设置', exact: true}),
  ).toBeDisabled();
});

test('aligns selection and detail columns while keeping the editor keyboard reachable', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/entries/search', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        totalCount: 2,
        items: [SYNTHETIC_ENTRY, SYNTHETIC_EXPLORATION_ENTRY].map((entry) => ({
          entry,
          matchReasons: [],
          filterReasons: [],
        })),
        privateDocuments: {totalCount: 0, items: []},
      },
    }),
  );
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  for (const name of ['拆分', '标签', '查询']) {
    await openWorkspace(page, name, navigation);
    const list = page.locator('.entry-result-list');
    const detail = page.getByRole('region', {
      name: '所选条目详情',
      exact: true,
    });
    await expect(list).toBeVisible();
    await expect(detail).toBeVisible();
    const listBounds = await list.boundingBox();
    const detailBounds = await detail.boundingBox();
    if (listBounds === null || detailBounds === null)
      throw new Error('Missing workspace columns');
    expect(
      Math.abs(listBounds.height - detailBounds.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(listBounds.y - detailBounds.y)).toBeLessThanOrEqual(1);
    expect(detailBounds.x).toBeGreaterThan(listBounds.x);
    expect(detailBounds.height).toBeLessThan(900);

    if (name === '标签') {
      await detail.focus();
      await page.keyboard.press('End');
      await expect
        .poll(() => detail.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(0);
      const save = page.getByRole('button', {name: '保存并继续', exact: true});
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await list.locator('ol button').last().click();
      await expect
        .poll(() => detail.evaluate((node) => node.scrollTop))
        .toBe(0);
    }
    await page.setViewportSize({width: 1024, height: 900});
    await expect
      .poll(async () => {
        const narrowList = await list.boundingBox();
        const narrowDetail = await detail.boundingBox();
        return (
          narrowList !== null &&
          narrowDetail !== null &&
          narrowDetail.y >= narrowList.y + narrowList.height
        );
      })
      .toBe(true);
    expect(
      (await list.locator('ol').boundingBox())?.height,
    ).toBeLessThanOrEqual(192);
    await page.setViewportSize({width: 390, height: 844});
    await expect(detail).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.setViewportSize({width: 1440, height: 900});
  }
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
  await page.getByRole('button', {name: 'AI 接入', exact: true}).click();
  const panel = page.locator('.ai-price-settings');
  const toggle = panel.getByRole('checkbox', {
    name: '仅在 DeepSeek 低价时段调用',
  });
  await toggle.check();
  await panel.getByRole('button', {name: '保存时段设置'}).click();
  await expect(panel.getByText('高峰 · 等待低价', {exact: true})).toBeVisible();
  await expect(panel.getByText(/北京时间 1\/2 12:00 后自动续跑/)).toBeVisible();
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
  if (label === '总览') {
    await page
      .getByRole('button', {name: 'StruInfo · 运行总览', exact: true})
      .click();
    return;
  }
  const current =
    label === '导入'
      ? '收件箱'
      : label === '知识'
        ? '专题'
        : ['拆分', '标签', '联系'].includes(label)
          ? '设置'
          : label;
  await navigation.getByRole('button', {name: current, exact: true}).click();
  if (label === '导入')
    await page.getByRole('button', {name: '手动导入', exact: true}).click();
  if (['拆分', '标签', '联系'].includes(label)) {
    await page
      .getByRole('button', {
        name: '处理流程',
        exact: true,
      })
      .click();
    await page
      .locator('summary')
      .filter({hasText: '批量处理与高级工具'})
      .click();
    const actions: Record<string, string> = {
      拆分: '批量结构工具',
      标签: '批量标签与待处理队列',
      联系: '联系维护',
    };
    await page
      .getByRole('button', {name: actions[label] ?? label, exact: true})
      .click();
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
  const paper = page.locator('.document-paper');
  await expect(paper).toContainText(SYNTHETIC_ENTRY.value.titlePath);
  const before = await paper.boundingBox();
  if (before === null) throw Error('Reading paper missing');
  await page.getByRole('button', {name: '来源详情', exact: true}).click();
  await expect(
    page.getByRole('region', {name: '来源详情', exact: true}),
  ).toContainText('原文片段');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {name: '来源详情', exact: true}),
  ).toBeFocused();
  await page.getByRole('button', {name: '调整结构', exact: true}).click();
  const structure = page.getByRole('region', {name: '调整结构', exact: true});
  await expect(structure.getByLabel('条目 1 来源段 1 正文')).toHaveValue(
    SYNTHETIC_FRAGMENT_TEXT,
  );
  await structure.getByLabel('条目标题', {exact: true}).fill('合成修订标题');
  await structure.getByRole('button', {name: '预览修改', exact: true}).click();
  await expect(
    structure.getByRole('heading', {name: '本次将发生什么'}),
  ).toBeVisible();
  expect(JSON.parse(restructureRequests.at(-1)?.body ?? '{}')).toMatchObject({
    snapshotId: SNAPSHOT_ID,
    includePrivate: false,
    groups: [{titlePath: '合成修订标题'}],
  });
  await structure.locator('summary').filter({hasText: '结构规则'}).click();
  expect(
    await structure
      .locator('.workspace-tool-panel__content')
      .evaluate((e) => e.scrollWidth - e.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('button', {name: '关闭调整结构'}).click();
  await page.getByRole('button', {name: '添加标签', exact: true}).click();
  const tags = page.getByRole('region', {name: '添加标签', exact: true});
  const keywords = tags.getByLabel('内容关键词（逗号或换行分隔）');
  await keywords.fill('合成关键词');
  await tags
    .getByRole('combobox', {name: '主领域', exact: true})
    .selectOption('engineering_computing');
  await page.getByRole('button', {name: '关闭添加标签'}).click();
  await page.getByRole('button', {name: '建立联系', exact: true}).click();
  await expect(
    page
      .getByRole('region', {name: '建立联系', exact: true})
      .locator('.knowledge-inspector'),
  ).toBeVisible();
  await page.getByRole('button', {name: '关闭建立联系'}).click();
  await page.getByRole('button', {name: '添加标签', exact: true}).click();
  await expect(keywords).toHaveValue('合成关键词');
  const after = await paper.boundingBox();
  expect(after?.width).toBeCloseTo(before.width, 1);
  await tags.locator('summary').filter({hasText: '整篇文档标签'}).click();
  await expect(
    tags.getByRole('button', {name: '按全文重新聚合'}),
  ).toBeVisible();
  await tags.getByRole('button', {name: '保存标注', exact: true}).click();
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
    page.getByRole('heading', {name: '资料库', exact: true}),
  ).toBeVisible();
});

test('persists sidebar order and theme, keeps hidden actions reachable and preserves a conflicting draft', async ({
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
  const nav = page.getByRole('navigation', {name: '产品工作区'});
  await nav.getByRole('button', {name: '设置', exact: true}).click();
  const documents = page.getByRole('group', {name: '资料库', exact: true});
  await documents
    .getByRole('checkbox', {name: '建立联系', exact: true})
    .uncheck();
  await page
    .getByRole('button', {name: '资料库调整结构上移', exact: true})
    .click();
  await page
    .getByRole('group', {name: '查询', exact: true})
    .getByRole('checkbox', {name: '资料清单与导出', exact: true})
    .uncheck();
  await page.getByRole('combobox', {name: '默认外观'}).selectOption('dark');
  await page.getByRole('button', {name: '保存页面设置', exact: true}).click();
  await expect(page.getByText('页面设置已保存。', {exact: true})).toBeVisible();
  expect(writes[0]?.sidebars.documents).toEqual([
    'structure',
    'source',
    'tags',
  ]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const rail = page.locator('.document-tool-area > .workspace-action-rail');
  await expect(rail.locator('ol > li > button')).toHaveText([
    '调整结构',
    '来源详情',
    '添加标签',
  ]);
  await expect(
    rail.getByRole('button', {name: '建立联系', exact: true}),
  ).toBeHidden();
  await rail.locator('summary').filter({hasText: '更多操作'}).click();
  await expect(
    rail.getByRole('button', {name: '建立联系', exact: true}),
  ).toBeVisible();
  await nav.getByRole('button', {name: '查询', exact: true}).click();
  const sidebar = page.getByRole('complementary', {name: '阅读与资料工具'});
  await expect(
    sidebar
      .locator('.query-sidebar-section > details > summary')
      .filter({hasText: '资料清单与导出'}),
  ).toBeHidden();
  await sidebar.locator('summary').filter({hasText: '更多操作'}).click();
  await sidebar
    .locator('.query-sidebar-section > details > summary')
    .filter({hasText: '资料清单与导出'})
    .click();
  await expect(
    sidebar.getByRole('button', {name: '加入资料清单', exact: true}),
  ).toBeVisible();
  await nav.getByRole('button', {name: '设置', exact: true}).click();
  conflict = true;
  await page.getByRole('combobox', {name: '默认外观'}).selectOption('light');
  await page.getByRole('button', {name: '保存页面设置', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('当前草稿仍然保留');
  await expect(page.getByRole('combobox', {name: '默认外观'})).toHaveValue(
    'light',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', {name: '重新读取页面设置'}).click();
  await expect(page.getByRole('combobox', {name: '默认外观'})).toHaveValue(
    'dark',
  );
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
      maxRelations: 2,
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
    if (operation.startsWith('ai_price_')) {
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
  const nav = page.getByRole('navigation', {name: '产品工作区'});
  await nav.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: 'AI 接入', exact: true}).click();
  const panel = page.locator('.settings-content .ai-workflow-panel');
  await expect(
    panel.getByText('内部模型：未配置', {exact: true}),
  ).toBeVisible();
  await panel.locator('summary').filter({hasText: '处理范围与预算'}).click();
  await panel
    .getByRole('spinbutton', {name: '每日新文档', exact: true})
    .fill('7');
  await expect(
    panel.getByRole('button', {name: '保存处理策略', exact: true}),
  ).toBeDisabled();
  configured = true;
  await panel.getByRole('button', {name: '刷新处理状态', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '保存处理策略', exact: true}),
  ).toBeEnabled();
  await expect(
    panel.getByRole('spinbutton', {name: '每日新文档', exact: true}),
  ).toHaveValue('7');
  await panel
    .getByRole('combobox', {name: '自动处理状态筛选'})
    .selectOption('completed');
  await expect(
    panel.getByText(
      '当前没有符合条件的记录。新资料进入授权范围后会出现在这里。',
    ),
  ).toBeVisible();
  await expect(
    panel.getByRole('spinbutton', {name: '每日新文档', exact: true}),
  ).toHaveValue('7');
  await panel.getByRole('button', {name: '暂停自动处理', exact: true}).click();
  await expect(
    panel.getByRole('button', {name: '恢复自动处理', exact: true}),
  ).toBeVisible();
  expect(writes[0]).toMatchObject({
    expectedRevision: 1,
    settings: {paused: true, maxDocumentsPerDay: 10},
  });
  await panel.getByRole('button', {name: '保存处理策略', exact: true}).click();
  await expect(
    panel.getByRole('spinbutton', {name: '每日新文档', exact: true}),
  ).toHaveValue('7');
  await expect(
    panel.getByText('服务器策略已变化，当前草稿保留。可重新读取最新策略。'),
  ).toBeVisible();
  await panel.getByRole('button', {name: '重新读取策略', exact: true}).click();
  await expect(
    panel.getByRole('spinbutton', {name: '每日新文档', exact: true}),
  ).toHaveValue('10');
  await panel
    .getByRole('combobox', {name: '自动处理状态筛选'})
    .selectOption('attention');
  await panel.getByRole('button', {name: '重试 / 继续', exact: true}).click();
  expect(controls[0]).toMatchObject({
    snapshotId: SNAPSHOT_ID,
    expectedVersion: 1,
    action: 'retry',
  });
  await panel
    .getByRole('combobox', {name: '自动处理状态筛选'})
    .selectOption('');
  await panel.getByRole('button', {name: '人工接管', exact: true}).click();
  expect(controls[1]).toMatchObject({
    snapshotId: SNAPSHOT_ID,
    expectedVersion: 2,
    action: 'take_over',
  });
  await expect(
    panel
      .getByRole('list', {name: '自动处理文档'})
      .getByText('已接管', {exact: false}),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [320, 800],
  ] as const) {
    await page.setViewportSize({width, height});
    await page.emulateMedia({
      colorScheme: width === 1440 ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.locator('.settings-content').evaluate((el) => {
      el.scrollTop = 0;
    });
    if (process.env.STRUIINFO_UI_EVIDENCE_ROOT)
      await page.screenshot({
        path:
          process.env.STRUIINFO_UI_EVIDENCE_ROOT +
          '/ai-settings-' +
          width.toString() +
          '.png',
        fullPage: true,
      });
  }
});

test('AI task details distinguish completed no-relation evaluations from written edges', async ({
  page,
}) => {
  await installCurrentProductApi(page);
  await page.route('**/api/v1/*/commands', async (route) => {
    const {operation} = route.request().postDataJSON() as {operation: string};
    if (operation.startsWith('ai_price_')) {
      await route.fallback();
      return;
    }
    const result =
      operation === 'system_status'
        ? {role: 'all', model: 'synthetic-model', grants: []}
        : operation === 'tasks_list'
          ? [
              {
                taskId: SNAPSHOT_ID,
                version: 1,
                request: {kind: 'document'},
                state: {
                  status: 'succeeded',
                  phase: 'complete',
                  calls: 3,
                  steps: [
                    {complete: true},
                    {complete: true},
                    {complete: true, outcome: 'no_relation'},
                  ],
                },
              },
            ]
          : operation === 'ingestion_status'
            ? {
                policy: {
                  revision: 0,
                  settings: {
                    enabled: false,
                    paused: false,
                    subscriptionIds: [],
                    manualUploads: false,
                    model: 'synthetic-model',
                    maxEntries: 8,
                    maxRelations: 2,
                    maxModelCalls: 14,
                    maxDocumentsPerDay: 3,
                  },
                },
                modelConfigured: true,
                summary: {counts: {}, admittedToday: 0, modelAttempts: 0},
                items: [],
              }
            : [];
    await route.fulfill({json: {result}});
  });
  await page.goto('/');
  await page
    .getByRole('navigation', {name: '产品工作区'})
    .getByRole('button', {name: '设置', exact: true})
    .click();
  await page.getByRole('button', {name: 'AI 接入', exact: true}).click();
  const panel = page.locator('.settings-content .ai-workflow-panel');
  await panel
    .locator('summary')
    .filter({hasText: '独立任务与阶段明细'})
    .click();
  await expect(
    panel.getByText('未建立联系：1 对候选缺少明确依据。'),
  ).toBeVisible();
  await expect(panel.getByText(/3\/3 步/)).toBeVisible();
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
  const workspace = page.getByRole('region', {name: '日报与周报'});
  await workspace.getByLabel('报告日期', {exact: true}).fill('2040-01-02');
  await workspace.getByRole('button', {name: '预览材料', exact: true}).click();
  await expect(
    workspace.getByText('2 条符合条件 · 已排除 2 条重复记录'),
  ).toBeVisible();
  await workspace.getByRole('button', {name: '新建日报 · 2 条材料'}).click();
  expect(created[0]).toMatchObject({
    request: {
      date: '2040-01-02',
      selectedEntryIds: [ENTRY_ID, otherSource.entryId],
    },
  });
  await workspace.getByRole('button', {name: '生成草稿', exact: true}).click();
  await expect(workspace.getByText('核心结论', {exact: true})).toHaveCount(0);
  await expect(workspace.locator('.report-history-item')).not.toBeVisible();
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
    page.getByRole('heading', {name: '资料库', exact: true}),
  ).toBeVisible();
  await openWorkspace(page, '报告');
  await expect(
    workspace.getByText('由合成材料支持的摘要与上下文。'),
  ).toBeVisible();
  const history = workspace.getByRole('button', {name: /^报告历史 ·/});
  await history.click();
  await expect(workspace.locator('.report-history-item')).toBeVisible();
  await workspace.locator('.report-history-item').click();
  await expect(history).toHaveAttribute('aria-expanded', 'false');
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
  const resume = workspace.getByRole('button', {name: '继续编辑', exact: true});
  await expect(resume).toBeFocused();
  await expect(
    workspace.getByRole('button', {name: '新建报告', exact: true}),
  ).toBeDisabled();
  await resume.click();
  await expect(
    editor.getByRole('textbox', {name: '摘要 1', exact: true}),
  ).toHaveValue('人工检查了合成原文的上下文。');
  await editor
    .getByRole('button', {name: '[1] Synthetic report article', exact: true})
    .click();
  await expect(
    page.getByRole('heading', {name: '资料库', exact: true}),
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
  await expect(workspace.getByText('已人工核对，可导出使用。')).toBeVisible();
  await expect(
    workspace.getByText('人工检查了合成原文的上下文。'),
  ).toBeVisible();
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
  const workspace = page.getByRole('region', {name: '日报与周报'});
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
      '本周期暂无可用材料。可调整日期，或先在收件箱审核、入库。',
    ),
  ).toBeVisible();
  await workspace
    .getByLabel('本周中的任意日期', {exact: true})
    .fill('2040-01-09');
  await expect(workspace.getByRole('region', {name: '选材预览'})).toHaveCount(
    0,
  );
  await expect(
    workspace.getByRole('button', {name: '新建周报', exact: true}),
  ).toBeDisabled();
});

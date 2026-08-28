import {Buffer} from 'node:buffer';

import {expect, test, type Locator, type Page} from '@playwright/test';

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

test('exposes only the current document-to-entry workflow', async ({page}) => {
  const productRequests = await installCurrentProductApi(page);
  await page.goto('/');

  await expect(
    page.getByRole('heading', {name: '总览', exact: true}),
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
      instructions: ['从左侧选择来源文档', '从右侧拆分并保存结构'],
    },
    {
      name: '标签',
      guide: '标签页操作指南',
      instructions: ['先选择文档，再选择条目', '检查关键词并完成评分'],
    },
    {
      name: '联系',
      guide: '联系页操作指南',
      instructions: ['分别从两侧选择条目', '确认后保存联系与权重'],
    },
    {
      name: '查询',
      guide: '查询页操作指南',
      instructions: ['输入关键词并调整右侧条件', '在中间查看正文与来源'],
    },
    {
      name: '知识',
      guide: '知识页操作指南',
      instructions: ['从右侧选择中心条目', '在底部检查并编辑关系'],
    },
  ] as const;

  for (const section of sections) {
    await navigation
      .getByRole('button', {name: section.name, exact: true})
      .click();
    await expect(
      page.getByRole('heading', {name: section.name, exact: true}),
    ).toBeVisible();
    const guide = page.getByLabel(section.guide, {exact: true});
    await expect(guide).toBeVisible();
    for (const instruction of section.instructions) {
      await expect(guide).toContainText(instruction);
    }
  }
  await expect(page.getByRole('region', {name: '选择知识中心'})).toBeVisible();
  await expect(page.getByRole('group', {name: 'Entry 关系图'})).toBeVisible();

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
  await navigation.getByRole('button', {name: '导入', exact: true}).click();
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
  await page
    .getByRole('button', {name: '保存来源 Snapshot', exact: true})
    .click();
  await expect(page.getByText('导入命令发生冲突', {exact: true})).toBeVisible();

  await page
    .getByRole('button', {name: '保存来源 Snapshot', exact: true})
    .click();
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
  await navigation.getByRole('button', {name: '导入', exact: true}).click();
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
  await navigation.getByRole('button', {name: '导入', exact: true}).click();
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
  await navigation.getByRole('button', {name: '联系', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '联系策略权重', exact: true}),
  ).toBeVisible();

  await page.getByLabel('内容相似度数值').fill('50');
  await page.getByLabel('类型相似度数值').fill('25');
  await page.getByLabel('领域相似度数值').fill('25');
  await page
    .getByRole('button', {name: '保存权重并重建联系', exact: true})
    .click();
  await expect(
    page.getByText('联系策略已保存并生效', {exact: true}),
  ).toBeVisible();

  await navigation.getByRole('button', {name: '查询', exact: true}).click();
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
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');

  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  await navigation.getByRole('button', {name: '查询', exact: true}).click();
  await page
    .locator('.query-result-tools-drawer > summary', {
      hasText: '更多结果工具',
    })
    .click();

  await expect(
    page.getByRole('heading', {name: '探索候选', exact: true}),
  ).toBeVisible();
  const generate = page.getByRole('button', {
    name: '生成探索候选',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', {name: /启用独立探索/u}).check();
  await page.getByLabel('当前页探索份额').fill('50');
  await page.getByRole('button', {name: '保存探索策略', exact: true}).click();
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
  await expect(page.getByText('独立于搜索排序', {exact: false})).toBeVisible();
  for (const viewport of [
    {width: 320, height: 720},
    {width: 390, height: 844},
    {width: 768, height: 900},
    {width: 1024, height: 900},
    {width: 1440, height: 1000},
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('heading', {name: '探索候选', exact: true}),
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
    page.getByText('探索不会自动运行；选择锚点后由你明确启动。', {
      exact: true,
    }),
  ).toBeHidden();
  await page
    .locator('.query-result-tools-drawer > summary', {
      hasText: '更多结果工具',
    })
    .click();
  await expect(
    page.getByText('探索不会自动运行；选择锚点后由你明确启动。', {
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
  await navigation.getByRole('button', {name: '标签', exact: true}).click();
  const tagsTools = page.locator('.tags-studio-grid__rules');
  await expect(tagsTools.getByText('点击展开', {exact: true})).toHaveCount(3);
  await page.getByText('偏好规则', {exact: true}).click();
  await expect(
    page.getByRole('heading', {name: '可解释偏好规则', exact: true}),
  ).toBeVisible();

  const privateScope = page.getByRole('checkbox', {
    name: '本次候选与试运行包含隐私 Entry',
    exact: true,
  });
  const generate = page.getByRole('button', {
    name: '生成候选',
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
      page.getByRole('heading', {name: '可解释偏好规则', exact: true}),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
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
  await navigation.getByRole('button', {name: '标签', exact: true}).click();
  await page.getByText('自动分流', {exact: true}).click();
  const panel = page.locator('.entry-automation-policy');
  await expect(
    panel.getByRole('heading', {name: '可恢复自动分流', exact: true}),
  ).toBeVisible();
  await expect(panel.getByText('aaaaaaaa…aaaa', {exact: true})).toBeVisible();
  await expect(
    panel.getByRole('checkbox', {
      name: '推进候选后生成确定性标签',
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
      '两项默认关闭，仅作用于“建议继续处理”。确定性标签遵守排除词与别名；联系重建不覆盖人工联系和知识图谱边。',
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
    .getByRole('button', {name: /读取运行 cccccccc…cccc 的完整审计/u})
    .click();
  await expect(
    panel.getByRole('heading', {name: '完整运行审计', exact: true}),
  ).toBeVisible();
  await expect(
    panel.getByText(
      '全部分流事实已经结算；本运行只记录去向，没有改写任何业务内容。',
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
      panel.getByRole('heading', {name: '完整运行审计', exact: true}),
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
  await navigation.getByRole('button', {name: '拆分', exact: true}).click();
  await page
    .getByRole('button', {name: /synthetic-split-source/u})
    .first()
    .click();
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
  await navigation.getByRole('button', {name: '拆分', exact: true}).click();
  await page
    .getByRole('button', {name: /synthetic-split-source/u})
    .first()
    .click();
  await page
    .locator('.workflow-tool-drawer > summary', {
      hasText: '结构规则',
    })
    .click();

  const panel = page.locator('.split-rule-panel');
  await expect(
    panel.getByRole('heading', {name: '可替换的本地拆分规则', exact: true}),
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
  await navigation.getByRole('button', {name: '拆分', exact: true}).click();
  await page
    .getByRole('button', {name: /synthetic-split-source/u})
    .first()
    .click();
  await page
    .locator('.workflow-tool-drawer > summary', {
      hasText: '调整已经拆分的结构',
    })
    .click();

  await expect(
    page.getByRole('heading', {name: '已生成条目重组', exact: true}),
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
    name: '预览重组影响',
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
    name: '应用重组',
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

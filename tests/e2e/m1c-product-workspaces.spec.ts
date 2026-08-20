import {expect, test, type Page} from '@playwright/test';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const STRUCTURE_ID = '44444444-4444-4444-8444-444444444444';
const FRAGMENT_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_FRAGMENT_ID = '55555555-5555-4555-8555-555555555556';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';
const REVISION_ID = '77777777-7777-4777-8777-777777777777';

const snapshotSummary = {
  workspaceId: WORKSPACE_ID,
  snapshotId: SNAPSHOT_ID,
  resourceId: RESOURCE_ID,
  resourceKind: 'manual_text',
  sourceKey: '合成来源',
  canonicalUri: 'https://example.invalid/synthetic-source',
  capturedAt: '2026-08-16T00:00:00.000Z',
  fragmentCount: 2,
} as const;

const evidenceSnapshot = {
  ...snapshotSummary,
  rawSha256: '1'.repeat(64),
  canonicalContentSha256: '2'.repeat(64),
  canonicalizationVersion: 'canonical-markdown-v1',
  mediaType: 'text/markdown',
  structures: [
    {
      structureId: STRUCTURE_ID,
      parserName: 'commonmark',
      parserVersion: '1',
      textNormalizationVersion: 'nfc-lf-v1',
      structureSha256: '3'.repeat(64),
      textBlob: {
        algorithm: 'sha256',
        digest: '4'.repeat(64),
        byteLength: 31,
      },
      normalizedText:
        '# 合成材料\n\n可精确回溯的合成摘录。\n\n## 第二条\n\n等待下一步审核。',
      fragments: [
        {
          fragmentId: FRAGMENT_ID,
          structureId: STRUCTURE_ID,
          nodeId: 'synthetic-node-1',
          nodeKind: 'section',
          codePointRange: {start: 8, end: 20},
          lineRange: {start: 3, end: 3},
          selectedTextSha256: '5'.repeat(64),
          selectedText:
            '[DOCX Editor](https://github.com/eigenpal/docx-editor)\n\n可精确回溯的合成摘录。',
        },
        {
          fragmentId: SECOND_FRAGMENT_ID,
          structureId: STRUCTURE_ID,
          nodeId: 'synthetic-node-2',
          nodeKind: 'section',
          codePointRange: {start: 22, end: 39},
          lineRange: {start: 5, end: 7},
          selectedTextSha256: '9'.repeat(64),
          selectedText: '第二条\n\n等待下一步审核。',
        },
      ],
    },
  ],
} as const;

async function routeM1cApi(
  page: Page,
  onPost?: (path: string, body: unknown) => void,
  options: Readonly<{reviewPreferencesUnavailable?: boolean}> = {},
) {
  let curationReviewed = false;
  let persistedAction = 'needs_review';
  let persistedReasons: readonly string[] = [];
  let persistedNote: string | undefined;
  let persistedUsefulness = 2;
  let persistedInterest = 2;
  let queuedKnowledgeWritten = false;
  let queuedKnowledgeTitle = 'DOCX Editor';
  let queuedKnowledgeItemId = ITEM_ID;
  let queuedKnowledgeRevision = 1;
  let queuedKnowledgeKind = 'concept';
  let queuedKnowledgeRole = 'source_claim';
  let queuedKnowledgeState = 'confirmed';
  let queuedKnowledgeBody = '合成知识正文。';
  let queuedKnowledgeProvenance: Readonly<Record<string, unknown>> = {
    citations: [FRAGMENT_ID],
    fragmentDerivations: [],
    knowledgeDerivations: [],
  };
  let reviewQuickTags: readonly string[] = ['实用工具'];
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
      knowledgeKind: string;
    }>[],
  };
  const persistedTerms: Readonly<Record<string, unknown>>[] = [];
  const persistedTermIds = new Set<string>();
  await page.route('**/health/ready', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        schema_version: '1',
        service: 'struinfo',
        role: 'api',
        status: 'ready',
        checks: {database: 'ready'},
      },
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'POST' || method === 'PUT') {
      onPost?.(path, route.request().postDataJSON());
    }
    let json: unknown;
    if (path === '/api/v1/workspace') {
      json = {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        capabilities: ['manual-core', 'deterministic-search'],
      };
    } else if (path === '/api/v1/evidence') {
      json = {status: 'ok', snapshots: [snapshotSummary]};
    } else if (path === `/api/v1/evidence/snapshots/${SNAPSHOT_ID}`) {
      json = {status: 'ok', snapshot: evidenceSnapshot};
    } else if (path === '/api/v1/curation') {
      json = {
        status: 'ok',
        state: {
          terms: persistedTerms,
          targets: curationReviewed
            ? [
                {
                  workspaceId: WORKSPACE_ID,
                  targetId: '88888888-8888-4888-8888-888888888888',
                  currentVersion: 1,
                  kind: 'fragment',
                  fragmentId: FRAGMENT_ID,
                },
              ]
            : [],
          assignments: curationReviewed
            ? [...persistedTermIds].map((termId, index) => ({
                assignmentId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, '0')}`,
                targetId: '88888888-8888-4888-8888-888888888888',
                termId,
                state: 'assigned',
              }))
            : [],
          decisions: curationReviewed
            ? [
                {
                  decisionId: '99999999-9999-4999-8999-999999999999',
                  targetId: '88888888-8888-4888-8888-888888888888',
                  currentRevision: 1,
                  currentRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  value: {
                    action: persistedAction,
                    reasonCodes: persistedReasons,
                    ...(persistedNote === undefined
                      ? {}
                      : {note: persistedNote}),
                  },
                },
              ]
            : [],
          assessments: curationReviewed
            ? [
                {
                  assessmentId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
                  targetId: '88888888-8888-4888-8888-888888888888',
                  dimension: 'information_density',
                  currentRevision: 1,
                  value: {state: 'rated', score: persistedUsefulness},
                },
                {
                  assessmentId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
                  targetId: '88888888-8888-4888-8888-888888888888',
                  dimension: 'current_interest',
                  currentRevision: 1,
                  value: {state: 'rated', score: persistedInterest},
                },
              ]
            : [],
        },
      };
    } else if (path === '/api/v1/preferences/review' && method === 'GET') {
      if (options.reviewPreferencesUnavailable === true) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          json: {status: 'not_found'},
        });
        return;
      }
      json = {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        quickTags: reviewQuickTags,
        automaticKeywords,
        vocabulary,
      };
    } else if (path === '/api/v1/preferences/review' && method === 'PUT') {
      const body = route.request().postDataJSON() as {
        readonly quickTags: readonly string[];
        readonly automaticKeywords: typeof automaticKeywords;
        readonly vocabulary: typeof vocabulary;
      };
      reviewQuickTags = body.quickTags;
      automaticKeywords = body.automaticKeywords;
      vocabulary = body.vocabulary;
      json = {
        status: 'ok',
        workspaceId: WORKSPACE_ID,
        quickTags: reviewQuickTags,
        automaticKeywords,
        vocabulary,
      };
    } else if (path === '/api/v1/imports/markdown' && method === 'POST') {
      json = {
        status: 'created',
        workspaceId: WORKSPACE_ID,
        commandIdempotencyKey: 'synthetic-command',
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        structureId: STRUCTURE_ID,
        fragmentIds: [FRAGMENT_ID],
        intakeTargetFragmentIds: [FRAGMENT_ID],
        mediaAssetIds: [],
      };
    } else if (path === '/api/v1/curation/terms' && method === 'POST') {
      const body = route.request().postDataJSON() as {
        readonly request: {
          readonly termId: string;
          readonly value: Readonly<Record<string, unknown>>;
        };
      };
      persistedTerms.push({
        workspaceId: WORKSPACE_ID,
        termId: body.request.termId,
        currentRevision: 1,
        currentRevisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        value: body.request.value,
      });
      json = {status: 'applied', receipt: {outcome: 'applied'}};
    } else if (path === '/api/v1/curation/apply' && method === 'POST') {
      const body = route.request().postDataJSON() as {
        readonly request: {
          readonly operations: readonly Record<string, unknown>[];
        };
      };
      for (const operation of body.request.operations) {
        if (
          operation.kind === 'assign_classification' &&
          typeof operation.termId === 'string'
        ) {
          persistedTermIds.add(operation.termId);
        }
        if (operation.kind === 'set_intake_decision') {
          if (typeof operation.action === 'string') {
            persistedAction = operation.action;
          }
          if (Array.isArray(operation.reasonCodes)) {
            persistedReasons = operation.reasonCodes.filter(
              (value): value is string => typeof value === 'string',
            );
          }
          persistedNote =
            typeof operation.note === 'string' ? operation.note : undefined;
        }
        if (
          operation.kind === 'set_assessment' &&
          typeof operation.score === 'number'
        ) {
          if (operation.dimension === 'information_density') {
            persistedUsefulness = operation.score;
          }
          if (operation.dimension === 'current_interest') {
            persistedInterest = operation.score;
          }
        }
      }
      curationReviewed = true;
      json = {status: 'applied', receipt: {outcome: 'applied'}};
    } else if (path === '/api/v1/knowledge/change-sets' && method === 'POST') {
      const body = route.request().postDataJSON() as {
        readonly request?: {
          readonly authorization?: {readonly kind?: unknown};
          readonly operations?: readonly Readonly<{
            itemId?: unknown;
            expectedRevision?: unknown;
            value?: Readonly<{
              title?: unknown;
              body?: unknown;
              knowledgeKind?: unknown;
              epistemicRole?: unknown;
              reviewState?: unknown;
            }>;
            provenance?: Readonly<Record<string, unknown>>;
          }>[];
        };
      };
      if (body.request?.authorization?.kind === 'eligible_target') {
        queuedKnowledgeWritten = true;
        const operation = body.request.operations?.[0];
        const value = operation?.value;
        if (typeof value?.title === 'string')
          queuedKnowledgeTitle = value.title;
        if (typeof value?.body === 'string') queuedKnowledgeBody = value.body;
        if (typeof value?.knowledgeKind === 'string') {
          queuedKnowledgeKind = value.knowledgeKind;
        }
        if (typeof value?.epistemicRole === 'string') {
          queuedKnowledgeRole = value.epistemicRole;
        }
        if (typeof value?.reviewState === 'string') {
          queuedKnowledgeState = value.reviewState;
        }
        if (operation?.provenance !== undefined) {
          queuedKnowledgeProvenance = operation.provenance;
        }
        if (typeof operation?.itemId === 'string') {
          queuedKnowledgeItemId = operation.itemId;
        }
        if (typeof operation?.expectedRevision === 'number') {
          queuedKnowledgeRevision = operation.expectedRevision + 1;
        }
      }
      json = {status: 'applied', receipt: {outcome: 'applied'}};
    } else if (
      path === `/api/v1/knowledge/items/${queuedKnowledgeItemId}` &&
      method === 'GET' &&
      queuedKnowledgeWritten
    ) {
      json = {
        status: 'ok',
        item: {
          itemId: queuedKnowledgeItemId,
          revision: queuedKnowledgeRevision,
          revisionId: REVISION_ID,
          value: {
            knowledgeKind: queuedKnowledgeKind,
            epistemicRole: queuedKnowledgeRole,
            reviewState: queuedKnowledgeState,
            title: queuedKnowledgeTitle,
            body: queuedKnowledgeBody,
          },
          provenance: queuedKnowledgeProvenance,
        },
      };
    } else if (
      path === '/api/v1/workspace-bundles/export' &&
      method === 'POST'
    ) {
      json = {
        status: 'exported',
        fileName: 'synthetic.workspace-bundle.json',
        byteLength: 4096,
        sha256: '8'.repeat(64),
        blobCount: 2,
        tableCounts: {workspace: 1, snapshot: 10},
      };
    } else if (
      path === '/api/v1/workspace-bundles/restore' &&
      method === 'POST'
    ) {
      json = {
        status: 'restored',
        fileName: 'synthetic.workspace-bundle.json',
        byteLength: 4096,
        blobCount: 2,
        tableCounts: {workspace: 1, snapshot: 10},
      };
    } else if (path === '/api/v1/search') {
      const searchBody = route.request().postDataJSON() as {
        readonly includePrivate?: boolean;
        readonly request?: Readonly<{
          text?: unknown;
          filters?: Readonly<{
            source?: Readonly<{kind?: unknown; snapshotId?: unknown}>;
          }>;
          page?: Readonly<{limit?: unknown}>;
        }>;
      };
      const includePrivate = searchBody.includePrivate === true;
      const source = searchBody.request?.filters?.source;
      const isQueueCoverageRequest =
        searchBody.request?.text === undefined &&
        searchBody.request?.page?.limit === 100 &&
        source?.kind === 'snapshot' &&
        source.snapshotId === SNAPSHOT_ID;
      const searchItems =
        isQueueCoverageRequest && !queuedKnowledgeWritten
          ? []
          : [
              {
                itemId: isQueueCoverageRequest
                  ? queuedKnowledgeItemId
                  : ITEM_ID,
                revision: isQueueCoverageRequest ? queuedKnowledgeRevision : 1,
                revisionId: REVISION_ID,
                value: {
                  knowledgeKind: 'concept',
                  epistemicRole: 'source_claim',
                  reviewState: 'confirmed',
                  title: isQueueCoverageRequest
                    ? queuedKnowledgeTitle
                    : '确定性检索保留来源',
                  body: '合成知识正文。',
                },
                matchRank: isQueueCoverageRequest ? 4 : 1,
                textMatches: isQueueCoverageRequest
                  ? []
                  : [{field: 'title', kind: 'substring', rank: 1}],
                sourceMatches: [
                  {
                    inputKind: 'citation',
                    inputOrdinal: 0,
                    resourceId: RESOURCE_ID,
                    snapshotId: SNAPSHOT_ID,
                    fragmentId: FRAGMENT_ID,
                  },
                ],
                relationMatchCount: 0,
                relationMatches: [],
                relationMatchesTruncated: false,
              },
            ];
      json = {
        status: 'ok',
        querySha256: '6'.repeat(64),
        includePrivate,
        privateDocumentTotalCount: includePrivate ? 1 : 0,
        privateDocuments: includePrivate
          ? [
              {
                isPrivate: true,
                workspaceId: WORKSPACE_ID,
                resourceId: RESOURCE_ID,
                snapshotId: SNAPSHOT_ID,
                sourceKey: '合成隐私全文',
                capturedAt: '2026-08-16T00:00:00.000Z',
                fragmentCount: 2,
                matchKind: 'browse',
                excerpt: '完整隐私文档仍可单独查看。',
              },
            ]
          : [],
        totalCount: searchItems.length,
        items: searchItems,
      };
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        json: {status: 'not_found'},
      });
      return;
    }
    await route.fulfill({contentType: 'application/json', json});
  });
}

async function openProduct(
  page: Page,
  onPost?: (path: string, body: unknown) => void,
  options: Readonly<{reviewPreferencesUnavailable?: boolean}> = {},
) {
  await routeM1cApi(page, onPost, options);
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: '材料与证据', exact: true}),
  ).toBeVisible();
}

test.describe('M1C product workspaces', () => {
  test('exposes the four manual-first workspaces without fabricated AI state', async ({
    page,
  }) => {
    await openProduct(page);

    await expect(
      page.getByRole('button', {name: '材料', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {name: '审核', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {name: '知识维护', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {name: '搜索', exact: true}),
    ).toBeVisible();
    await expect(page.getByText('未启用', {exact: true})).toBeVisible();
    await expect(page.getByText('合成来源', {exact: true})).toBeVisible();

    await page.getByRole('button', {name: '查看证据', exact: true}).click();
    await page.getByRole('button', {name: '关闭来源档案'}).click();
    await page.getByRole('button', {name: '审核', exact: true}).click();
    await expect(
      page.getByRole('heading', {name: '审核与知识入库', exact: true}),
    ).toBeVisible();
    await expect(page.getByRole('slider', {name: '有用程度'})).toBeVisible();
    await expect(page.getByRole('slider', {name: '有趣程度'})).toBeVisible();
    await expect(
      page.getByRole('heading', {name: '自动标签提取'}),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {name: '标签与联系编辑'}),
    ).toBeVisible();
  });

  test('searches through the public boundary and opens the exact Fragment', async ({
    page,
  }) => {
    await openProduct(page);
    await page.getByRole('button', {name: '搜索', exact: true}).click();
    await page.getByText('结构化筛选').click();
    await page
      .locator('.search-filter-grid select')
      .nth(3)
      .selectOption(SNAPSHOT_ID);
    await page.getByRole('searchbox', {name: '搜索已保存知识'}).fill('确定性');
    await page.getByRole('button', {name: '执行搜索'}).click();

    await expect(
      page.getByRole('heading', {name: '确定性检索保留来源'}),
    ).toBeVisible();
    await page.getByText('用于修订的稳定身份').click();
    await expect(page.locator('.result-identity')).toContainText(ITEM_ID);
    await page.getByRole('button', {name: /引用.*合成来源/}).click();
    const dossier = page.getByRole('complementary', {name: '来源档案'});
    await expect(dossier).toContainText('可精确回溯的合成摘录。');
    await expect(dossier).toContainText('第 3–3 行');
  });

  test('requires an explicit privacy scope and keeps full documents separate', async ({
    page,
  }) => {
    const posts = new Map<string, unknown>();
    await page.setViewportSize({width: 1440, height: 900});
    await openProduct(page, (path, body) => posts.set(path, body));
    await page.getByRole('button', {name: '搜索', exact: true}).click();

    await expect(page.getByRole('heading', {name: '隐私文档全文'})).toHaveCount(
      0,
    );
    await page.getByRole('checkbox', {name: /查询隐私文档/}).check();
    await page.getByRole('button', {name: '执行搜索'}).click();

    await expect(
      page.getByRole('heading', {name: '隐私文档全文'}),
    ).toBeVisible();
    await expect(page.getByText('完整隐私文档仍可单独查看。')).toBeVisible();
    expect(posts.get('/api/v1/search')).toMatchObject({includePrivate: true});

    const privateDocumentRequest = page.waitForRequest((request) =>
      request
        .url()
        .includes(
          `/api/v1/evidence/snapshots/${SNAPSHOT_ID}?includePrivate=true`,
        ),
    );
    await page.getByRole('button', {name: '单独查看完整文档'}).click();
    await privateDocumentRequest;
    await expect(
      page.getByRole('complementary', {name: '来源档案'}),
    ).toContainText('可精确回溯的合成摘录。');
  });

  test('reopens persisted intake units as a sequential manual review queue', async ({
    page,
  }) => {
    const posts = new Map<string, unknown>();
    await page.setViewportSize({width: 1440, height: 720});
    await openProduct(page, (path, body) => posts.set(path, body));

    await page.getByRole('button', {name: '查看证据', exact: true}).click();
    await expect(
      page.getByRole('complementary', {name: '来源档案'}),
    ).toContainText('可精确回溯的合成摘录。');
    await page.getByRole('button', {name: '关闭来源档案'}).click();
    await page.getByRole('button', {name: '审核', exact: true}).click();

    await expect(
      page.getByRole('navigation', {name: '审核条目分页'}),
    ).toBeVisible();
    await expect(page.getByText('0/2', {exact: true})).toBeVisible();
    await expect(page.getByText('待人工判断', {exact: true})).toBeVisible();
    await expect(
      page.locator('.review-fragment-copy', {
        hasText: '可精确回溯的合成摘录。',
      }),
    ).toBeVisible();
    await expect(page.locator('.review-keyword-list input')).toHaveCount(1);
    await expect(page.locator('.review-keyword-list input')).toHaveValue(
      'DOCX Editor',
    );
    await expect(page.locator('.review-keyword-list')).not.toContainText(
      'github.com',
    );
    await page.getByRole('button', {name: '查看精确原文'}).click();
    await expect(
      page
        .getByRole('complementary', {name: '来源档案'})
        .locator('[data-active="true"]'),
    ).toContainText('第 3–3 行');
    await page.getByRole('button', {name: '关闭来源档案'}).click();

    expect(
      await page.locator('.product-workspace').evaluate((workspace) => {
        const workspaceScrolls =
          workspace.scrollHeight > workspace.clientHeight + 1;
        const documentScrolls =
          document.documentElement.scrollHeight > window.innerHeight + 1;
        return workspaceScrolls || documentScrolls;
      }),
    ).toBe(true);
    expect(
      await page
        .locator('.review-evaluation-panel')
        .evaluate((panel) => panel.scrollHeight - panel.clientHeight),
    ).toBeLessThanOrEqual(1);
    await page.locator('.review-keyword-panel').scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('heading', {name: '自动标签提取'}),
    ).toBeInViewport();
    await page.locator('.review-relation-panel').scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('heading', {name: '标签与联系编辑'}),
    ).toBeInViewport();
    await page
      .getByRole('button', {name: '完成本条并继续'})
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('button', {name: '完成本条并继续'}),
    ).toBeInViewport();

    await expect(page.locator('.review-score-scale i')).toHaveCount(10);
    await expect(page.getByText('很低', {exact: true})).toHaveCount(2);
    await expect(page.getByText('很高', {exact: true})).toHaveCount(2);
    await expect(
      page.getByRole('switch', {name: /启用自动标签/}),
    ).toBeChecked();
    await expect(
      page.getByRole('checkbox', {name: /允许链接域名进入候选/}),
    ).not.toBeChecked();
    await page.getByRole('textbox', {name: '自动排除词'}).fill('广告，下载');
    await page.getByRole('textbox', {name: '自动排除词'}).press('Enter');
    await expect
      .poll(() => posts.get('/api/v1/preferences/review'))
      .toEqual({
        quickTags: ['实用工具'],
        automaticKeywords: {
          enabled: true,
          includeLinkDomains: false,
          excludedKeywords: ['广告', '下载'],
        },
        vocabulary: {aliases: [], links: [], knowledgeKinds: []},
      });
    await page.getByPlaceholder('新增个人标记').fill('命令行工具');
    await page.getByRole('button', {name: '新增', exact: true}).click();
    await expect(
      page.getByRole('button', {name: '命令行工具', exact: true}),
    ).toBeVisible();
    expect(posts.get('/api/v1/preferences/review')).toEqual({
      quickTags: ['实用工具', '命令行工具'],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['广告', '下载'],
      },
      vocabulary: {aliases: [], links: [], knowledgeKinds: []},
    });
    await page.getByRole('button', {name: '从快捷栏删除 命令行工具'}).click();
    await expect(
      page.getByRole('button', {name: '命令行工具', exact: true}),
    ).toHaveCount(0);
    expect(posts.get('/api/v1/preferences/review')).toEqual({
      quickTags: ['实用工具'],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['广告', '下载'],
      },
      vocabulary: {aliases: [], links: [], knowledgeKinds: []},
    });

    await page.getByRole('slider', {name: '有用程度'}).fill('4');
    await page.getByRole('slider', {name: '有趣程度'}).fill('3');
    await page.getByRole('radio', {name: '拆分入库'}).check();
    await page.getByRole('checkbox', {name: '陌生但值得探索'}).check();
    await page.getByRole('button', {name: '实用工具', exact: true}).click();
    await page.getByRole('button', {name: '完成本条并继续'}).click();
    await expect(page.getByText('1/2', {exact: true})).toBeVisible();
    await expect(
      page.locator('.review-fragment-copy', {
        hasText: '等待下一步审核。',
      }),
    ).toBeVisible();
    expect(posts.get('/api/v1/curation/apply')).toMatchObject({
      request: {
        target: {kind: 'fragment', fragmentId: FRAGMENT_ID},
        operations: expect.arrayContaining([
          expect.objectContaining({kind: 'assign_classification'}),
          expect.objectContaining({
            kind: 'set_intake_decision',
            action: 'split',
            reasonCodes: ['worth_exploring'],
          }),
          expect.objectContaining({
            kind: 'set_assessment',
            dimension: 'information_density',
            score: 4,
          }),
          expect.objectContaining({
            kind: 'set_assessment',
            dimension: 'current_interest',
            score: 3,
          }),
        ]),
      },
    });
    await page.getByRole('button', {name: '返回上一条'}).click();
    await expect(page.getByRole('slider', {name: '有用程度'})).toHaveValue('4');
    await expect(page.getByRole('slider', {name: '有趣程度'})).toHaveValue('3');
    await expect(page.getByRole('radio', {name: '拆分入库'})).toBeChecked();
    expect(
      await page
        .locator('.review-keyword-list input')
        .evaluateAll(
          (inputs) =>
            inputs.filter(
              (input) => (input as HTMLInputElement).value === '实用工具',
            ).length,
        ),
    ).toBe(1);
  });

  test('submits fixed Git provenance and a Framework derived from existing revisions', async ({
    page,
  }) => {
    const posts = new Map<string, unknown>();
    await openProduct(page, (path, body) => posts.set(path, body));

    await page.getByRole('radio', {name: '固定 Git 文件'}).check();
    await page.getByRole('checkbox', {name: /作为隐私文档录入/}).check();
    await page.getByLabel('来源标识').fill('synthetic-git-source');
    await page
      .getByLabel('规范来源链接（可选）')
      .fill('https://example.invalid/repository/blob/commit/docs/issue.md');
    await page
      .getByLabel('仓库规范 URI')
      .fill('https://example.invalid/repository');
    await page.getByLabel('仓库内路径').fill('docs/issue.md');
    await page.getByLabel('观察到的 ref').fill('refs/heads/main');
    await page.getByLabel('精确 commit（小写 SHA）').fill('a'.repeat(40));
    await page.getByLabel('结构配置').selectOption('ruanyf-weekly-v1');
    await page
      .getByLabel('Markdown 正文')
      .fill('# Synthetic weekly\n\n## 工具\n\n1、Synthetic entry\n');
    await page.getByRole('button', {name: '保存并拆解材料'}).click();
    await expect(page.getByText('材料已保存并拆解')).toBeVisible();

    const importBody = posts.get('/api/v1/imports/markdown') as Record<
      string,
      unknown
    >;
    expect(importBody.resource).toMatchObject({
      resourceKind: 'git_file',
      sourceKey: 'synthetic-git-source',
      isPrivate: true,
    });
    expect(importBody.gitResource).toMatchObject({
      canonicalRepositoryUri: 'https://example.invalid/repository',
      repositoryRelativePath: 'docs/issue.md',
    });
    expect(importBody.gitObservations).toEqual([
      expect.objectContaining({
        repositoryRef: 'refs/heads/main',
        commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
      }),
    ]);

    await page.getByRole('button', {name: '关闭来源档案'}).click();
    await page.getByRole('button', {name: '知识维护', exact: true}).click();
    await page.getByText('高级拆分、修订与关系编辑', {exact: true}).click();
    const editor = page.locator(
      '.operation-editor:not(.operation-editor--relation)',
    );
    await editor.locator('input').first().fill('Synthetic framework');
    await editor.locator('select').nth(0).selectOption('framework');
    await editor.locator('select').nth(1).selectOption('inference');
    await editor.locator('select').nth(2).selectOption('pending_review');
    await editor.locator('textarea').nth(0).fill(`item:${ITEM_ID}@1`);
    await editor.locator('textarea').nth(1).fill('Synthetic recomposition.');
    await page.getByRole('button', {name: '提交知识变更集'}).click();
    await expect(page.getByText('知识变更集已提交')).toBeVisible();

    const knowledgeBody = posts.get('/api/v1/knowledge/change-sets') as {
      readonly request: {readonly operations: readonly unknown[]};
    };
    expect(knowledgeBody.request.operations).toEqual([
      expect.objectContaining({
        kind: 'put_item',
        value: expect.objectContaining({knowledgeKind: 'framework'}),
        provenance: {
          citations: [],
          fragmentDerivations: [],
          knowledgeDerivations: [{kind: 'item', itemId: ITEM_ID, revision: 1}],
        },
      }),
    ]);
  });

  test('turns an eligible reviewed Fragment into searchable knowledge and advances', async ({
    page,
  }) => {
    const posts = new Map<string, unknown>();
    await page.setViewportSize({width: 1440, height: 900});
    await openProduct(page, (path, body) => posts.set(path, body));

    await page.getByRole('button', {name: '查看证据', exact: true}).click();
    await page.getByRole('button', {name: '关闭来源档案'}).click();
    await page.getByRole('button', {name: '审核', exact: true}).click();
    await page.getByRole('radio', {name: '完整处理'}).check();
    await page
      .getByRole('button', {name: '完成本条并继续'})
      .scrollIntoViewIfNeeded();
    await page.getByRole('button', {name: '完成本条并继续'}).click();
    await expect(page.getByText('1/2', {exact: true})).toBeVisible();

    await page.getByRole('button', {name: '知识维护', exact: true}).click();
    await expect(
      page.getByRole('heading', {name: '审核转知识', exact: true}),
    ).toBeVisible();
    const knowledgeQueue = page.getByRole('region', {name: '审核转知识'});
    await expect(page.getByText('检索状态已同步', {exact: true})).toBeVisible();
    await expect(knowledgeQueue.getByLabel('知识标题')).toHaveValue(
      'DOCX Editor',
    );
    await expect(knowledgeQueue.getByLabel('正式知识正文')).toHaveValue(
      /github\.com\/eigenpal\/docx-editor/u,
    );
    await expect(knowledgeQueue.getByLabel('内容如何形成')).toHaveValue(
      'source_claim',
    );
    await expect(
      knowledgeQueue.getByText('内容直接来自原文陈述，不加入新的归纳。'),
    ).toBeVisible();
    await expect(
      knowledgeQueue.getByRole('button', {name: '返回上一条'}),
    ).toBeDisabled();
    await knowledgeQueue.getByLabel('知识标题').fill('DOCX Editor · 正式知识');
    await knowledgeQueue.getByLabel('知识类型').selectOption('resource');
    await knowledgeQueue.getByRole('button', {name: '写入知识并继续'}).click();

    await expect(page.getByText('已写入正式知识并可检索')).toBeVisible();
    await expect(page.getByText('该 Fragment 已形成正式知识')).toBeVisible();
    await expect(
      page.getByText(/DOCX Editor · 正式知识 · 修订 1/u),
    ).toBeVisible();
    const firstKnowledgeWrite = posts.get('/api/v1/knowledge/change-sets') as {
      readonly request: {
        readonly operations: readonly Readonly<{itemId?: unknown}>[];
      };
    };
    expect(firstKnowledgeWrite).toMatchObject({
      request: {
        authorization: {
          kind: 'eligible_target',
          target: {kind: 'fragment', fragmentId: FRAGMENT_ID},
          expectedDecisionRevision: 1,
        },
        operations: [
          expect.objectContaining({
            kind: 'put_item',
            expectedRevision: 0,
            value: expect.objectContaining({
              knowledgeKind: 'resource',
              epistemicRole: 'source_claim',
              reviewState: 'confirmed',
              title: 'DOCX Editor · 正式知识',
            }),
            provenance: {
              citations: [FRAGMENT_ID],
              fragmentDerivations: [],
              knowledgeDerivations: [],
            },
          }),
        ],
      },
    });
    const writtenItemId = firstKnowledgeWrite.request.operations[0]?.itemId;
    if (typeof writtenItemId !== 'string') {
      throw new Error('missing quick-queue item identity');
    }

    await knowledgeQueue
      .getByLabel('知识标题')
      .fill('DOCX Editor · 修订后的知识');
    await knowledgeQueue.getByRole('button', {name: '保存修改并继续'}).click();
    await expect(page.getByText('修改已保存并可检索')).toBeVisible();
    await expect(
      page.getByText(/DOCX Editor · 修订后的知识 · 修订 2/u),
    ).toBeVisible();
    expect(posts.get('/api/v1/knowledge/change-sets')).toMatchObject({
      request: {
        operations: [
          expect.objectContaining({
            itemId: writtenItemId,
            expectedRevision: 1,
            value: expect.objectContaining({
              title: 'DOCX Editor · 修订后的知识',
            }),
          }),
        ],
      },
    });

    await knowledgeQueue
      .getByRole('button', {name: '在高级编辑器中修改'})
      .click();
    const advancedEditor = page.locator('#advanced-knowledge-editor');
    await expect(advancedEditor).toHaveAttribute('open', '');
    await expect(
      advancedEditor.getByText('正在修改已有判断：DOCX Editor · 修订后的知识'),
    ).toBeVisible();
    await expect(advancedEditor.getByLabel('标题')).toHaveValue(
      'DOCX Editor · 修订后的知识',
    );
    await expect(advancedEditor.getByLabel('知识类型')).toHaveValue('resource');
    await expect(advancedEditor.getByLabel('内容如何形成')).toHaveValue(
      'source_claim',
    );
    await expect(advancedEditor.getByLabel('审核状态')).toHaveValue(
      'confirmed',
    );
    await expect(advancedEditor.getByLabel('预期现有修订')).toHaveValue('2');
    await expect(advancedEditor.getByLabel('Item ID')).toHaveValue(
      writtenItemId,
    );
    await expect(advancedEditor.getByLabel('正文（可选）')).toHaveValue(
      /github\.com\/eigenpal\/docx-editor/u,
    );
    await expect(
      advancedEditor.getByText('已保留 1 个逐字引用、0 个来源派生。'),
    ).toBeVisible();

    await page.setViewportSize({width: 390, height: 800});
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  });

  test('keeps manual classification available when personal preferences are unavailable', async ({
    page,
  }) => {
    const posts = new Map<string, unknown>();
    await openProduct(page, (path, body) => posts.set(path, body), {
      reviewPreferencesUnavailable: true,
    });

    await page.getByRole('button', {name: '查看证据', exact: true}).click();
    await page.getByRole('button', {name: '关闭来源档案'}).click();
    await page.getByRole('button', {name: '审核', exact: true}).click();

    await expect(page.getByText(/个人偏好服务尚未加载/)).toBeVisible();
    await page.getByRole('switch', {name: /启用自动标签/}).uncheck();
    await page.getByPlaceholder('新增个人标记').fill('synthetic-tool-marker');
    await page.getByRole('button', {name: '新增', exact: true}).click();
    await expect(
      page.getByRole('button', {name: 'synthetic-tool-marker', exact: true}),
    ).toBeVisible();
    await page
      .getByRole('button', {name: 'synthetic-tool-marker', exact: true})
      .click();
    await page
      .getByRole('button', {name: '完成本条并继续'})
      .scrollIntoViewIfNeeded();
    await page.getByRole('button', {name: '完成本条并继续'}).click();
    await expect.poll(() => posts.has('/api/v1/curation/apply')).toBe(true);

    expect(posts.has('/api/v1/preferences/review')).toBe(false);
    expect(posts.get('/api/v1/curation/terms')).toMatchObject({
      request: {value: {displayName: 'synthetic-tool-marker'}},
    });
    expect(posts.get('/api/v1/curation/apply')).toMatchObject({
      request: {
        operations: expect.arrayContaining([
          expect.objectContaining({kind: 'assign_classification'}),
        ]),
      },
    });
  });

  test('exports an external Bundle and restores only by its safe file name', async ({
    page,
  }) => {
    const posts: Readonly<{path: string; body: unknown}>[] = [];
    await openProduct(page, (path, body) => posts.push({path, body}));

    await page.getByRole('button', {name: '导出当前工作区'}).click();
    await expect(page.getByText('工作区 Bundle 已导出')).toBeVisible();
    await expect(page.locator('.bundle-file-output')).toContainText(
      'synthetic.workspace-bundle.json',
    );
    await page
      .getByLabel('Bundle 文件名')
      .fill('synthetic.workspace-bundle.json');
    await page.getByRole('button', {name: '验证并恢复'}).click();
    await expect(page.getByText('工作区 Bundle 已恢复')).toBeVisible();

    expect(posts).toContainEqual({
      path: '/api/v1/workspace-bundles/export',
      body: {},
    });
    expect(posts).toContainEqual({
      path: '/api/v1/workspace-bundles/restore',
      body: {fileName: 'synthetic.workspace-bundle.json'},
    });
  });

  test('keeps compact navigation bounded and exposes the skip link', async ({
    page,
  }) => {
    await routeM1cApi(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({width, height: 800});
      await page.goto('/');
      await expect(
        page.getByRole('heading', {name: '材料与证据', exact: true}),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
    }

    await page.reload();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', {name: '跳至主要工作区', exact: true}),
    ).toBeFocused();
  });
});

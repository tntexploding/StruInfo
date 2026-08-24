import {expect, test, type Page} from '@playwright/test';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const FRAGMENT_ID = '66666666-6666-4666-8666-666666666666';

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

async function installCurrentProductApi(page: Page) {
  const productRequests: string[] = [];
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
        json: {status: 'ok', workspaceId: WORKSPACE_ID, capabilities: []},
        status: 200,
      });
      return;
    }
    if (path === '/api/v1/evidence') {
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', snapshots: []},
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
      await route.fulfill({
        contentType: 'application/json',
        json: {status: 'ok', totalCount: 0, documents: []},
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

test('exposes only the current document-to-entry workflow', async ({page}) => {
  const productRequests = await installCurrentProductApi(page);
  await page.goto('/');

  await expect(
    page.getByRole('heading', {name: '总览', exact: true}),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', {name: '产品工作区'});
  const sections = [
    '导入',
    '拆分',
    '标签',
    '联系',
    '查询',
    '正式知识',
  ] as const;

  for (const section of sections) {
    await navigation.getByRole('button', {name: section, exact: true}).click();
    await expect(
      page.getByRole('heading', {name: section, exact: true}),
    ).toBeVisible();
  }

  await expect(page.getByText('审核与知识入库', {exact: true})).toHaveCount(0);
  await expect(page.getByText('知识变更集', {exact: true})).toHaveCount(0);
  expect(
    productRequests.some((request) =>
      /\/api\/v1\/(curation|knowledge|search)(?:\/|$)/u.test(request),
    ),
  ).toBe(false);
  expect(productRequests).toContain('POST /api/v1/entries/search');
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
  await page
    .getByRole('button', {name: '查找 Entry 与完整文档', exact: true})
    .click();

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

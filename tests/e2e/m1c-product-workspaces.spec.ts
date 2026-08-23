import {expect, test, type Page} from '@playwright/test';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

async function installCurrentProductApi(page: Page) {
  const productRequests: string[] = [];

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
        },
        status: 200,
      });
      return;
    }
    if (path === '/api/v1/entries/search') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          status: 'ok',
          querySha256: '0'.repeat(64),
          totalCount: 0,
          items: [],
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

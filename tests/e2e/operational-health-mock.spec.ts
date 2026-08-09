import {expect, test} from '@playwright/test';

const mockOrigin = 'http://127.0.0.1:4174';

test.describe('PENDING_BROWSER_GATE explicit mock operational-health runtime', () => {
  test('discloses mock provenance without live-health or external fallback', async ({
    page,
  }) => {
    const readinessRequests: string[] = [];
    const externalRequests: string[] = [];

    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/health/ready')) {
        readinessRequests.push(request.url());
      }
      if (requestUrl.origin !== mockOrigin) {
        externalRequests.push(request.url());
      }
    });
    await page.route('**/health/ready', async (route) => {
      await route.abort('blockedbyclient');
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', {name: '系统就绪状态', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByText('模拟数据 · 开发模式', {exact: true}),
    ).toBeVisible();
    await expect(
      page
        .getByRole('status')
        .getByRole('heading', {name: '系统已就绪', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByText('Deterministic mock', {exact: true}),
    ).toBeVisible();
    expect(readinessRequests).toStrictEqual([]);
    expect(externalRequests).toStrictEqual([]);
  });
});

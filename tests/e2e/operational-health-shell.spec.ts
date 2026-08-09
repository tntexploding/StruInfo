import {expect, test, type Page} from '@playwright/test';

const liveReadinessUrl =
  'http://127.0.0.1:4173/__struinfo-e2e-api/health/ready';

const healthReady = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'ready',
  checks: {database: 'ready'},
} as const;

const healthNotReady = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'not_ready',
  checks: {database: 'not_ready'},
} as const;

interface ObservedHealthRequest {
  readonly accept: string | null;
  readonly method: string;
  readonly url: string;
}

async function routeHealth(
  page: Page,
  response: unknown,
  status = 200,
): Promise<ObservedHealthRequest[]> {
  const requests: ObservedHealthRequest[] = [];
  await page.route('**/health/ready', async (route) => {
    const request = route.request();
    requests.push({
      accept: request.headers().accept ?? null,
      method: request.method(),
      url: request.url(),
    });
    await route.fulfill({
      status,
      contentType: 'application/json',
      json: response,
    });
  });
  return requests;
}

function expectOneLiveRequest(requests: readonly ObservedHealthRequest[]) {
  expect(requests).toStrictEqual([
    {
      accept: 'application/json',
      method: 'GET',
      url: liveReadinessUrl,
    },
  ]);
}

async function openLiveShell(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: '系统就绪状态', exact: true}),
  ).toBeVisible();
  await expect(page.getByText('实时健康接口', {exact: true})).toBeVisible();
}

test.describe('PENDING_BROWSER_GATE live operational-health shell contract', () => {
  test('loading uses the actual polite status while live readiness is pending', async ({
    page,
  }) => {
    const requests: ObservedHealthRequest[] = [];
    await page.route('**/health/ready', (route) => {
      const request = route.request();
      requests.push({
        accept: request.headers().accept ?? null,
        method: request.method(),
        url: request.url(),
      });
      return new Promise<void>(() => undefined);
    });

    await openLiveShell(page);
    const status = page.getByRole('status');
    await expect(
      status.getByRole('heading', {
        name: '正在检查运行状态',
        exact: true,
      }),
    ).toBeVisible();
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(1);
    expectOneLiveRequest(requests);
  });

  test('ready uses status semantics and exact contract-backed facts', async ({
    page,
  }) => {
    const requests = await routeHealth(page, healthReady);
    await openLiveShell(page);

    const status = page.getByRole('status');
    await expect(
      status.getByRole('heading', {name: '系统已就绪', exact: true}),
    ).toBeVisible();
    await expect(status.getByText('运行角色', {exact: true})).toBeVisible();
    await expect(status.getByText('API', {exact: true})).toBeVisible();
    await expect(status.getByText('数据库检查', {exact: true})).toBeVisible();
    await expect(status.getByText('已就绪', {exact: true})).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expectOneLiveRequest(requests);
  });

  test('not-ready uses alert semantics and the actual retry name', async ({
    page,
  }) => {
    const requests = await routeHealth(page, healthNotReady, 503);
    await openLiveShell(page);

    const alert = page.getByRole('alert');
    await expect(
      alert.getByRole('heading', {name: '服务暂未就绪', exact: true}),
    ).toBeVisible();
    await expect(alert.getByText('未就绪', {exact: true})).toBeVisible();
    await expect(
      alert.getByRole('button', {name: '重试就绪检查', exact: true}),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expectOneLiveRequest(requests);
  });

  test('unexpected contract data uses the distinct actual alert copy', async ({
    page,
  }) => {
    const requests = await routeHealth(page, {unexpected: true});
    await openLiveShell(page);

    const alert = page.getByRole('alert');
    await expect(
      alert.getByRole('heading', {
        name: '无法验证系统状态',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      alert.getByText('响应不符合 C-M0-S-r2，状态未被采信。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      alert.getByRole('button', {name: '重试就绪检查', exact: true}),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expectOneLiveRequest(requests);
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`responsive layout remains bounded at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 900});
      const requests = await routeHealth(page, healthReady);
      await openLiveShell(page);

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(horizontalOverflow).toBe(false);
      await expect(
        page
          .getByRole('status')
          .getByRole('heading', {name: '系统已就绪', exact: true}),
      ).toBeVisible();
      expectOneLiveRequest(requests);
    });
  }

  test('keyboard-only flow uses the actual skip target and retry control', async ({
    page,
  }) => {
    await routeHealth(page, healthNotReady, 503);
    await openLiveShell(page);
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', {name: '跳至主要内容', exact: true}),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    const retry = page.getByRole('button', {
      name: '重试就绪检查',
      exact: true,
    });
    await retry.focus();
    await expect(retry).toBeFocused();
  });

  test('the actual retry control has a visible focus indicator', async ({
    page,
  }) => {
    await routeHealth(page, healthNotReady, 503);
    await openLiveShell(page);
    const retry = page.getByRole('button', {
      name: '重试就绪检查',
      exact: true,
    });
    await retry.focus();
    const outline = await retry.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test('reduced motion preserves the actual ready status', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await routeHealth(page, healthReady);
    await openLiveShell(page);
    await expect(
      page
        .getByRole('status')
        .getByRole('heading', {name: '系统已就绪', exact: true}),
    ).toBeVisible();
    const animations = await page.locator('*').evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.animationIterationCount === 'infinite' &&
            style.animationName !== 'none'
          );
        }).length,
    );
    expect(animations).toBe(0);
  });

  test('200 percent text zoom keeps the actual alert and retry available', async ({
    page,
  }) => {
    await routeHealth(page, healthNotReady, 503);
    await openLiveShell(page);
    await page.locator('html').evaluate((element) => {
      element.style.fontSize = '200%';
    });
    await expect(
      page
        .getByRole('alert')
        .getByRole('heading', {name: '服务暂未就绪', exact: true}),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: '重试就绪检查',
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  });

  test('the shell states its narrow truth boundary without fabricated modules', async ({
    page,
  }) => {
    await routeHealth(page, healthReady);
    await openLiveShell(page);
    await expect(
      page.getByText('它不代表信源、知识或 AI 功能已经启用。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('未来产品模块尚未启用', {exact: true}),
    ).toBeVisible();
    await expect(
      page.getByText(
        /AI Agent Active|AI 生成|知识数量|知识图谱|审阅队列|洞察/i,
      ),
    ).toHaveCount(0);
  });
});

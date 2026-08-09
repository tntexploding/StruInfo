import {expect, test, type Page} from '@playwright/test';

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

async function routeHealth(page: Page, response: unknown, status = 200) {
  await page.route('**/health/ready', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      json: response,
    });
  });
}

async function openShell(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: /system readiness/i}),
  ).toBeVisible();
}

test.describe('PENDING_BROWSER_GATE operational-health shell contract', () => {
  test('loading state is truthful while the health request is pending', async ({
    page,
  }) => {
    await page.route('**/health/ready', () => new Promise(() => undefined));
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(/loading/i);
  });

  test('ready state exposes role and database readiness', async ({page}) => {
    await routeHealth(page, healthReady);
    await openShell(page);
    await expect(page.getByRole('status')).toContainText(/ready/i);
    await expect(page.getByText(/api/i)).toBeVisible();
    await expect(page.getByText(/database.*ready/i)).toBeVisible();
  });

  test('not-ready state remains explicit and offers retry', async ({page}) => {
    await routeHealth(page, healthNotReady, 503);
    await openShell(page);
    await expect(page.getByRole('status')).toContainText(/not ready/i);
    await expect(page.getByRole('button', {name: /retry/i})).toBeVisible();
  });

  test('unexpected error is distinct from not-ready', async ({page}) => {
    await routeHealth(page, {unexpected: true});
    await openShell(page);
    await expect(page.getByRole('alert')).toContainText(/unexpected error/i);
  });

  test('deterministic mock mode never falls back to live network', async ({
    page,
  }) => {
    const unexpectedRequests: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/health/ready')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          json: healthReady,
        });
        return;
      }
      if (
        route.request().resourceType() === 'document' ||
        url.startsWith('http://127.0.0.1:4173/')
      ) {
        await route.continue();
        return;
      }
      unexpectedRequests.push(url);
      await route.abort('blockedbyclient');
    });

    await openShell(page);
    await expect(page.getByText(/development|mock/i)).toBeVisible();
    expect(unexpectedRequests).toStrictEqual([]);
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`responsive layout remains bounded at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 900});
      await routeHealth(page, healthReady);
      await openShell(page);

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(horizontalOverflow).toBe(false);
      await expect(page.getByRole('status')).toBeVisible();
    });
  }

  test('keyboard-only flow exposes skip target and retry', async ({page}) => {
    await routeHealth(page, healthNotReady, 503);
    await openShell(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name: /skip/i})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByRole('button', {name: /retry/i}).focus();
    await expect(page.getByRole('button', {name: /retry/i})).toBeFocused();
  });

  test('focused controls have a visible focus indicator', async ({page}) => {
    await routeHealth(page, healthNotReady, 503);
    await openShell(page);
    const retry = page.getByRole('button', {name: /retry/i});
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

  test('reduced motion preserves state clarity', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await routeHealth(page, healthReady);
    await openShell(page);
    await expect(page.getByRole('status')).toContainText(/ready/i);
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

  test('200 percent text zoom keeps content and actions available', async ({
    page,
  }) => {
    await routeHealth(page, healthNotReady, 503);
    await openShell(page);
    await page.locator('html').evaluate((element) => {
      element.style.fontSize = '200%';
    });
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('button', {name: /retry/i})).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  });

  test('does not fabricate AI, evidence, knowledge, or review state', async ({
    page,
  }) => {
    await routeHealth(page, healthReady);
    await openShell(page);
    await expect(
      page.getByText(
        /ai agent active|ai generated|evidence|knowledge count|insight|review queue/i,
      ),
    ).toHaveCount(0);
  });
});

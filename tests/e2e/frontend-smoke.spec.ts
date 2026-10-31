import {test, expect} from '@playwright/test';

test('the five workspaces render when the service is unavailable', async ({
  page,
}, testInfo) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({error: {code: 'service_unavailable'}}),
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({width: 1280, height: 800});
  for (const workspace of [
    'overview',
    'sources',
    'reading',
    'database',
    'settings',
  ]) {
    await page.goto('/#/' + workspace);
    await expect(page.locator('nav [aria-current="page"]')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({path: testInfo.outputPath(workspace + '.png')});
  }
  expect(errors).toEqual([]);
});

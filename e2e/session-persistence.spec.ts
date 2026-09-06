import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://localhost:3100';
const headers = { Origin: origin, 'X-Requested-With': 'subscribo' };

test('remembered mobile login survives reloads, login bookmarks, external links and browser restart', async ({
  playwright,
  browserName,
}, testInfo) => {
  test.setTimeout(180000);
  await mkdir(testInfo.outputDir, { recursive: true });
  const profile = await mkdtemp(path.join(testInfo.outputDir, 'browser-profile-'));
  const launch = async () => {
    const context = await playwright[browserName].launchPersistentContext(profile, {
      headless: true,
      ...(browserName === 'chromium' && process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await context.routeWebSocket('**/_next/hmr', () => {});
    return context;
  };
  let context = await launch();
  try {
    let page = context.pages()[0] || (await context.newPage());
    await page.goto(origin + '/login');
    await page.getByLabel('账号', { exact: true }).fill('e2e-admin');
    await page.getByLabel('密码', { exact: true }).fill('only-for-isolated-e2e-testing');
    await page.getByLabel('保持登录 30 天', { exact: true }).check();
    const signedIn = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const response = await signedIn;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().remember).toBe(true);
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();
    const cookie = (await context.cookies(origin)).find(
      (item) => item.name === 'subscribo_session',
    );
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400);
    expect(cookie!.expires - Date.now() / 1000).toBeLessThanOrEqual(30 * 86400);
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();
      expect((await page.request.get(origin + '/api/account')).status()).toBe(200);
    }
    await page.goto(origin + '/login');
    await expect(page).toHaveURL(origin + '/');
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();

    // A real top-level cross-site navigation, with only the referring page mocked.
    await page.route('http://outside.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<a href="${origin}/">Open Oxygen</a>`,
      }),
    );
    await page.goto('http://outside.example/');
    const firstEntry = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.url() === origin + '/',
    );
    await page.getByRole('link', { name: 'Open Oxygen' }).click();
    expect(
      (await firstEntry).status(),
      'The first external entry must open the dashboard without a login redirect',
    ).toBe(200);
    await expect(page).toHaveURL(origin + '/');
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();
    expect(
      (
        await page.request.post(origin + '/api/auth/logout', {
          headers: { ...headers, Origin: 'http://outside.example' },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect((await page.request.get(origin + '/api/account')).status()).toBe(200);

    // Reopen the on-disk browser profile; no cookie injection or storageState copy.
    await context.close();
    context = await launch();
    page = context.pages()[0] || (await context.newPage());
    expect(
      (await context.cookies(origin)).find((item) => item.name === 'subscribo_session')?.value,
    ).toBe(cookie!.value);
    await page.goto(origin + '/');
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible();
    const logout = await page.request.post(origin + '/api/auth/logout', { headers, data: {} });
    expect(logout.status()).toBe(200);
    await page.reload();
    await expect(page).toHaveURL(origin + '/login');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

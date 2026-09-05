import { test, expect, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { emptyData } from '../lib/model';
import { todayInTimezone } from '../lib/billing';

const base = 'http://localhost:3100';
const headers = { Origin: base, 'X-Requested-With': 'subscribo' };

async function saveAction(page: Page, type: string, payload: unknown) {
  const current = await (await page.request.get('/api/data')).json();
  const response = await page.request.post('/api/action', {
    headers,
    data: { type, payload, revision: current.data.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}

async function assertReadableControls(dialog: Locator) {
  const controls = await dialog
    .locator(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="color"]), select, textarea',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({
          label:
            element.getAttribute('aria-label') || element.getAttribute('type') || element.tagName,
          size: Number.parseFloat(getComputedStyle(element).fontSize),
        })),
    );
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls)
    expect(
      control.size,
      `${control.label} should not trigger text-field zoom`,
    ).toBeGreaterThanOrEqual(16);
}

test('custom account avatar, AI discovery, converted totals, and mobile editing', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const signedIn = await page.request.post('/api/auth/login', {
    headers,
    data: { username: 'e2e-admin', password: 'only-for-isolated-e2e-testing' },
  });
  expect(signedIn.status(), await signedIn.text()).toBe(200);
  const original = await (await page.request.get('/api/export?format=json')).json();
  const isolated = emptyData();
  isolated.settings.exchange = { autoUpdate: false, manualRates: { USD: 7 }, snapshot: null };
  const initial = await (await page.request.get('/api/data')).json();
  const reset = await page.request.post('/api/import', {
    headers,
    data: {
      mode: 'restore',
      revision: initial.data.revision,
      confirmation: '覆盖现有数据',
      backup: { ...original, data: isolated, uploads: [] },
    },
  });
  expect(reset.status(), await reset.text()).toBe(200);

  try {
    const today = todayInTimezone('Asia/Shanghai');
    for (const [name, amountMinor, currency] of [
      ['Oxygen E2E 人民币', 10000, 'CNY'],
      ['Oxygen E2E 美元', 2000, 'USD'],
    ] as const) {
      await saveAction(page, 'subscription.save', {
        name,
        amountMinor,
        currency,
        serviceId: 'custom',
        logo: '',
        color: '#7160df',
        category: '其他',
        plan: '隔离测试',
        kind: 'personal',
        interval: 1,
        unit: 'month',
        anchorDate: today,
        billingStart: today,
        trialEnd: '',
        autoRenew: true,
        status: 'active',
        stopDate: '',
        notes: '自动化测试数据',
        website: '',
      });
    }
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.goto('/');
    await expect(page).toHaveTitle('Oxygen');
    await expect(page.getByRole('link', { name: 'Oxygen 首页' })).toBeVisible();
    const oldMarketing = /私人订阅管理|你的私人订阅管家|本地头像与品牌资源|安心的私人空间/;
    await expect(page.locator('body')).not.toContainText(oldMarketing);
    const icons = await page
      .locator('link[rel="icon"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') || ''));
    expect(icons.some((href) => /\.svg(?:\?|$)/.test(href))).toBe(true);
    expect(icons.some((href) => /\.ico(?:\?|$)/.test(href))).toBe(true);
    for (const href of icons) {
      const icon = await page.request.get(new URL(href, base).toString());
      expect(icon.status(), href).toBe(200);
      expect((await icon.body()).length, `${href} contains image data`).toBeGreaterThan(100);
    }
    const monthlyTotal = page.locator('.stat-primary .currency-total');
    await expect(monthlyTotal.locator('.currency-total-value')).toHaveText(/≈\s*[¥￥]240\.00/);
    await expect(monthlyTotal.locator('.currency-total-originals')).toContainText('CNY');
    await expect(monthlyTotal.locator('.currency-total-originals')).toContainText('USD');
    await expect(monthlyTotal.locator('.currency-total-note')).toContainText('含手动汇率');
    await expect(
      page.locator('.subscription-row').filter({ hasText: 'Oxygen E2E 美元' }),
    ).toContainText('$20.00');

    await page.goto('/?view=settings');
    await expect(page.getByRole('checkbox', { name: '自动更新汇率' })).not.toBeChecked();
    await page.getByText('手动汇率', { exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'USD 手动汇率（人民币）' })).toHaveValue('7');
    await expect(page.locator('body')).not.toContainText(oldMarketing);
    for (const [rate, expectedTotal] of [
      ['8', /≈\s*[¥￥]260\.00/],
      ['', /^—$/],
      ['7', /≈\s*[¥￥]240\.00/],
    ] as const) {
      await page.getByRole('spinbutton', { name: 'USD 手动汇率（人民币）' }).fill(rate);
      const preferencesSaved = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/action') &&
          response.request().method() === 'POST' &&
          response.request().postDataJSON()?.type === 'settings.save',
      );
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      expect((await preferencesSaved).status()).toBe(200);
      await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
      await page.goto('/');
      await expect(monthlyTotal.locator('.currency-total-value')).toHaveText(expectedTotal);
      if (rate === '')
        await expect(monthlyTotal.locator('.currency-total-warning')).toContainText(
          '缺少 USD 换算汇率',
        );
      else await expect(monthlyTotal.locator('.currency-total-warning')).toHaveCount(0);
      await page.goto('/?view=settings');
      await page.getByText('手动汇率', { exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: 'USD 手动汇率（人民币）' })).toHaveValue(
        rate,
      );
    }
    const avatarImage = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#267f9c' },
    })
      .png()
      .toBuffer();
    const uploadSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/action') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.type === 'settings.save',
    );
    await page.getByLabel('上传账户头像').setInputFiles({
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: avatarImage,
    });
    expect((await uploadSaved).status()).toBe(200);
    await expect(page.locator('.avatar-settings')).toContainText('头像已保存');
    const accountAvatar = page.locator('.sidebar-account img.avatar');
    await expect(accountAvatar).toHaveAttribute('src', /^\/api\/files\//);
    const avatarUrl = await accountAvatar.getAttribute('src');
    await page.reload();
    await expect(page.locator('.sidebar-account img.avatar')).toHaveAttribute('src', avatarUrl!);
    await expect(page.locator('.account-card img.avatar')).toHaveAttribute('src', avatarUrl!);
    await expect
      .poll(() =>
        page
          .locator('.account-card img.avatar')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.screenshot({
      path: 'test-results/enhancements-avatar-settings.png',
      fullPage: true,
    });
    const resetSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/action') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.type === 'settings.save',
    );
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    expect((await resetSaved).status()).toBe(200);
    await expect(page.locator('.sidebar-account img.avatar')).toHaveAttribute(
      'src',
      /^\/api\/avatar\//,
    );
    await page.reload();
    await expect(page.locator('.sidebar-account img.avatar')).toHaveAttribute(
      'src',
      /^\/api\/avatar\//,
    );

    await page.goto('/');
    for (const [query, name] of [
      ['GPT', 'ChatGPT'],
      ['CLAUDED', 'Claude'],
    ] as const) {
      await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: '搜索常用服务' }).fill(query);
      await dialog.getByRole('button', { name, exact: true }).click();
      await expect(dialog.getByLabel('服务名称', { exact: true })).toHaveValue(name);
      await expect(dialog.locator('.selected-service img')).toHaveAttribute('src', /^\/brands\//);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }

    const website = 'https://oxygen-e2e.example/';
    const notFoundQuery = 'oxygen-e2e-no-match';
    const queries: string[] = [];
    await page.route('**/api/services/discover', async (route) => {
      const query = route.request().postDataJSON().query;
      queries.push(query);
      if (query === notFoundQuery) {
        await route.fulfill({
          status: 422,
          json: { error: '未找到这个应用，请填写官网或上传图片。' },
        });
        return;
      }
      await route.fulfill({
        json: {
          service: {
            id: 'custom',
            name: 'Oxygen E2E Website',
            aliases: [],
            color: '#1ED760',
            category: '其他',
            website,
            logo: '/brands/spotify.svg',
            logoType: 'brand',
          },
          source: 'website',
          sourceLabel: '官网图标',
        },
      });
    });
    await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
    const websiteDialog = page.getByRole('dialog');
    await websiteDialog.getByRole('textbox', { name: '搜索常用服务' }).fill(notFoundQuery);
    await expect(websiteDialog.getByText('未找到这个应用，请填写官网或上传图片。')).toBeVisible();
    await expect(
      websiteDialog.getByRole('button', { name: '创建自定义服务', exact: true }),
    ).toBeEnabled();
    await websiteDialog.getByRole('textbox', { name: '搜索常用服务' }).fill(website);
    await websiteDialog.getByRole('button', { name: /Oxygen E2E Website/ }).click();
    expect(queries).toContain(website);
    await expect(websiteDialog.getByLabel('官网或管理链接（可选）')).toHaveValue(website);
    await expect(websiteDialog.locator('.selected-service img')).toHaveAttribute(
      'src',
      '/brands/spotify.svg',
    );
    await websiteDialog.getByLabel('每个账期总金额').fill('1.23');
    const serviceSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/action') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.type === 'subscription.save',
    );
    await websiteDialog.getByRole('button', { name: '添加订阅', exact: true }).click();
    expect((await serviceSaved).status()).toBe(200);
    await expect(websiteDialog).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .locator('.subscription-row')
        .filter({ hasText: 'Oxygen E2E Website' })
        .locator('img')
        .first(),
    ).toHaveAttribute('src', '/brands/spotify.svg');
    await page.unroute('**/api/services/discover');

    const storageState = await page.context().storageState();
    for (const width of [375, 390]) {
      const mobileContext = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        storageState,
        reducedMotion: 'reduce',
      });
      try {
        const mobile = await mobileContext.newPage();
        mobile.on('pageerror', (error) => errors.push(error.message));
        await mobile.goto(base + '/');
        const viewport = await mobile.locator('meta[name="viewport"]').getAttribute('content');
        expect(viewport).toContain('initial-scale=1');
        expect(viewport).not.toMatch(/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/);
        await mobile.getByRole('button', { name: '添加订阅', exact: true }).first().click();
        const dialog = mobile.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect(await mobile.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
        await assertReadableControls(dialog);
        const query = dialog.getByRole('textbox', { name: '搜索常用服务' });
        await query.focus();
        await query.fill('GPT');
        expect(await mobile.evaluate(() => window.visualViewport?.scale ?? 1)).toBeCloseTo(1, 3);
        await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click();
        await assertReadableControls(dialog);
        await dialog.getByLabel('每个账期总金额', { exact: true }).focus();
        expect(await mobile.evaluate(() => window.visualViewport?.scale ?? 1)).toBeCloseTo(1, 3);
        expect(
          await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await mobile.screenshot({
          path: `test-results/enhancements-mobile-modal-${width}.png`,
          fullPage: false,
        });
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      } finally {
        await mobileContext.close();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    // Keep this test independent of the existing workflow's empty-start assumptions.
    await page.goto('about:blank');
    const current = await (await page.request.get(base + '/api/data')).json();
    const restored = await page.request.post(base + '/api/import', {
      headers,
      data: {
        mode: 'restore',
        revision: current.data.revision,
        confirmation: '覆盖现有数据',
        backup: original,
      },
    });
    expect(restored.status(), await restored.text()).toBe(200);
  }
});

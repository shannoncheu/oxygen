import { test, expect } from '@playwright/test';
import { catalog } from '../lib/catalog';
import { addDays, todayInTimezone } from '../lib/billing';
test('real authenticated subscription and family workflow across desktop and mobile', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/data')).status()).toBe(401);
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('e2e-admin');
  await page.getByLabel('密码', { exact: true }).fill('only-for-isolated-e2e-testing');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从第一份订阅开始' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: 'Spotify', exact: true }).click();
  await page.getByLabel('每个账期总金额', { exact: true }).fill('30.01');
  await page.getByLabel('订阅类型', { exact: true }).selectOption('family');
  await page.getByLabel('套餐名称（可选）').fill('家庭测试套餐');
  await page.getByRole('dialog').getByRole('button', { name: '添加订阅', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.subscription-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.subscription-row')).toHaveCount(1);
  await page.locator('.sidebar nav').getByRole('button', { name: '家庭组' }).click();
  await page.locator('.family-card').click();
  await page.getByRole('button', { name: '编辑家庭组', exact: true }).click();
  await page.getByLabel('总席位数').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  for (const name of ['小林', '小夏']) {
    await page.getByRole('button', { name: '添加成员', exact: true }).first().click();
    await page.getByLabel('昵称', { exact: true }).fill(name);
    await page.getByRole('dialog').getByRole('button', { name: '添加成员', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '添加成员', exact: true }).first()).toBeDisabled();
  await page.getByRole('button', { name: '编辑家庭组', exact: true }).click();
  await page.getByLabel('分摊方式').selectOption('equal');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.split-preview')).toHaveCount(2);
  await page.getByRole('button', { name: '调整本期分摊' }).click();
  await page.getByRole('button', { name: '本期成员均摊', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.allocation-row')).toHaveCount(2);
  await page
    .locator('.allocation-row')
    .first()
    .getByRole('button', { name: '记录交费', exact: true })
    .click();
  await expect(page.locator('.allocation-row').first().getByRole('button')).toHaveText(
    '已记录交费',
  );
  const seedBefore = await page.locator('.member-row img').first().getAttribute('src');
  const storage = await page.context().storageState();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: storage,
  });
  const mobile = await phone.newPage();
  await mobile.goto('/?view=families');
  await mobile.locator('.family-card').click();
  await expect(mobile.locator('.member-row')).toHaveCount(2);
  await expect(mobile.locator('.member-row img').first()).toHaveAttribute('src', seedBefore!);
  await expect(mobile.locator('.allocation-row').first().getByRole('button')).toHaveText(
    '已记录交费',
  );
  await phone.close();
  // Extra records exist only in this isolated acceptance-test database.
  const today = todayInTimezone('Asia/Shanghai');
  for (const [serviceId, amountMinor, currency, days] of [
    ['apple-music', 1100, 'CNY', 2],
    ['netflix', 1599, 'USD', 4],
    ['icloud', 2100, 'CNY', 9],
    ['notion', 9600, 'CNY', 15],
  ] as const) {
    const c = catalog.find((c) => c.id === serviceId)!;
    const current = await (await page.request.get('/api/data')).json();
    const due = addDays(today, days);
    const response = await page.request.post('/api/action', {
      headers: { Origin: 'http://localhost:3100', 'X-Requested-With': 'subscribo' },
      data: {
        type: 'subscription.save',
        revision: current.data.revision,
        payload: {
          name: c.name,
          serviceId: c.id,
          logo: c.logo,
          color: c.color,
          category: c.category,
          plan: '测试套餐',
          kind: 'personal',
          amountMinor,
          currency,
          interval: 1,
          unit: 'month',
          anchorDate: due,
          billingStart: due,
          trialEnd: '',
          autoRenew: true,
          status: 'active',
          stopDate: '',
          notes: '仅用于自动化测试，不是真实价格。',
          website: c.website,
        },
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
  for (const width of [375, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['subscriptions', 'statistics', 'families', 'settings']) {
      await page.goto('/?view=' + view);
      await expect(page.locator('.view-content')).toBeVisible();
      await expect(page.locator('.view-content')).toHaveCSS('opacity', '1');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `no overflow ${width} ${view}`,
      ).toBe(true);
      if (width === 390 && view === 'subscriptions') {
        const footer = page.locator('.app-footer');
        await footer.scrollIntoViewIfNeeded();
        const nav = await page.locator('.mobile-bottom').boundingBox();
        const box = await footer.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
        await page.screenshot({ path: 'test-results/mobile-390.png', fullPage: true });
      }
      if (width === 1440 && view === 'subscriptions')
        await page.screenshot({ path: 'test-results/desktop-1440.png', fullPage: true });
      if (width === 1440 && view === 'statistics')
        await page.screenshot({ path: 'test-results/calendar-1440.png', fullPage: true });
    }
  }
  await page.goto('/?view=settings');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/settings-dark.png', fullPage: true });
  const backup = await page.request.get('/api/export?format=json');
  expect(backup.status()).toBe(200);
  const json = await backup.json();
  expect(JSON.stringify(json)).not.toContain('password_hash');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/data')).status()).toBe(401);
  expect(errors).toEqual([]);
});

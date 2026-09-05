import { test, expect, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';

const base = 'http://localhost:3100';
const headers = { Origin: base, 'X-Requested-With': 'subscribo' };
const adminPassword = 'only-for-isolated-e2e-testing';
const memberPassword = 'only-for-invited-account-testing';
const resetPassword = 'only-for-reset-account-testing';

async function login(page: Page, username: string, password: string) {
  const response = await page.request.post(`${base}/api/auth/login`, {
    headers,
    data: { username, password },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function action(page: Page, type: string, payload: unknown) {
  const current = await (await page.request.get(`${base}/api/data`)).json();
  const response = await page.request.post(`${base}/api/action`, {
    headers,
    data: { revision: current.data.revision, type, payload },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}

async function createInvite(page: Page, username: string) {
  await page.getByRole('button', { name: '创建邀请', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('受邀用户名', { exact: true }).fill(username);
  await dialog.getByLabel('你的当前密码', { exact: true }).fill(adminPassword);
  await dialog.getByRole('button', { name: '创建邀请', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '邀请已创建' })).toBeVisible();
  const link = await dialog.getByLabel('邀请链接', { exact: true }).inputValue();
  const code = await dialog.getByLabel('独立验证码', { exact: true }).inputValue();
  expect(link).toMatch(/\/register#[a-f0-9]{64}$/);
  expect(code).toMatch(/^[0-9]{8}$/);
  expect(link).not.toContain(code);
  await expect(dialog.getByRole('button', { name: '复制链接', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '复制验证码', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  return { link, code };
}

async function manage(page: Page, username: string, label: string) {
  const row = page
    .locator('.managed-account')
    .filter({ has: page.locator('strong', { hasText: username }) });
  await row.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('你的当前密码', { exact: true }).fill(adminPassword);
  return dialog;
}

async function readableControls(scope: Locator) {
  const sizes = await scope
    .locator('input, select, textarea')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    );
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every((size) => size >= 16)).toBe(true);
}

test('invitation and separate code, isolated accounts, username and account administration', async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  // Compiling a new API route can reload every dev tab and erase one-time credentials.
  // Keep application HTTP requests real while excluding the development-only reload channel.
  await page.context().routeWebSocket('**/_next/hmr', () => {});
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'e2e-admin', adminPassword);
  const original = (await (await page.request.get('/api/data')).json()).data.settings;
  await action(page, 'settings.save', {
    exchange: { autoUpdate: false, snapshot: null, manualRates: {} },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.routeWebSocket('**/_next/hmr', () => {});
  const member = await context.newPage();
  member.on('pageerror', (error) => errors.push(error.message));
  let memberId = '';
  let username = 'invited-e2e-user';
  try {
    await member.goto(`${base}/register`);
    await expect(member.getByRole('heading', { name: '需要邀请链接' })).toBeVisible();
    await expect(member.getByRole('button', { name: '创建账号' })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/?view=settings');
    await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
    await expect(
      page.getByLabel('总额显示货币').getByRole('option', { name: 'NGN', exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByLabel('总额显示货币').getByRole('option', { name: 'TRY', exact: true }),
    ).toHaveCount(1);
    const invitation = await createInvite(page, username);
    const token = invitation.link.split('#')[1];
    const leakedURLs: string[] = [];
    member.on('request', (request) => {
      if (request.url().includes(token)) leakedURLs.push(request.url());
    });
    await member.goto(invitation.link);
    await expect(member.getByRole('heading', { name: '加入 Oxygen' })).toBeVisible();
    await expect(member.getByLabel('用户名', { exact: true })).toHaveValue(username);
    await expect(member.getByLabel('用户名', { exact: true })).toHaveAttribute('readonly', '');
    await readableControls(member.locator('.token-panel'));
    await expect(member.locator('input:focus')).toHaveCount(0);
    expect(
      await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await member.screenshot({
      path: 'test-results/invitation-registration-mobile.png',
      fullPage: true,
    });
    await member
      .getByLabel('注册验证码', { exact: true })
      .fill(invitation.code === '00000000' ? '11111111' : '00000000');
    await member.getByLabel('新密码（至少 12 个字符）', { exact: true }).fill(memberPassword);
    await member.getByLabel('确认新密码', { exact: true }).fill(memberPassword);
    await member.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(member.locator('.token-panel').getByRole('alert')).toContainText('链接或验证码');
    await member.getByLabel('注册验证码', { exact: true }).fill(invitation.code);
    await member.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(member.getByRole('heading', { name: '账号已创建' })).toBeVisible();
    expect(new URL(member.url()).hash).toBe('');
    expect(leakedURLs).toEqual([]);
    const replay = await member.request.post(`${base}/api/invitations/accept`, {
      headers,
      data: { token, code: invitation.code, password: memberPassword },
    });
    expect(replay.status()).toBe(400);
    await login(member, username, memberPassword);
    const ownAccount = (await (await member.request.get(`${base}/api/account`)).json()).account;
    memberId = ownAccount.id;
    expect(ownAccount.role).toBe('member');
    const denied = await member.request.get(`${base}/api/admin/accounts`);
    expect(denied.status()).toBe(403);
    await action(member, 'settings.save', {
      exchange: { autoUpdate: false, snapshot: null, manualRates: {} },
    });
    await member.goto(`${base}/?view=settings`);
    await expect(member.getByRole('heading', { name: '账号管理' })).toHaveCount(0);
    await expect(member.locator('.account-card')).toContainText('个人账号');
    await member.getByRole('button', { name: '修改用户名', exact: true }).click();
    let dialog = member.getByRole('dialog');
    await readableControls(dialog);
    username = 'renamed-invited-e2e';
    await dialog.getByLabel('新用户名', { exact: true }).fill(username);
    await dialog.getByLabel('当前密码', { exact: true }).fill(memberPassword);
    await dialog.getByRole('button', { name: '保存用户名', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(member.locator('.account-card')).toContainText(username);
    expect((await (await member.request.get(`${base}/api/account`)).json()).account.username).toBe(
      username,
    );

    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 4, background: '#a691ff' },
    })
      .png()
      .toBuffer();
    const upload = await member.request.post(`${base}/api/uploads`, {
      headers,
      multipart: { file: { name: 'private-logo.png', mimeType: 'image/png', buffer: bytes } },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    const uploaded = await upload.json();
    await action(member, 'settings.save', { avatarUrl: uploaded.url, avatarSeed: '' });
    expect((await member.request.get(`${base}${uploaded.url}`)).status()).toBe(200);
    expect((await page.request.get(uploaded.url)).status()).toBe(404);
    const today = new Date().toISOString().slice(0, 10);
    await action(member, 'subscription.save', {
      name: 'NGN isolated member subscription',
      serviceId: 'custom',
      logo: uploaded.url,
      color: '#7160df',
      category: '其他',
      plan: '',
      kind: 'personal',
      amountMinor: 125050,
      currency: 'NGN',
      interval: 1,
      unit: 'month',
      anchorDate: today,
      billingStart: today,
      trialEnd: '',
      autoRenew: true,
      status: 'active',
      stopDate: '',
      notes: '',
      website: '',
    });
    const ownData = (await (await member.request.get(`${base}/api/data`)).json()).data;
    expect(ownData.subscriptions).toHaveLength(1);
    expect(ownData.subscriptions[0].currency).toBe('NGN');
    expect(
      (await (await page.request.get('/api/data')).json()).data.subscriptions.some(
        (subscription: { name: string }) =>
          subscription.name === 'NGN isolated member subscription',
      ),
    ).toBe(false);
    const backup = await (await member.request.get(`${base}/api/export?format=json`)).json();
    expect(backup.uploads).toHaveLength(1);
    expect(backup.data.subscriptions).toHaveLength(1);

    await page.getByRole('button', { name: '刷新账号列表' }).click();
    await expect(page.locator('.managed-accounts')).toContainText(username);
    await page
      .locator('.account-management')
      .screenshot({ path: 'test-results/account-management-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('.account-management')
      .screenshot({ path: 'test-results/account-management-mobile.png' });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    dialog = await manage(page, username, '停用账号');
    await readableControls(dialog);
    await dialog.getByRole('button', { name: '停用账号', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await member.request.get(`${base}/api/data`)).status()).toBe(401);
    dialog = await manage(page, username, '启用账号');
    await dialog.getByRole('button', { name: '启用账号', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await login(member, username, memberPassword);
    expect(
      (await (await member.request.get(`${base}/api/data`)).json()).data.subscriptions,
    ).toHaveLength(1);
    dialog = await manage(page, username, '退出所有设备');
    await dialog.getByRole('button', { name: '退出所有设备', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await member.request.get(`${base}/api/account`)).status()).toBe(401);
    dialog = await manage(page, username, '重置密码');
    await dialog.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '密码重置链接已生成' })).toBeVisible();
    const resetLink = await dialog.getByLabel('重置链接', { exact: true }).inputValue();
    const resetCode = await dialog.getByLabel('独立验证码', { exact: true }).inputValue();
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await member.goto(resetLink);
    await expect(member.getByRole('heading', { name: '设置新密码' })).toBeVisible();
    await member.getByLabel('重置验证码', { exact: true }).fill(resetCode);
    await member.getByLabel('新密码（至少 12 个字符）', { exact: true }).fill(resetPassword);
    await member.getByLabel('确认新密码', { exact: true }).fill(resetPassword);
    await member.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(member.getByRole('heading', { name: '密码已更新' })).toBeVisible();
    await login(member, username, resetPassword);

    const unused = await createInvite(page, 'revoked-invited-e2e');
    await page.getByRole('button', { name: /^邀请记录/ }).click();
    const inviteRow = page
      .locator('.managed-invitation')
      .filter({ hasText: 'revoked-invited-e2e' });
    await inviteRow.getByRole('button', { name: '撤销', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('你的当前密码', { exact: true }).fill(adminPassword);
    await dialog.getByRole('button', { name: '撤销链接', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(inviteRow).toContainText('已撤销');
    await member.goto(unused.link);
    await expect(member.getByRole('heading', { name: '链接暂不可用' })).toBeVisible();
    await expect(member.getByRole('button', { name: '创建账号' })).toHaveCount(0);
    await page.getByRole('button', { name: /^账号 \d/ }).click();
    dialog = await manage(page, username, '删除账号');
    await dialog.getByLabel(`输入「${username}」确认删除`, { exact: true }).fill(username);
    await dialog.getByRole('button', { name: '永久删除账号', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.managed-accounts')).not.toContainText(username);
    memberId = '';
    expect((await member.request.get(`${base}/api/data`)).status()).toBe(401);
    expect((await member.request.get(`${base}${uploaded.url}`)).status()).not.toBe(200);
    expect(errors).toEqual([]);
  } finally {
    if (memberId)
      await page.request.post('/api/admin/accounts/manage', {
        headers,
        data: {
          accountId: memberId,
          action: 'delete',
          currentPassword: adminPassword,
          confirmation: username,
        },
      });
    await action(page, 'settings.save', original);
    await context.close();
  }
});

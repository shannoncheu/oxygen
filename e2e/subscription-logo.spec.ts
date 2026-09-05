import { test, expect, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { emptyData } from '../lib/model';

const base = 'http://localhost:3100';
const headers = { Origin: base, 'X-Requested-With': 'subscribo' };

test.use({ viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true });

async function expectLoadedImage(image: Locator, url: string) {
  await expect(image).toHaveAttribute('src', url);
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
}

async function saveSubscription(page: Page, dialog: Locator, label: string) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/action') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.type === 'subscription.save',
  );
  await dialog.getByRole('button', { name: label, exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  await expect(dialog).toHaveCount(0);
}

async function uploadLogo(page: Page, dialog: Locator, buffer: Buffer) {
  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/uploads') && response.request().method() === 'POST',
  );
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '上传 Logo', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'subscription-logo.png',
    mimeType: 'image/png',
    buffer,
  });
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  expect(url).toMatch(/^\/api\/files\//);
  await expectLoadedImage(dialog.locator('.selected-service img'), url);
  return url;
}

test('subscription logos upload, replace, and remove persist after reload on mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const login = await page.request.post('/api/auth/login', {
    headers,
    data: { username: 'e2e-admin', password: 'only-for-isolated-e2e-testing' },
  });
  expect(login.status(), await login.text()).toBe(200);
  const original = await (await page.request.get('/api/export?format=json')).json();
  const isolated = emptyData();
  isolated.settings.exchange = { autoUpdate: false, manualRates: {}, snapshot: null };
  const current = await (await page.request.get('/api/data')).json();
  const reset = await page.request.post('/api/import', {
    headers,
    data: {
      mode: 'restore',
      revision: current.data.revision,
      confirmation: '覆盖现有数据',
      backup: { ...original, data: isolated, uploads: [] },
    },
  });
  expect(reset.status(), await reset.text()).toBe(200);

  try {
    // A new upload must still render when the previous service image was unavailable.
    await page.route('**/brands/spotify.svg', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/');
    await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Spotify', exact: true }).click();
    await expect(dialog.getByLabel('订阅类型', { exact: true })).toHaveValue('personal');
    await expect(dialog.locator('.selected-service img')).toHaveCount(0);
    await expect(dialog.locator('.selected-service .service-logo')).toHaveText('SP');

    // Uploading should be discoverable without scrolling through the subscription form.
    const uploadControls = dialog.locator('.subscription-logo-upload');
    await expect(uploadControls).toBeVisible();
    const bounds = await uploadControls.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const firstImage = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#286e96' },
    })
      .png()
      .toBuffer();
    const firstUrl = await uploadLogo(page, dialog, firstImage);
    await page.unroute('**/brands/spotify.svg');

    let rejectedUploadRequests = 0;
    const countUpload = (request: { url(): string; method(): string }) => {
      if (request.url().endsWith('/api/uploads') && request.method() === 'POST')
        rejectedUploadRequests++;
    };
    page.on('request', countUpload);
    for (const file of [
      { name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
      {
        name: 'too-large.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      },
    ]) {
      await dialog.getByLabel('上传订阅 Logo', { exact: true }).setInputFiles(file);
      await expect(uploadControls.getByRole('alert')).toBeVisible();
      await expect(uploadControls.getByRole('alert')).toContainText(/PNG|2 MB/);
      await expectLoadedImage(dialog.locator('.selected-service img'), firstUrl);
    }
    page.off('request', countUpload);
    expect(rejectedUploadRequests).toBe(0);

    await dialog.getByLabel('每个账期总金额', { exact: true }).fill('28');
    await saveSubscription(page, dialog, '添加订阅');
    await page.reload();
    const row = page.locator('.subscription-row').filter({ hasText: 'Spotify' });
    await expect(row).toHaveCount(1);
    await expectLoadedImage(row.locator('.service-logo img'), firstUrl);

    await row.click();
    await dialog.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '编辑订阅', exact: true })).toBeVisible();
    await expectLoadedImage(dialog.locator('.selected-service img'), firstUrl);
    const secondImage = await sharp({
      create: { width: 72, height: 72, channels: 4, background: '#b36b32' },
    })
      .png()
      .toBuffer();
    const secondUrl = await uploadLogo(page, dialog, secondImage);
    expect(secondUrl).not.toBe(firstUrl);
    await expect(uploadControls.getByRole('alert')).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/subscription-logo-upload-mobile.png',
      fullPage: false,
    });
    await saveSubscription(page, dialog, '保存修改');
    await page.reload();
    await expectLoadedImage(row.locator('.service-logo img'), secondUrl);

    await row.click();
    await dialog.getByRole('button', { name: '编辑', exact: true }).click();
    await dialog.getByRole('button', { name: '移除 Logo', exact: true }).click();
    await expect(dialog.locator('.selected-service img')).toHaveCount(0);
    await expect(dialog.locator('.selected-service .service-logo')).toHaveText('SP');
    await dialog.getByLabel('官网或管理链接（可选）').focus();
    await dialog.getByLabel('备注', { exact: true }).focus();
    await expect(dialog.locator('.selected-service img')).toHaveCount(0);
    await saveSubscription(page, dialog, '保存修改');
    await page.reload();
    await expect(row.locator('.service-logo img')).toHaveCount(0);
    await expect(row.locator('.service-logo')).toHaveText('SP');
    expect(errors).toEqual([]);
  } finally {
    // Restore the previous fixture so other workflow tests can retain their own starting state.
    await page.goto('about:blank');
    const latest = await (await page.request.get(base + '/api/data')).json();
    const restored = await page.request.post(base + '/api/import', {
      headers,
      data: {
        mode: 'restore',
        revision: latest.data.revision,
        confirmation: '覆盖现有数据',
        backup: original,
      },
    });
    expect(restored.status(), await restored.text()).toBe(200);
  }
});

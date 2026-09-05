import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { emptyData } from '../lib/model';
import { validateData } from '../lib/domain';
import { assertUploadOwnership, referencedUploadIds } from '../lib/server/uploads';
import { createAdministrator } from '../lib/server/admin';
import { closeDatabase } from '../lib/server/db';
import { POST as login } from '../app/api/auth/login/route';
import { POST as action } from '../app/api/action/route';
import { POST as upload } from '../app/api/uploads/route';
import { GET as getData } from '../app/api/data/route';
import { GET as exportData } from '../app/api/export/route';
import { POST as importData } from '../app/api/import/route';
import { GET as file } from '../app/api/files/[id]/route';

const base = 'http://localhost:3000';
const imageId = '11111111-1111-4111-8111-111111111111';
after(async () => closeDatabase());

function request(endpoint: string, body?: unknown, cookie?: string) {
  return new Request(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      'X-Requested-With': 'subscribo',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function result(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

test('old settings acquire avatar defaults; malformed avatars are rejected', () => {
  const legacy = emptyData();
  delete legacy.settings.avatarUrl;
  delete legacy.settings.avatarSeed;
  delete legacy.settings.exchange;
  const decoded = validateData(legacy);
  assert.equal(decoded.settings.avatarUrl, '');
  assert.equal(decoded.settings.avatarSeed, '');
  assert.equal(decoded.settings.exchange?.autoUpdate, true);
  for (const avatarUrl of [
    'https://example.com/avatar.png',
    '/api/files/../private',
    '/brands/spotify.svg',
    'data:image/svg+xml,<svg/>',
  ]) {
    assert.throws(() => validateData({ ...legacy, settings: { ...legacy.settings, avatarUrl } }));
  }
  assert.throws(() =>
    validateData({ ...legacy, settings: { ...legacy.settings, avatarSeed: 'a'.repeat(161) } }),
  );
});

test('avatar image ownership is checked against the signed-in owner', async () => {
  const data = emptyData();
  data.settings.avatarUrl = '/api/files/' + imageId;
  assert.deepEqual(referencedUploadIds(data), [imageId]);
  const executor = {
    async query<T>(sql: string, parameters?: unknown[]) {
      assert.match(sql, /owner_id=\$1/);
      assert.equal(parameters?.[0], 'actual-owner');
      assert.deepEqual(parameters?.[1], [imageId]);
      return { rows: [] as T[] };
    },
  };
  await assert.rejects(assertUploadOwnership(executor, 'actual-owner', data), /不可访问/);
});

test('uploaded account avatar persists, exports, restores with remapped ID, and resets', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'oxygen-avatar-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: base,
    PGLITE_DATA_DIR: path.join(temp, 'db'),
    UPLOAD_DIR: path.join(temp, 'uploads'),
  });
  delete process.env.DATABASE_URL;
  await createAdministrator('avatar-tester', 'isolated-avatar-test-password');
  const signedIn = await login(
    request('/api/auth/login', {
      username: 'avatar-tester',
      password: 'isolated-avatar-test-password',
    }),
  );
  await result(signedIn);
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
  let data = (await result(await getData(request('/api/data', undefined, cookie)))).data;
  const png = await sharp({
    create: { width: 32, height: 24, channels: 4, background: '#8171df' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(png)], 'avatar.png', { type: 'image/png' }));
  const uploaded = await result(
    await upload(
      new Request(base + '/api/uploads', {
        method: 'POST',
        headers: { Origin: base, 'X-Requested-With': 'subscribo', cookie },
        body: form,
      }),
    ),
  );
  async function save(payload: unknown, status = 200) {
    return result(
      await action(
        request(
          '/api/action',
          {
            type: 'settings.save',
            revision: data.revision,
            payload,
          },
          cookie,
        ),
      ),
      status,
    );
  }
  await save({ avatarUrl: '/api/files/' + imageId }, 400);
  data = (await save({ avatarUrl: uploaded.url, avatarSeed: 'stable-custom-seed' })).data;
  assert.equal(data.settings.avatarUrl, uploaded.url);
  const reread = (await result(await getData(request('/api/data', undefined, cookie)))).data;
  assert.equal(reread.settings.avatarUrl, uploaded.url);
  const backup = await result(
    await exportData(request('/api/export?format=json', undefined, cookie)),
  );
  assert.equal(backup.uploads.length, 1, 'an avatar without subscription logos is exported');
  assert.equal(backup.uploads[0].id, uploaded.id);
  await result(
    await importData(
      request(
        '/api/import',
        {
          mode: 'preview',
          backup: { ...backup, uploads: [] },
        },
        cookie,
      ),
    ),
    400,
  );
  const preview = await result(
    await importData(
      request(
        '/api/import',
        {
          mode: 'preview',
          backup,
        },
        cookie,
      ),
    ),
  );
  assert.equal(preview.preview.uploads, 1);
  data = (await save({ avatarUrl: '', avatarSeed: '' })).data;
  assert.equal(data.settings.avatarUrl, '');
  const restored = await result(
    await importData(
      request(
        '/api/import',
        {
          mode: 'restore',
          backup,
          revision: data.revision,
          confirmation: '覆盖现有数据',
        },
        cookie,
      ),
    ),
  );
  data = restored.data;
  assert.notEqual(data.settings.avatarUrl, uploaded.url);
  assert.equal(data.settings.avatarSeed, 'stable-custom-seed');
  const restoredFile = await file(request(data.settings.avatarUrl, undefined, cookie), {
    params: Promise.resolve({ id: data.settings.avatarUrl.split('/').at(-1) }),
  });
  assert.equal(restoredFile.status, 200);
  assert.deepEqual(
    await sharp(Buffer.from(await restoredFile.arrayBuffer()))
      .raw()
      .toBuffer(),
    await sharp(png).raw().toBuffer(),
  );
  const unauthorized = await file(request(data.settings.avatarUrl), {
    params: Promise.resolve({ id: data.settings.avatarUrl.split('/').at(-1) }),
  });
  assert.equal(unauthorized.status, 401);
  data = (await save({ avatarUrl: '', avatarSeed: 'next-generated-avatar' })).data;
  assert.equal(data.settings.avatarSeed, 'next-generated-avatar');
  assert.deepEqual(referencedUploadIds(data), []);
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { saveUpload } from '../lib/server/uploads';
import { APIError } from '../lib/server/errors';
import { createAdministrator } from '../lib/server/admin';
import { closeDatabase, query } from '../lib/server/db';
import { POST as login } from '../app/api/auth/login/route';
import { POST as upload } from '../app/api/uploads/route';

const base = 'http://localhost:3000';
after(async () => closeDatabase());

test('successful image writes retain the exact PNG and create an owner-scoped record', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oxygen-upload-storage-'));
  process.env.UPLOAD_DIR = directory;
  const png = Buffer.from('normalized-image-fixture');
  let parameters: unknown[] | undefined;
  const saved = await saveUpload('account-1', png, {
    async query<T>(_sql: string, values?: unknown[]) {
      parameters = values;
      return { rows: [] as T[] };
    },
  });
  assert.deepEqual(await readFile(path.join(directory, saved.filename)), png);
  assert.deepEqual(parameters, [saved.id, 'account-1', saved.filename]);
});

test('a database failure removes the new file and logs only its stage and safe code', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oxygen-upload-db-failure-'));
  process.env.UPLOAD_DIR = directory;
  const logged = t.mock.method(console, 'error', () => {});
  await assert.rejects(
    saveUpload('private-account', Buffer.from('private-image'), {
      async query() {
        throw new Error('SQL containing private-account and database credentials', {
          cause: Object.assign(new Error('private database detail'), { code: '57P03' }),
        });
      },
    }),
    (error: unknown) =>
      error instanceof APIError && error.status === 503 && /图片记录保存失败/.test(error.message),
  );
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(logged.mock.calls[0].arguments, [
    'Upload failed:',
    { stage: 'database', code: '57P03' },
  ]);
});

test('an authenticated upload with unusable storage returns an actionable error without creating a record', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'oxygen-upload-route-failure-'));
  const blocked = path.join(temp, 'uploads-is-a-file');
  await writeFile(blocked, 'preserve existing file');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: base,
    PGLITE_DATA_DIR: path.join(temp, 'db'),
    UPLOAD_DIR: blocked,
  });
  delete process.env.DATABASE_URL;
  await createAdministrator('storage-tester', 'isolated-storage-test-password');
  const signedIn = await login(
    new Request(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: base,
        'X-Requested-With': 'subscribo',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'storage-tester',
        password: 'isolated-storage-test-password',
      }),
    }),
  );
  assert.equal(signedIn.status, 200);
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#9980ed' } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(png)], 'avatar.png', { type: 'image/png' }));
  const logged = t.mock.method(console, 'error', () => {});
  const response = await upload(
    new Request(base + '/api/uploads', {
      method: 'POST',
      headers: {
        Origin: base,
        'X-Requested-With': 'subscribo',
        cookie: signedIn.headers.get('set-cookie')!.split(';')[0],
      },
      body: form,
    }),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /上传目录配置异常/);
  assert.equal((await query('SELECT id FROM uploads')).rows.length, 0);
  assert.equal(await readFile(blocked, 'utf8'), 'preserve existing file');
  assert.equal(logged.mock.calls[0].arguments[1].stage, 'storage');
});

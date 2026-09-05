import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import sharp from 'sharp';
import { createAdministrator } from '../lib/server/admin';
import { closeDatabase, database, query, type SQLExecutor } from '../lib/server/db';
import { requireAccount } from '../lib/server/auth';
import { saveAuthenticatedUpload } from '../lib/server/uploads';
import { POST as login } from '../app/api/auth/login/route';
import { POST as upload } from '../app/api/uploads/route';
import { POST as discover } from '../app/api/services/discover/route';

const base = 'http://localhost:3000';
after(async () => closeDatabase());

async function fixture() {
  await closeDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), 'oxygen-upload-session-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: base,
    PGLITE_DATA_DIR: path.join(directory, 'db'),
    UPLOAD_DIR: path.join(directory, 'uploads'),
  });
  delete process.env.DATABASE_URL;
  await createAdministrator('upload-tester', 'isolated-upload-test-password');
  const signedIn = await login(
    new Request(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: base,
        'X-Requested-With': 'subscribo',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'upload-tester',
        password: 'isolated-upload-test-password',
      }),
    }),
  );
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const headers = {
    Origin: base,
    'X-Requested-With': 'subscribo',
    cookie: signedIn.headers.get('set-cookie')!.split(';')[0],
  };
  const account = await requireAccount(new Request(base + '/api/data', { headers }));
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#9980ed' } })
    .png()
    .toBuffer();
  return { directory, headers, account, png };
}

async function assertNoUploads(directory: string) {
  assert.equal((await query('SELECT id FROM uploads')).rows.length, 0);
  const files = await readdir(path.join(directory, 'uploads')).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  assert.deepEqual(files, []);
}

test('an upload authenticated before session revocation cannot persist after its body finishes', async () => {
  const { directory, headers, account, png } = await fixture();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(png)], 'avatar.png', { type: 'image/png' }));
  const encoded = new Request(base + '/api/uploads', { method: 'POST', headers, body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let notifyRead!: () => void;
  const reading = new Promise<void>((resolve) => (notifyRead = resolve));
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const delayed = new ReadableStream<Uint8Array>({ start: (value) => (controller = value) });
  const request = new Request(base + '/api/uploads', {
    method: 'POST',
    headers: encoded.headers,
    body: bytes,
  });
  Object.defineProperty(request, 'body', {
    get() {
      notifyRead();
      return delayed;
    },
  });
  const response = upload(request);
  await reading;
  await query('DELETE FROM sessions WHERE id=$1', [account.sessionId]);
  controller.enqueue(bytes);
  controller.close();
  const result = await response;
  assert.equal(result.status, 401, await result.clone().text());
  await assertNoUploads(directory);
});

test('remote logo discovery cannot save when its authenticated account is disabled during fetch', async (t) => {
  const { directory, headers, account, png } = await fixture();
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  let requests = 0;
  t.mock.method(
    https,
    'request',
    (url: URL, _options: https.RequestOptions, handler: (res: unknown) => void) => {
      requests++;
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {
        req.emit('close');
      };
      req.end = () => {
        void (async () => {
          const icon = url.pathname === '/icon.png';
          if (icon) await query('UPDATE accounts SET disabled_at=now() WHERE id=$1', [account.id]);
          const res = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: { 'content-type': icon ? 'image/png' : 'text/html' },
          });
          res.on('close', () => req.emit('close'));
          handler(res);
          res.end(icon ? png : '<html><head><link rel="icon" href="/icon.png"></head></html>');
        })().catch((error) => req.emit('error', error));
      };
      return req;
    },
  );
  const response = await discover(
    new Request(base + '/api/services/discover', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'https://example.org/' }),
    }),
  );
  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(requests, 2, 'a revoked account must not try further icon candidates');
  await assertNoUploads(directory);
});

test('a rollback after image insertion removes both the upload record and physical file', async (t) => {
  const { directory, account, png } = await fixture();
  const db = await database();
  const originalTransaction = db.transaction.bind(db);
  t.mock.method(db, 'transaction', async <T>(fn: (tx: SQLExecutor) => Promise<T>) =>
    originalTransaction(async (tx) => {
      await fn(tx);
      throw Error('simulated transaction rollback after upload insert');
    }),
  );
  await assert.rejects(saveAuthenticatedUpload(account, png), /simulated transaction rollback/);
  await assertNoUploads(directory);
});

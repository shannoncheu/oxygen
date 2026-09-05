import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createAdministrator, resetAdministrator } from '../lib/server/admin';
import { closeDatabase, query } from '../lib/server/db';
import { tokenHash, validateUsername } from '../lib/server/auth';
import { POST as login } from '../app/api/auth/login/route';
import { POST as password } from '../app/api/auth/password/route';
import { GET as accountInfo } from '../app/api/account/route';
import { POST as username } from '../app/api/account/username/route';
import { GET as accounts } from '../app/api/admin/accounts/route';
import { POST as manage } from '../app/api/admin/accounts/manage/route';
import { POST as invite } from '../app/api/admin/invitations/route';
import { POST as revoke } from '../app/api/admin/invitations/revoke/route';
import { POST as inspect } from '../app/api/invitations/inspect/route';
import { POST as accept } from '../app/api/invitations/accept/route';
import { GET as getData } from '../app/api/data/route';
import { POST as action } from '../app/api/action/route';
import { POST as upload } from '../app/api/uploads/route';
import { GET as file } from '../app/api/files/[id]/route';
import { GET as exportData } from '../app/api/export/route';
import { POST as importData } from '../app/api/import/route';

const base = 'http://localhost:3000';
const adminPassword = 'admin-account-test-password';
const memberPassword = 'member-account-test-password';
after(async () => closeDatabase());
function request(endpoint: string, body?: unknown, cookie?: string, origin = base) {
  return new Request(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
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
async function signIn(name: string, secret = memberPassword) {
  const response = await login(request('/api/auth/login', { username: name, password: secret }));
  await result(response);
  return response.headers.get('set-cookie')!.split(';')[0];
}
const readAccount = async (cookie: string) =>
  (await result(await accountInfo(request('/api/account', undefined, cookie)))).account;
const readData = async (cookie: string) =>
  (await result(await getData(request('/api/data', undefined, cookie)))).data;
const tokenFrom = (link: string) => new URL(link).hash.slice(1);
const wrongCode = (code: string) => (code[0] === '0' ? '1' : '0') + code.slice(1);

test('username validation shares the login and HTML input length bound', () => {
  assert.equal(validateUsername('𐐀'.repeat(32)).length, 64);
  assert.throws(() => validateUsername('𐐀'.repeat(33)), /用户名/);
  assert.equal(validateUsername('  Cafe\u0301  '), 'Café');
});

test('invitation-only accounts enforce secrets, isolation and administrator boundaries', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'oxygen-accounts-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: base,
    PGLITE_DATA_DIR: path.join(temp, 'db'),
    UPLOAD_DIR: path.join(temp, 'uploads'),
  });
  delete process.env.DATABASE_URL;
  await createAdministrator('root', adminPassword);
  const adminCookie = await signIn('root', adminPassword);
  const root = await readAccount(adminCookie);
  let aliceCookie = '',
    bobCookie = '',
    alice: any,
    bob: any;
  let administratorBackup: any;
  const newInvite = async (name: string) =>
    result(
      await invite(
        request(
          '/api/admin/invitations',
          { username: name, currentPassword: adminPassword },
          adminCookie,
        ),
      ),
    );

  await t.test(
    'only admin creates bound invitations; codes persist only as hashes; concurrent acceptance is one-use',
    async () => {
      assert.equal(root.role, 'admin');
      await result(await accounts(request('/api/admin/accounts')), 401);
      await result(
        await invite(
          request(
            '/api/admin/invitations',
            { username: 'alice', currentPassword: adminPassword },
            adminCookie,
            'https://evil.example',
          ),
        ),
        403,
      );
      await result(
        await invite(
          request(
            '/api/admin/invitations',
            { username: 'alice', currentPassword: 'incorrect-password' },
            adminCookie,
          ),
        ),
        400,
      );
      const first = await newInvite('Alice');
      assert.match(first.code, /^[0-9]{8}$/);
      const url = new URL(first.link),
        token = tokenFrom(first.link);
      assert.equal(url.pathname, '/register');
      assert.equal(url.search, '');
      assert.match(token, /^[a-f0-9]{64}$/);
      const stored = (
        await query('SELECT * FROM account_tokens WHERE id=$1', [first.invitation.id])
      ).rows[0];
      assert.equal(stored.token_hash, tokenHash(token));
      assert.equal(stored.code_hash, tokenHash(token + ':' + first.code));
      assert.equal(JSON.stringify(stored).includes(token), false);
      assert.equal(JSON.stringify(stored).includes(first.code), false);
      assert.deepEqual(
        (await result(await inspect(request('/api/invitations/inspect', { token })))).username,
        'Alice',
      );
      await result(
        await accept(request('/api/invitations/accept', { token, password: memberPassword })),
        400,
      );
      await result(
        await accept(
          request('/api/invitations/accept', {
            token,
            code: wrongCode(first.code),
            password: memberPassword,
          }),
        ),
        400,
      );
      const replies = await Promise.all(
        [1, 2].map(() =>
          accept(
            request('/api/invitations/accept', {
              token,
              code: first.code,
              password: memberPassword,
              username: 'hijacked',
              role: 'admin',
            }),
          ),
        ),
      );
      assert.deepEqual(replies.map((r) => r.status).sort(), [200, 400]);
      await result(await inspect(request('/api/invitations/inspect', { token })), 400);
      aliceCookie = await signIn('aLiCe');
      alice = await readAccount(aliceCookie);
      assert.equal(alice.username, 'Alice');
      assert.equal(alice.role, 'member');
      assert.equal((await readData(aliceCookie)).subscriptions.length, 0);
      await result(await accounts(request('/api/admin/accounts', undefined, aliceCookie)), 403);
      await result(
        await invite(
          request(
            '/api/admin/invitations',
            { username: 'evil', currentPassword: memberPassword },
            aliceCookie,
          ),
        ),
        403,
      );
      await result(
        await manage(
          request(
            '/api/admin/accounts/manage',
            { accountId: root.id, action: 'disable', currentPassword: memberPassword },
            aliceCookie,
          ),
        ),
        403,
      );
      await result(
        await revoke(
          request(
            '/api/admin/invitations/revoke',
            { id: first.invitation.id, currentPassword: memberPassword },
            aliceCookie,
          ),
        ),
        403,
      );
      const second = await newInvite('Bob');
      await query('INSERT INTO login_limits(key,attempts,window_start) VALUES($1,5,now())', [
        tokenHash('bob'),
      ]);
      await result(
        await accept(
          request('/api/invitations/accept', {
            token: tokenFrom(second.link),
            code: second.code,
            password: memberPassword,
          }),
        ),
      );
      assert.equal(
        (await query('SELECT key FROM login_limits WHERE key=$1', [tokenHash('bob')])).rows.length,
        0,
      );
      bobCookie = await signIn('Bob');
      bob = await readAccount(bobCookie);
      const list = await result(
        await accounts(request('/api/admin/accounts', undefined, adminCookie)),
      );
      assert.equal(list.accounts.length, 3);
      for (const item of list.accounts)
        assert.deepEqual(Object.keys(item).sort(), [
          'createdAt',
          'disabledAt',
          'id',
          'role',
          'username',
        ]);
      assert.equal(
        /password_hash|token_hash|code_hash|settings|sessionId/.test(JSON.stringify(list)),
        false,
      );
      await result(
        await invite(
          request(
            '/api/admin/invitations',
            { username: 'ALICE', currentPassword: adminPassword },
            adminCookie,
          ),
        ),
        409,
      );
    },
  );

  await t.test('expired, revoked and exhausted codes fail without changing accounts', async () => {
    const expired = await newInvite('expired-user');
    await query("UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      expired.invitation.id,
    ]);
    await result(
      await accept(
        request('/api/invitations/accept', {
          token: tokenFrom(expired.link),
          code: expired.code,
          password: memberPassword,
        }),
      ),
      400,
    );
    const revoked = await newInvite('revoked-user');
    await result(
      await revoke(
        request(
          '/api/admin/invitations/revoke',
          { id: revoked.invitation.id, currentPassword: adminPassword },
          adminCookie,
        ),
      ),
    );
    await result(
      await accept(
        request('/api/invitations/accept', {
          token: tokenFrom(revoked.link),
          code: revoked.code,
          password: memberPassword,
        }),
      ),
      400,
    );
    const exhausted = await newInvite('exhausted-user');
    const token = tokenFrom(exhausted.link);
    for (let i = 0; i < 5; i++)
      await result(
        await accept(
          request('/api/invitations/accept', {
            token,
            code: wrongCode(exhausted.code),
            password: memberPassword,
          }),
        ),
        400,
      );
    assert.equal(
      (await query('SELECT attempts FROM account_tokens WHERE id=$1', [exhausted.invitation.id]))
        .rows[0].attempts,
      5,
    );
    await result(
      await accept(
        request('/api/invitations/accept', {
          token,
          code: exhausted.code,
          password: memberPassword,
        }),
      ),
      400,
    );
    assert.equal((await query('SELECT count(*)::integer AS count FROM accounts')).rows[0].count, 3);
    const renewed = await newInvite('exhausted-user');
    assert.notEqual(renewed.invitation.id, exhausted.invitation.id);
    await result(
      await revoke(
        request(
          '/api/admin/invitations/revoke',
          { id: renewed.invitation.id, currentPassword: adminPassword },
          adminCookie,
        ),
      ),
    );
  });

  await t.test(
    'business data, settings, uploads and imports remain isolated, including identical entity IDs',
    async () => {
      let data = await readData(adminCookie);
      const saved = await result(
        await action(
          request(
            '/api/action',
            {
              type: 'subscription.save',
              revision: data.revision,
              payload: {
                name: 'Owner-only subscription',
                serviceId: 'custom',
                logo: '',
                color: '#6558d3',
                category: '效率',
                plan: 'Private',
                kind: 'personal',
                amountMinor: 2400,
                currency: 'CNY',
                interval: 1,
                unit: 'month',
                anchorDate: '2026-09-06',
                billingStart: '2026-09-06',
                trialEnd: '',
                autoRenew: true,
                status: 'active',
                stopDate: '',
                notes: 'Private notes',
                website: '',
              },
            },
            adminCookie,
          ),
        ),
      );
      data = saved.data;
      const png = await sharp({
        create: { width: 24, height: 24, channels: 4, background: '#9474ff' },
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.set('file', new File([new Uint8Array(png)], 'avatar.png', { type: 'image/png' }));
      const uploaded = await result(
        await upload(
          new Request(base + '/api/uploads', {
            method: 'POST',
            headers: { Origin: base, 'X-Requested-With': 'subscribo', cookie: adminCookie },
            body: form,
          }),
        ),
      );
      data = (
        await result(
          await action(
            request(
              '/api/action',
              {
                type: 'settings.save',
                revision: data.revision,
                payload: { avatarUrl: uploaded.url, theme: 'light' },
              },
              adminCookie,
            ),
          ),
        )
      ).data;
      const adminFileId = uploaded.url.split('/').at(-1);
      await result(
        await file(request(uploaded.url, undefined, aliceCookie), {
          params: Promise.resolve({ id: adminFileId }),
        }),
        404,
      );
      const aliceData = await readData(aliceCookie);
      assert.equal(aliceData.settings.theme, 'system');
      await result(
        await action(
          request(
            '/api/action',
            {
              type: 'settings.save',
              revision: aliceData.revision,
              payload: { avatarUrl: uploaded.url },
            },
            aliceCookie,
          ),
        ),
        400,
      );
      assert.equal((await readData(bobCookie)).subscriptions.length, 0);
      administratorBackup = await result(
        await exportData(request('/api/export?format=json', undefined, adminCookie)),
      );
      const emptyExport = await result(
        await exportData(request('/api/export?format=json', undefined, bobCookie)),
      );
      assert.equal(emptyExport.data.subscriptions.length, 0);
      assert.equal(emptyExport.uploads.length, 0);
      const restored = await result(
        await importData(
          request(
            '/api/import',
            {
              mode: 'restore',
              backup: administratorBackup,
              confirmation: '覆盖现有数据',
              revision: aliceData.revision,
            },
            aliceCookie,
          ),
        ),
      );
      assert.equal(restored.data.subscriptions[0].id, data.subscriptions[0].id);
      assert.notEqual(restored.data.settings.avatarUrl, uploaded.url);
      const ownFile = await file(
        request(restored.data.settings.avatarUrl, undefined, aliceCookie),
        { params: Promise.resolve({ id: restored.data.settings.avatarUrl.split('/').at(-1) }) },
      );
      assert.equal(ownFile.status, 200);
      const aliceExport = await result(
        await exportData(request('/api/export?format=json', undefined, aliceCookie)),
      );
      assert.notEqual(aliceExport.uploads[0].id, administratorBackup.uploads[0].id);
      await result(
        await action(
          request(
            '/api/action',
            {
              type: 'subscription.save',
              revision: restored.data.revision,
              payload: { ...restored.data.subscriptions[0], name: 'Alice edited independently' },
            },
            aliceCookie,
          ),
        ),
      );
      assert.equal(
        (await readData(aliceCookie)).subscriptions[0].name,
        'Alice edited independently',
      );
      assert.equal((await readData(adminCookie)).subscriptions[0].name, 'Owner-only subscription');
    },
  );

  await t.test(
    'renaming requires current password, reserves names and preserves identity and avatar',
    async () => {
      const secondBob = await signIn('Bob');
      const reserved = await newInvite('reserved-user');
      await result(
        await username(
          request(
            '/api/account/username',
            { username: 'reserved-user', currentPassword: memberPassword },
            bobCookie,
          ),
        ),
        409,
      );
      await result(
        await username(
          request(
            '/api/account/username',
            { username: 'ALICE', currentPassword: memberPassword },
            bobCookie,
          ),
        ),
        409,
      );
      await result(
        await username(
          request(
            '/api/account/username',
            { username: 'newbob', currentPassword: 'wrong-password' },
            bobCookie,
          ),
        ),
        400,
      );
      await result(
        await username(
          request(
            '/api/account/username',
            { username: 'x', currentPassword: memberPassword },
            bobCookie,
          ),
        ),
        400,
      );
      const before = await readData(bobCookie);
      const renamed = await result(
        await username(
          request(
            '/api/account/username',
            { username: 'NewBob', currentPassword: memberPassword, role: 'admin' },
            bobCookie,
          ),
        ),
      );
      assert.deepEqual(renamed.account, { ...bob, username: 'NewBob' });
      bob.username = 'NewBob';
      const after = await readData(bobCookie);
      assert.equal(after.settings.avatarSeed, 'oxygen-account:Bob');
      assert.equal(after.revision, before.revision + 1);
      await result(await getData(request('/api/data', undefined, secondBob)), 401);
      await result(
        await login(request('/api/auth/login', { username: 'Bob', password: memberPassword })),
        401,
      );
      await signIn('newbob');
      await result(
        await revoke(
          request(
            '/api/admin/invitations/revoke',
            { id: reserved.invitation.id, currentPassword: adminPassword },
            adminCookie,
          ),
        ),
      );
    },
  );

  await t.test(
    'disable and session revocation take effect immediately; reset requires both secrets and revokes old sessions',
    async () => {
      const adminManage = (actionName: string) =>
        manage(
          request(
            '/api/admin/accounts/manage',
            { accountId: alice.id, action: actionName, currentPassword: adminPassword },
            adminCookie,
          ),
        );
      await result(await adminManage('disable'));
      await result(await getData(request('/api/data', undefined, aliceCookie)), 401);
      await result(
        await exportData(request('/api/export?format=json', undefined, aliceCookie)),
        401,
      );
      await result(
        await login(request('/api/auth/login', { username: 'Alice', password: memberPassword })),
        401,
      );
      await result(await adminManage('reset_password'), 400);
      await result(await adminManage('enable'));
      await result(await getData(request('/api/data', undefined, aliceCookie)), 401);
      aliceCookie = await signIn('Alice');
      await result(await adminManage('revoke_sessions'));
      await result(await accountInfo(request('/api/account', undefined, aliceCookie)), 401);
      aliceCookie = await signIn('Alice');
      const firstReset = await result(await adminManage('reset_password'));
      const reset = await result(await adminManage('reset_password'));
      assert.equal(new URL(reset.link).pathname, '/reset-password');
      const token = tokenFrom(reset.link);
      assert.equal(
        (await result(await inspect(request('/api/invitations/inspect', { token })))).kind,
        'password_reset',
      );
      await result(
        await accept(
          request('/api/invitations/accept', {
            token: tokenFrom(firstReset.link),
            code: firstReset.code,
            password: 'updated-member-password',
          }),
        ),
        400,
      );
      await result(
        await accept(
          request('/api/invitations/accept', {
            token,
            code: wrongCode(reset.code),
            password: 'updated-member-password',
          }),
        ),
        400,
      );
      await result(
        await accept(
          request('/api/invitations/accept', {
            token,
            code: reset.code,
            password: 'updated-member-password',
          }),
        ),
      );
      await result(await getData(request('/api/data', undefined, aliceCookie)), 401);
      await result(
        await accept(
          request('/api/invitations/accept', { token, code: reset.code, password: memberPassword }),
        ),
        400,
      );
      await result(
        await login(request('/api/auth/login', { username: 'Alice', password: memberPassword })),
        401,
      );
      aliceCookie = await signIn('Alice', 'updated-member-password');
      assert.equal(
        (await readData(aliceCookie)).settings.avatarUrl.startsWith('/api/files/'),
        true,
      );
      const pending = await result(await adminManage('reset_password'));
      await result(
        await password(
          request(
            '/api/auth/password',
            {
              currentPassword: 'updated-member-password',
              newPassword: 'self-updated-member-password',
            },
            aliceCookie,
          ),
        ),
      );
      await result(
        await accept(
          request('/api/invitations/accept', {
            token: tokenFrom(pending.link),
            code: pending.code,
            password: memberPassword,
          }),
        ),
        400,
      );
    },
  );

  await t.test(
    'administrator cannot demote/delete self; confirmed member deletion cascades only its own data',
    async () => {
      await result(
        await manage(
          request(
            '/api/admin/accounts/manage',
            {
              accountId: root.id,
              action: 'delete',
              currentPassword: adminPassword,
              confirmation: 'root',
            },
            adminCookie,
          ),
        ),
        400,
      );
      await result(
        await manage(
          request(
            '/api/admin/accounts/manage',
            {
              accountId: bob.id,
              action: 'delete',
              currentPassword: adminPassword,
              confirmation: 'incorrect-name',
            },
            adminCookie,
          ),
        ),
        400,
      );
      await result(
        await manage(
          request(
            '/api/admin/accounts/manage',
            {
              accountId: bob.id,
              action: 'delete',
              currentPassword: adminPassword,
              confirmation: bob.username,
            },
            adminCookie,
          ),
        ),
      );
      await result(await getData(request('/api/data', undefined, bobCookie)), 401);
      assert.equal((await query('SELECT id FROM accounts WHERE id=$1', [bob.id])).rows.length, 0);
      assert.equal((await readData(adminCookie)).subscriptions.length, 1);
      assert.equal(
        (await readData(aliceCookie)).settings.avatarUrl.startsWith('/api/files/'),
        true,
      );
    },
  );

  await t.test(
    'CLI reset always targets the admin role and leaves member credentials and sessions intact',
    async () => {
      await query("UPDATE accounts SET created_at=now()-interval '10 years' WHERE id=$1", [
        alice.id,
      ]);
      await resetAdministrator('replacement-admin-password');
      await result(await getData(request('/api/data', undefined, adminCookie)), 401);
      await result(
        await login(request('/api/auth/login', { username: 'root', password: adminPassword })),
        401,
      );
      assert.equal(
        (await readAccount(await signIn('root', 'replacement-admin-password'))).role,
        'admin',
      );
      assert.equal((await readAccount(aliceCookie)).role, 'member');
      await signIn('Alice', 'self-updated-member-password');
      await assert.rejects(createAdministrator('other-admin', adminPassword), /管理员已存在/);
    },
  );
});

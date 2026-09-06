import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createAdministrator } from '../lib/server/admin';
import { query, closeDatabase } from '../lib/server/db';
import { csvCell, icsEscape, icsExport } from '../lib/server/backup';
import { POST as login } from '../app/api/auth/login/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { POST as password } from '../app/api/auth/password/route';
import { GET as getData } from '../app/api/data/route';
import { POST as action } from '../app/api/action/route';
import { GET as exportData } from '../app/api/export/route';
import { POST as importData } from '../app/api/import/route';
import { POST as upload } from '../app/api/uploads/route';
import { GET as file } from '../app/api/files/[id]/route';
import { GET as avatar } from '../app/api/avatar/[seed]/route';
import { addDays, todayInTimezone, projectBills } from '../lib/billing';

const base = 'http://localhost:3000';
after(async () => {
  await closeDatabase();
});
function request(endpoint: string, body?: unknown, cookie?: string, origin = base) {
  const headers: Record<string, string> = { Origin: origin, 'X-Requested-With': 'subscribo' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function cookie(response: Response) {
  return response.headers.get('set-cookie')!.split(';')[0];
}
async function assertStatus(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
}

test('authentication, durable shared data, optimistic revisions, uploads and complete restore', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'subscribo-backend-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: base,
    PGLITE_DATA_DIR: path.join(temp, 'db'),
    UPLOAD_DIR: path.join(temp, 'uploads'),
  });
  delete process.env.DATABASE_URL;
  await assertStatus(await getData(request('/api/data')), 401);
  await assertStatus(await exportData(request('/api/export')), 401);
  await assertStatus(
    await action(request('/api/action', { type: 'settings.save', payload: { theme: 'dark' } })),
    401,
  );
  await assertStatus(
    await importData(request('/api/import', { mode: 'preview', backup: {} })),
    401,
  );
  await assertStatus(
    await file(request('/api/files/none'), { params: Promise.resolve({ id: 'none' }) }),
    401,
  );
  await assertStatus(
    await avatar(request('/api/avatar/fixed'), { params: Promise.resolve({ seed: 'fixed' }) }),
    401,
  );
  await assertStatus(
    await login(
      request(
        '/api/auth/login',
        { username: 'tester', password: 'a-test-only-password' },
        undefined,
        'https://evil.example',
      ),
    ),
    403,
  );
  await createAdministrator('tester', 'a-test-only-password');
  await assert.rejects(() => createAdministrator('second', 'another-test-password'));
  const firstLogin = await login(
    request('/api/auth/login', {
      username: 'tester',
      password: 'a-test-only-password',
      remember: true,
    }),
  );
  await assertStatus(firstLogin, 200);
  const desktop = cookie(firstLogin);
  assert.match(firstLogin.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(firstLogin.headers.get('set-cookie')!, /SameSite=lax/i);
  assert.match(firstLogin.headers.get('set-cookie')!, /Max-Age=2592000(?:;|$)/i);
  assert.match(firstLogin.headers.get('set-cookie')!, /Expires=/i);
  const secondLogin = await login(
    request('/api/auth/login', { username: 'tester', password: 'a-test-only-password' }),
  );
  await assertStatus(secondLogin, 200);
  const mobile = cookie(secondLogin);
  assert.match(secondLogin.headers.get('set-cookie')!, /Max-Age=43200(?:;|$)/i);
  const lifetimes = await query(
    'SELECT EXTRACT(EPOCH FROM (expires_at-now())) AS seconds FROM sessions ORDER BY expires_at',
  );
  assert.equal(lifetimes.rows.length, 2);
  assert.ok(
    Number(lifetimes.rows[0].seconds) > 43100 && Number(lifetimes.rows[0].seconds) <= 43200,
  );
  assert.ok(
    Number(lifetimes.rows[1].seconds) > 2591900 && Number(lifetimes.rows[1].seconds) <= 2592000,
  );
  let data = (await (await getData(request('/api/data', undefined, desktop))).json()).data;
  const day = addDays(todayInTimezone('Asia/Shanghai'), 1);
  const saved = await action(
    request(
      '/api/action',
      {
        type: 'subscription.save',
        revision: data.revision,
        payload: {
          name: '=Formula safety test',
          serviceId: 'custom',
          logo: '',
          color: '#6558d3',
          category: '效率',
          plan: 'Test only',
          kind: 'family',
          amountMinor: 3001,
          currency: 'CNY',
          interval: 1,
          unit: 'month',
          anchorDate: day,
          billingStart: day,
          trialEnd: '',
          autoRenew: true,
          status: 'active',
          stopDate: '',
          notes: 'Line 1\nLine 2',
          website: '',
        },
      },
      desktop,
    ),
  );
  await assertStatus(saved, 200);
  data = (await saved.json()).data;
  assert.equal(data.subscriptions.length, 1);
  assert.equal(data.groups.length, 1);
  const phoneData = (await (await getData(request('/api/data', undefined, mobile))).json()).data;
  assert.deepEqual(phoneData, data, 'both devices share the authoritative database');
  await assertStatus(
    await action(
      request(
        '/api/action',
        { type: 'settings.save', revision: 0, payload: { theme: 'dark' } },
        mobile,
      ),
    ),
    409,
  );
  const memberResult = await action(
    request(
      '/api/action',
      {
        type: 'member.add',
        revision: data.revision,
        payload: {
          groupId: data.groups[0].id,
          nickname: 'A member',
          seed: 'persistent-seed-123',
          joinedAt: day,
        },
      },
      desktop,
    ),
  );
  await assertStatus(memberResult, 200);
  data = (await memberResult.json()).data;
  const avatarOne = await avatar(request('/api/avatar/persistent-seed-123', undefined, desktop), {
    params: Promise.resolve({ seed: 'persistent-seed-123' }),
  });
  const avatarTwo = await avatar(request('/api/avatar/persistent-seed-123', undefined, mobile), {
    params: Promise.resolve({ seed: 'persistent-seed-123' }),
  });
  assert.equal(await avatarOne.text(), await avatarTwo.text());
  const rawImage = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#6558d3' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(rawImage)], 'logo.png', { type: 'image/png' }));
  const uploaded = await upload(
    new Request(base + '/api/uploads', {
      method: 'POST',
      headers: { Origin: base, 'X-Requested-With': 'subscribo', cookie: desktop },
      body: form,
    }),
  );
  await assertStatus(uploaded, 200);
  const image = await uploaded.json();
  const withLogo = await action(
    request(
      '/api/action',
      {
        type: 'subscription.save',
        revision: data.revision,
        payload: { ...data.subscriptions[0], logo: image.url },
      },
      desktop,
    ),
  );
  await assertStatus(withLogo, 200);
  data = (await withLogo.json()).data;
  await assertStatus(
    await action(
      request(
        '/api/action',
        {
          type: 'subscription.save',
          revision: data.revision,
          payload: {
            ...data.subscriptions[0],
            logo: '/api/files/11111111-1111-4111-8111-111111111111',
          },
        },
        desktop,
      ),
    ),
    400,
  );
  const served = await file(request(image.url, undefined, mobile), {
    params: Promise.resolve({ id: image.id }),
  });
  await assertStatus(served, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  const badForm = new FormData();
  badForm.set(
    'file',
    new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      'fake.png',
      { type: 'image/png' },
    ),
  );
  await assertStatus(
    await upload(
      new Request(base + '/api/uploads', {
        method: 'POST',
        headers: { Origin: base, 'X-Requested-With': 'subscribo', cookie: desktop },
        body: badForm,
      }),
    ),
    400,
  );
  const exported = await exportData(request('/api/export?format=json', undefined, desktop));
  await assertStatus(exported, 200);
  const backup = await exported.json();
  assert.equal(backup.uploads.length, 1);
  assert.equal(backup.data.members[0].seed, 'persistent-seed-123');
  assert.doesNotMatch(JSON.stringify(backup), /password_hash|token_hash|a-test-only-password/);
  const preview = await importData(request('/api/import', { mode: 'preview', backup }, desktop));
  await assertStatus(preview, 200);
  assert.equal((await preview.json()).preview.uploads, 1);
  await assertStatus(
    await importData(
      request('/api/import', { mode: 'restore', backup, revision: data.revision }, desktop),
    ),
    400,
  );
  const modified = await action(
    request(
      '/api/action',
      { type: 'settings.save', revision: data.revision, payload: { theme: 'dark' } },
      desktop,
    ),
  );
  await assertStatus(modified, 200);
  data = (await modified.json()).data;
  const restored = await importData(
    request(
      '/api/import',
      { mode: 'restore', backup, revision: data.revision, confirmation: '覆盖现有数据' },
      desktop,
    ),
  );
  await assertStatus(restored, 200);
  data = (await restored.json()).data;
  assert.equal(data.settings.theme, backup.data.settings.theme);
  assert.equal(data.members[0].seed, 'persistent-seed-123');
  assert.notEqual(
    data.subscriptions[0].logo,
    image.url,
    'restored uploads receive safe local identifiers',
  );
  const restoredImageId = data.subscriptions[0].logo.split('/').at(-1);
  await assertStatus(
    await file(request(data.subscriptions[0].logo, undefined, mobile), {
      params: Promise.resolve({ id: restoredImageId }),
    }),
    200,
  );
  const exportedCSV = await exportData(request('/api/export?format=csv', undefined, desktop));
  assert.match(await exportedCSV.text(), /"'=Formula safety test"/);
  const calendar = await exportData(request('/api/export?format=ics', undefined, desktop));
  const ics = await calendar.text();
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:/);
  assert.ok(!/(^|[^\r])\n/.test(ics));
  const snapshots = structuredClone(data);
  const projected = projectBills(snapshots, day, day)[0];
  snapshots.bills.push({ ...projected, id: 'new-persisted-snapshot' });
  assert.deepEqual(
    icsExport(snapshots).match(/^UID:.+$/gm),
    icsExport(data).match(/^UID:.+$/gm),
    'calendar identities survive materializing projected bills',
  );
  const persisted = await query('SELECT payload FROM subscriptions');
  assert.equal(persisted.rows[0].payload.name, '=Formula safety test');
  const credentials = await query('SELECT password_hash FROM accounts');
  assert.match(credentials.rows[0].password_hash, /^\$argon2id\$/);
  const tokens = await query('SELECT token_hash FROM sessions');
  assert.ok(
    tokens.rows.every(
      (row) => !desktop.includes(row.token_hash) && !mobile.includes(row.token_hash),
    ),
  );
  await assertStatus(
    await password(
      request(
        '/api/auth/password',
        {
          currentPassword: 'a-test-only-password',
          newPassword: 'changed-test-only-password',
          revokeOthers: true,
        },
        desktop,
      ),
    ),
    200,
  );
  await assertStatus(await getData(request('/api/data', undefined, mobile)), 401);
  await assertStatus(await getData(request('/api/data', undefined, desktop)), 200);
  await assertStatus(await logout(request('/api/auth/logout', {}, desktop)), 200);
  await assertStatus(await getData(request('/api/data', undefined, desktop)), 401);
  await closeDatabase();
  const relogin = await login(
    request('/api/auth/login', { username: 'tester', password: 'changed-test-only-password' }),
  );
  await assertStatus(relogin, 200);
  const relogged = (await (await getData(request('/api/data', undefined, cookie(relogin)))).json())
    .data;
  assert.equal(relogged.subscriptions.length, 1);
  for (let attempt = 0; attempt < 5; attempt++)
    await assertStatus(
      await login(
        request('/api/auth/login', { username: 'tester', password: 'invalid-test-password' }),
      ),
      401,
    );
  await assertStatus(
    await login(
      request('/api/auth/login', { username: 'tester', password: 'changed-test-only-password' }),
    ),
    429,
  );
});

test('export escaping prevents CSV formulas and iCalendar injected properties', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), '"\'=SUM(A1:A9)"');
  assert.equal(csvCell(' \t+1'), '"\' \t+1"');
  assert.equal(icsEscape('A,B;C\r\nBEGIN:VEVENT'), 'A\\,B\\;C\\nBEGIN:VEVENT');
});

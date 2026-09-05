import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../lib/server/migrations';
import { emptyData } from '../lib/model';

test('upgrade preserves the existing administrator and data; repeated starts retain member roles and isolated IDs', async () => {
  const pg = new PGlite();
  try {
    // Reproduce the pre-upgrade schema, which had no migration ledger.
    await pg.exec(await readFile('migrations/0001_init.sql', 'utf8'));
    await pg.exec('CREATE UNIQUE INDEX accounts_single_administrator ON accounts ((true))');
    await pg.query(
      'INSERT INTO accounts(id,username,password_hash,revision,settings) VALUES($1,$2,$3,$4,$5)',
      ['original', 'root', 'preserved-hash', 17, JSON.stringify(emptyData().settings)],
    );
    const tables = [
      'subscriptions',
      'family_groups',
      'members',
      'memberships',
      'bills',
      'allocations',
    ];
    for (const table of tables)
      await pg.query(`INSERT INTO ${table}(id,owner_id,payload) VALUES($1,$2,$3)`, [
        'same-id',
        'original',
        JSON.stringify({ id: 'same-id', note: table }),
      ]);
    await pg.exec(
      "INSERT INTO sessions(id,owner_id,token_hash,expires_at) VALUES('old-session','original','old-token',now()+interval '1 day')",
    );
    await pg.exec(
      "INSERT INTO uploads(id,owner_id,filename) VALUES('old-upload','original','preserved.png')",
    );
    const migrate = () => pg.transaction((tx) => applyMigrations(tx, (sql) => tx.exec(sql)));
    await migrate();
    const {
      rows: [original],
    } = await pg.query<any>("SELECT * FROM accounts WHERE id='original'");
    assert.equal(original.username, 'root');
    assert.equal(original.password_hash, 'preserved-hash');
    assert.equal(original.role, 'admin');
    assert.equal(original.disabled_at, null);
    assert.equal(original.revision, 17);
    assert.deepEqual(original.settings, emptyData().settings);
    assert.equal((await pg.query('SELECT id FROM sessions')).rows.length, 1);
    assert.equal((await pg.query('SELECT id FROM uploads')).rows.length, 1);
    await pg.query('INSERT INTO accounts(id,username,password_hash,settings) VALUES($1,$2,$3,$4)', [
      'member',
      'alice',
      'member-hash',
      JSON.stringify(emptyData().settings),
    ]);
    for (const table of tables) {
      await pg.query(`INSERT INTO ${table}(id,owner_id,payload) VALUES($1,$2,$3)`, [
        'same-id',
        'member',
        JSON.stringify({ id: 'same-id', note: 'private-member' }),
      ]);
      assert.equal(
        (await pg.query<any>(`SELECT payload FROM ${table} WHERE owner_id='original'`)).rows[0]
          .payload.note,
        table,
      );
    }
    await migrate();
    assert.deepEqual((await pg.query('SELECT id,role FROM accounts ORDER BY id')).rows, [
      { id: 'member', role: 'member' },
      { id: 'original', role: 'admin' },
    ]);
    assert.equal((await pg.query('SELECT version FROM schema_migrations')).rows.length, 2);
    await assert.rejects(() => pg.query("UPDATE accounts SET role='admin' WHERE id='member'"));
    await assert.rejects(() => pg.query("UPDATE accounts SET username='ROOT' WHERE id='member'"));
    await pg.exec("DELETE FROM accounts WHERE id='member'");
    for (const table of tables)
      assert.equal((await pg.query(`SELECT id FROM ${table}`)).rows.length, 1);
  } finally {
    await pg.close();
  }
});

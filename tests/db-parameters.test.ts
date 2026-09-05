import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { statement, query, transaction, closeDatabase } from '../lib/server/db';

after(async () => closeDatabase());

test('PostgreSQL compilation binds an image ID array as one parameter', () => {
  const dialect = new PgDialect();
  for (const ids of [
    [],
    ['one-avatar'],
    ['avatar', 'subscription-logo'],
    ["quote'}); SELECT 1--"],
  ]) {
    const compiled = dialect.sqlToQuery(
      statement('SELECT id FROM uploads WHERE owner_id=$1 AND id=ANY($2::text[])', ['owner', ids]),
    );
    assert.equal(compiled.sql, 'SELECT id FROM uploads WHERE owner_id=$1 AND id=ANY($2::text[])');
    assert.deepEqual(compiled.params, ['owner', ids]);
  }
});

test('ordinary and transactional queries share PostgreSQL array binding behavior', async () => {
  Object.assign(process.env, { NODE_ENV: 'test', PGLITE_DATA_DIR: ':memory:' });
  delete process.env.DATABASE_URL;
  for (const execute of [
    query,
    <T>(sql: string, parameters?: unknown[]) => transaction((tx) => tx.query<T>(sql, parameters)),
  ]) {
    for (const ids of [
      [],
      ['avatar-id'],
      ['avatar-id', 'another-image'],
      ["quote'}); SELECT 1--"],
    ]) {
      const { rows } = await execute<{ matches: boolean; ids: string[] }>(
        'SELECT $1::text = ANY($2::text[]) AS matches, $2::text[] AS ids',
        ['avatar-id', ids],
      );
      assert.equal(rows[0].matches, ids.includes('avatar-id'));
      assert.deepEqual(rows[0].ids, ids);
    }
  }
});

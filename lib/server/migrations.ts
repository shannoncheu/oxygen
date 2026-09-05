import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SQLExecutor } from './db';

// The caller owns the transaction and, on PostgreSQL, the migration advisory lock.
// A ledger avoids replaying old migrations after the schema has moved on.
export async function applyMigrations(tx: SQLExecutor, execute: (sql: string) => Promise<unknown>) {
  await tx.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await tx.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.version));
  const directory = path.join(process.cwd(), 'migrations');
  const files = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    await execute(await readFile(path.join(directory, name), 'utf8'));
    await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [name]);
  }
}

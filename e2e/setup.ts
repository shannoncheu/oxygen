import path from 'node:path';
import { rm } from 'node:fs/promises';
import { createAdministrator } from '../lib/server/admin';
import { closeDatabase } from '../lib/server/db';
export default async function setup() {
  const root = path.resolve(process.cwd(), 'test-results');
  const db = path.resolve(root, 'e2e-database');
  if (!db.startsWith(root + path.sep)) throw new Error('Unsafe test database path');
  await rm(db, { recursive: true, force: true });
  Object.assign(process.env, { NODE_ENV: 'test', PGLITE_DATA_DIR: db });
  delete process.env.DATABASE_URL;
  await createAdministrator('e2e-admin', 'only-for-isolated-e2e-testing');
  await closeDatabase();
}

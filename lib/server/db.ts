import { Pool } from 'pg';
import { drizzle as postgresDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { sql as drizzleSQL, type SQL } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as schema from './schema';
import type { BusinessData } from '../model';

export interface SQLExecutor {
  query<T = Record<string, any>>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
}
type Database = SQLExecutor & {
  transaction<T>(fn: (tx: SQLExecutor) => Promise<T>): Promise<T>;
  orm: unknown;
  close(): Promise<void>;
};
// Convert positional parameters into Drizzle bound values (never interpolated text).
export function statement(text: string, parameters: unknown[] = []): SQL {
  const chunks: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    chunks.push(drizzleSQL.raw(text.slice(last, match.index)));
    // A bare array in a Drizzle template becomes a SQL list, not a PostgreSQL
    // array parameter. Bind every value explicitly so ANY($n::text[]) receives
    // the original array, including empty arrays and single-image avatars.
    chunks.push(drizzleSQL`${drizzleSQL.param(parameters[Number(match[1]) - 1])}`);
    last = match.index! + match[0].length;
  }
  chunks.push(drizzleSQL.raw(text.slice(last)));
  return drizzleSQL.join(chunks, drizzleSQL.raw(''));
}
const globalDb = globalThis as typeof globalThis & { __subscriboDatabase?: Promise<Database> };
async function connect(): Promise<Database> {
  const migration = await readFile(path.join(process.cwd(), 'migrations/0001_init.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    // Advisory lock prevents migration races between web and administrator containers.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(71182411)');
      await client.query(migration);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const orm = postgresDrizzle(pool, { schema });
    return {
      orm,
      close: () => pool.end(),
      query: async <T>(sql: string, parameters?: unknown[]) => ({
        rows: (await orm.execute(statement(sql, parameters))).rows as T[],
      }),
      transaction: async (fn) => {
        const client = await pool.connect();
        const transactionalORM = postgresDrizzle(client, { schema });
        try {
          await client.query('BEGIN');
          const value = await fn({
            query: async <T>(sql: string, parameters?: unknown[]) => ({
              rows: (await transactionalORM.execute(statement(sql, parameters))).rows as T[],
            }),
          });
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('Production requires DATABASE_URL. Configure PostgreSQL before starting.');
  const location = process.env.PGLITE_DATA_DIR || path.join(process.cwd(), '.data', 'pglite');
  if (location !== ':memory:') await mkdir(location, { recursive: true });
  const pg = new PGlite(location === ':memory:' ? undefined : location);
  await pg.exec(migration);
  const orm = pgliteDrizzle(pg, { schema });
  return {
    orm,
    close: () => pg.close(),
    query: async <T>(sql: string, parameters?: unknown[]) => ({
      rows: (await orm.execute(statement(sql, parameters))).rows as T[],
    }),
    transaction: async (fn) =>
      orm.transaction(async (tx) =>
        fn({
          query: async <T>(sql: string, parameters?: unknown[]) => ({
            rows: (await tx.execute(statement(sql, parameters))).rows as T[],
          }),
        }),
      ),
  };
}
export function database(): Promise<Database> {
  return (globalDb.__subscriboDatabase ??= connect());
}
export async function closeDatabase() {
  if (globalDb.__subscriboDatabase) {
    await (await globalDb.__subscriboDatabase).close();
    delete globalDb.__subscriboDatabase;
  }
}
export async function query<T = Record<string, any>>(sql: string, parameters?: unknown[]) {
  return (await database()).query<T>(sql, parameters);
}
export async function transaction<T>(fn: (tx: SQLExecutor) => Promise<T>) {
  return (await database()).transaction(fn);
}

const entities = {
  subscriptions: 'subscriptions',
  groups: 'family_groups',
  members: 'members',
  memberships: 'memberships',
  bills: 'bills',
  allocations: 'allocations',
} as const;
export async function readBusiness(
  tx: SQLExecutor,
  ownerId: string,
  lock = false,
): Promise<BusinessData> {
  const {
    rows: [account],
  } = await tx.query(
    'SELECT settings,revision FROM accounts WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
    [ownerId],
  );
  if (!account) throw new Error('Account no longer exists');
  const data = { settings: account.settings, revision: account.revision } as BusinessData;
  for (const [key, table] of Object.entries(entities)) {
    const { rows } = await tx.query(
      'SELECT payload FROM ' + table + ' WHERE owner_id=$1 ORDER BY id',
      [ownerId],
    );
    (data as any)[key] = rows.map((row) => row.payload);
  }
  return data;
}
export async function writeBusiness(
  tx: SQLExecutor,
  ownerId: string,
  data: BusinessData,
): Promise<void> {
  for (const [key, table] of Object.entries(entities)) {
    await tx.query('DELETE FROM ' + table + ' WHERE owner_id=$1', [ownerId]);
    const values = (data as any)[key] as { id: string }[];
    // Bulk insert each collection; table names are fixed constants, all values are parameters.
    if (values.length)
      await tx.query(
        'INSERT INTO ' +
          table +
          " (id,owner_id,payload) SELECT item->>'id',$1,item FROM jsonb_array_elements($2::jsonb) item",
        [ownerId, JSON.stringify(values)],
      );
  }
  await tx.query('UPDATE accounts SET settings=$2::jsonb,revision=$3 WHERE id=$1', [
    ownerId,
    JSON.stringify(data.settings),
    data.revision,
  ]);
}

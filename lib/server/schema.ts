import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  Settings,
  Subscription,
  FamilyGroup,
  Member,
  Membership,
  Bill,
  Allocation,
} from '../model';

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(0),
    settings: jsonb('settings').$type<Settings>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('accounts_username_casefold').on(sql`lower(${table.username})`),
    uniqueIndex('accounts_one_administrator')
      .on(sql`(true)`)
      .where(sql`${table.role}='admin'`),
    check('accounts_role_check', sql`${table.role} IN ('admin','member')`),
  ],
);
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const loginLimits = pgTable('login_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
});
const columns = <T>() => ({
  id: text('id').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<T>().notNull(),
});
export const subscriptions = pgTable('subscriptions', columns<Subscription>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const familyGroups = pgTable('family_groups', columns<FamilyGroup>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const members = pgTable('members', columns<Member>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const memberships = pgTable('memberships', columns<Membership>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const bills = pgTable('bills', columns<Bill>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const allocations = pgTable('allocations', columns<Allocation>(), (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
]);
export const accountTokens = pgTable('account_tokens', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'invitation' | 'password_reset'>().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  codeHash: text('code_hash').notNull(),
  username: text('username').notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => accounts.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const uploads = pgTable('uploads', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
// Memberships and immutable bill/allocation payloads are validated by the domain layer.
// SQL owner constraints and a locked account row protect all reads and mutations.

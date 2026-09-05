import { pgTable, text, timestamp, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  Settings,
  Subscription,
  FamilyGroup,
  Member,
  Membership,
  Bill,
  Allocation,
} from '../model';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  revision: integer('revision').notNull().default(0),
  settings: jsonb('settings').$type<Settings>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
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
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<T>().notNull(),
});
export const subscriptions = pgTable('subscriptions', columns<Subscription>());
export const familyGroups = pgTable('family_groups', columns<FamilyGroup>());
export const members = pgTable('members', columns<Member>());
export const memberships = pgTable('memberships', columns<Membership>());
export const bills = pgTable('bills', columns<Bill>());
export const allocations = pgTable('allocations', columns<Allocation>());
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

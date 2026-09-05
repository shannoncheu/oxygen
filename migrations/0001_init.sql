CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, username text NOT NULL UNIQUE,
 password_hash text NOT NULL, revision integer NOT NULL DEFAULT 0,
 settings jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_administrator ON accounts ((true));
CREATE TABLE IF NOT EXISTS sessions (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_limits (key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS family_groups (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS members (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS bills (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS allocations (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS subscriptions_owner ON subscriptions(owner_id);
CREATE INDEX IF NOT EXISTS family_groups_owner ON family_groups(owner_id);
CREATE INDEX IF NOT EXISTS members_owner ON members(owner_id);
CREATE INDEX IF NOT EXISTS memberships_owner ON memberships(owner_id);
CREATE INDEX IF NOT EXISTS bills_owner ON bills(owner_id);
CREATE INDEX IF NOT EXISTS allocations_owner ON allocations(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_group_per_subscription ON family_groups(owner_id, (payload->>'subscriptionId'));
CREATE UNIQUE INDEX IF NOT EXISTS one_bill_per_period ON bills(owner_id, (payload->>'subscriptionId'), (payload->>'dueDate'));
CREATE UNIQUE INDEX IF NOT EXISTS one_allocation_per_member ON allocations(owner_id, (payload->>'billId'), (payload->>'memberId'));
CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, filename text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner_id);

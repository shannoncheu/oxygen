-- Existing installations have one administrator. Preserve that account and all data.
ALTER TABLE accounts ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member'));
ALTER TABLE accounts ADD COLUMN disabled_at timestamptz;
UPDATE accounts SET role='admin';
DROP INDEX IF EXISTS accounts_single_administrator;
CREATE UNIQUE INDEX accounts_one_administrator ON accounts ((true)) WHERE role='admin';
CREATE UNIQUE INDEX accounts_username_casefold ON accounts (lower(username));

-- Business identifiers belong to an account, including identifiers in imported backups.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_pkey, ADD PRIMARY KEY (owner_id,id);
ALTER TABLE family_groups DROP CONSTRAINT family_groups_pkey, ADD PRIMARY KEY (owner_id,id);
ALTER TABLE members DROP CONSTRAINT members_pkey, ADD PRIMARY KEY (owner_id,id);
ALTER TABLE memberships DROP CONSTRAINT memberships_pkey, ADD PRIMARY KEY (owner_id,id);
ALTER TABLE bills DROP CONSTRAINT bills_pkey, ADD PRIMARY KEY (owner_id,id);
ALTER TABLE allocations DROP CONSTRAINT allocations_pkey, ADD PRIMARY KEY (owner_id,id);

CREATE TABLE account_tokens (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('invitation','password_reset')),
 token_hash text NOT NULL UNIQUE,
 code_hash text NOT NULL,
 username text NOT NULL,
 account_id text REFERENCES accounts(id) ON DELETE CASCADE,
 created_by text NOT NULL REFERENCES accounts(id),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 revoked_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='invitation' AND account_id IS NULL) OR (kind='password_reset' AND account_id IS NOT NULL))
);
CREATE INDEX account_tokens_creator ON account_tokens(created_by);
CREATE INDEX account_tokens_account ON account_tokens(account_id);

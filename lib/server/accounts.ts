import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { defaultSettings } from '../model';
import { transaction, query, type SQLExecutor } from './db';
import { APIError } from './errors';
import { imagePath } from './uploads';
import {
  type Account,
  applicationURL,
  hashPassword,
  lockAccountNames,
  lockActiveAccount,
  rateLimit,
  tokenHash,
  validatePassword,
  validateUsername,
  verifyCurrentPassword,
} from './auth';

const invalidLink = () =>
  new APIError(400, '链接或验证码无效、已过期或已被使用，请联系管理员重新生成。');
type TokenKind = 'invitation' | 'password_reset';
type TokenRow = {
  id: string;
  kind: TokenKind;
  token_hash: string;
  code_hash: string;
  username: string;
  account_id: string | null;
  created_by: string;
  expires_at: string | Date;
  consumed_at: string | Date | null;
  revoked_at: string | Date | null;
  attempts: number;
  created_at: string | Date;
};
const asISO = (value: string | Date) => new Date(value).toISOString();
function liveToken(row: TokenRow | undefined): row is TokenRow {
  return Boolean(
    row &&
    !row.consumed_at &&
    !row.revoked_at &&
    row.attempts < 5 &&
    new Date(row.expires_at).getTime() > Date.now(),
  );
}
function validTokenInput(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidLink();
}
function assertAdministrator(account: Account) {
  if (account.role !== 'admin') throw new APIError(403, '只有管理员可以执行此操作。');
}
export function publicAccount(account: Pick<Account, 'id' | 'username' | 'role'>) {
  return { id: account.id, username: account.username, role: account.role };
}
async function reserveUsername(tx: SQLExecutor, username: string, ownAccountId?: string) {
  const existing = await tx.query(
    'SELECT id FROM accounts WHERE lower(username)=lower($1) AND ($2::text IS NULL OR id<>$2)',
    [username, ownAccountId || null],
  );
  const invitation = await tx.query(
    "SELECT id FROM account_tokens WHERE kind='invitation' AND lower(username)=lower($1) AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() AND attempts<5",
    [username],
  );
  if (existing.rows.length || invitation.rows.length)
    throw new APIError(409, '这个用户名已被使用或已预留给有效邀请。');
}
export async function changeUsername(account: Account, value: unknown, currentPassword: unknown) {
  const username = validateUsername(value);
  const expectedHash = await verifyCurrentPassword(account, currentPassword);
  return transaction(async (tx) => {
    await lockAccountNames(tx);
    const row = await lockActiveAccount(tx, account, expectedHash);
    await reserveUsername(tx, username, account.id);
    await tx.query('UPDATE accounts SET username=$2 WHERE id=$1', [account.id, username]);
    await tx.query(
      "UPDATE accounts SET settings=jsonb_set(settings,'{avatarSeed}',to_jsonb($2::text)),revision=revision+1 WHERE id=$1 AND COALESCE(settings->>'avatarSeed','')=''",
      [account.id, 'oxygen-account:' + row.username],
    );
    await tx.query(
      "UPDATE account_tokens SET username=$2 WHERE account_id=$1 AND kind='password_reset' AND consumed_at IS NULL AND revoked_at IS NULL",
      [account.id, username],
    );
    await tx.query('DELETE FROM sessions WHERE owner_id=$1 AND id<>$2', [
      account.id,
      account.sessionId,
    ]);
    await tx.query('DELETE FROM login_limits WHERE key=$1 OR key=$2', [
      tokenHash(row.username.toLocaleLowerCase('en-US')),
      tokenHash(username.toLocaleLowerCase('en-US')),
    ]);
    return publicAccount({ id: account.id, username, role: row.role });
  });
}
export async function listAccounts(account: Account) {
  assertAdministrator(account);
  return transaction(async (tx) => {
    await lockActiveAccount(tx, account, undefined, true);
    const { rows: accounts } = await tx.query(
      'SELECT id,username,role,disabled_at,created_at FROM accounts ORDER BY created_at,id',
    );
    const { rows: tokens } = await tx.query<TokenRow>(
      'SELECT id,kind,username,account_id,expires_at,created_at,consumed_at,revoked_at,attempts FROM account_tokens WHERE created_by=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
      [account.id],
    );
    return {
      accounts: accounts.map((row) => ({
        ...publicAccount({ id: row.id, username: row.username, role: row.role }),
        disabledAt: row.disabled_at ? asISO(row.disabled_at) : null,
        createdAt: asISO(row.created_at),
      })),
      invitations: tokens.map((row) => ({
        id: row.id,
        kind: row.kind,
        username: row.username,
        accountId: row.account_id,
        expiresAt: asISO(row.expires_at),
        createdAt: asISO(row.created_at),
        consumedAt: row.consumed_at ? asISO(row.consumed_at) : null,
        revokedAt: row.revoked_at ? asISO(row.revoked_at) : null,
        attempts: row.attempts,
      })),
    };
  });
}
async function issueToken(
  tx: SQLExecutor,
  creatorId: string,
  kind: TokenKind,
  username: string,
  accountId: string | null,
  lifetime: number,
) {
  const token = randomBytes(32).toString('hex');
  const code = randomInt(0, 100_000_000).toString().padStart(8, '0');
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + lifetime).toISOString();
  await tx.query(
    'INSERT INTO account_tokens(id,kind,token_hash,code_hash,username,account_id,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      id,
      kind,
      tokenHash(token),
      tokenHash(token + ':' + code),
      username,
      accountId,
      creatorId,
      expiresAt,
    ],
  );
  const link = new URL(kind === 'invitation' ? '/register' : '/reset-password', applicationURL());
  link.hash = token;
  return { invitation: { id, username, expiresAt }, link: link.toString(), code, expiresAt };
}
export async function createInvitation(
  account: Account,
  input: { username?: unknown; expiresInDays?: unknown; currentPassword?: unknown },
) {
  assertAdministrator(account);
  const username = validateUsername(input.username),
    days = input.expiresInDays ?? 7;
  if (![1, 3, 7].includes(days as number))
    throw new APIError(400, '邀请有效期可选择 1、3 或 7 天。');
  const expectedHash = await verifyCurrentPassword(account, input.currentPassword);
  return transaction(async (tx) => {
    await lockAccountNames(tx);
    await lockActiveAccount(tx, account, expectedHash, true);
    await reserveUsername(tx, username);
    const {
      rows: [{ count }],
    } = await tx.query(
      "SELECT count(*)::integer AS count FROM account_tokens WHERE kind='invitation' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() AND attempts<5",
    );
    if (count >= 100) throw new APIError(400, '当前有效邀请已达 100 个，请先撤销不需要的邀请。');
    return issueToken(tx, account.id, 'invitation', username, null, Number(days) * 86400_000);
  });
}
export async function revokeInvitation(account: Account, id: unknown, currentPassword: unknown) {
  assertAdministrator(account);
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
    throw new APIError(400, '邀请标识无效。');
  const expectedHash = await verifyCurrentPassword(account, currentPassword);
  await transaction(async (tx) => {
    await lockAccountNames(tx);
    await lockActiveAccount(tx, account, expectedHash, true);
    const found = await tx.query('SELECT id FROM account_tokens WHERE id=$1 AND created_by=$2', [
      id,
      account.id,
    ]);
    if (!found.rows.length) throw new APIError(404, '邀请不存在。');
    await tx.query(
      'UPDATE account_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND consumed_at IS NULL',
      [id],
    );
  });
}
export async function manageAccount(
  account: Account,
  input: {
    accountId?: unknown;
    action?: unknown;
    currentPassword?: unknown;
    confirmation?: unknown;
  },
) {
  assertAdministrator(account);
  const { accountId, action } = input;
  if (typeof accountId !== 'string' || !/^[a-f0-9-]{36}$/.test(accountId))
    throw new APIError(400, '账号标识无效。');
  if (
    !['disable', 'enable', 'revoke_sessions', 'delete', 'reset_password'].includes(String(action))
  )
    throw new APIError(400, '请选择有效的管理操作。');
  if (accountId === account.id) throw new APIError(400, '请在账号与安全中修改自己的账号。');
  const expectedHash = await verifyCurrentPassword(account, input.currentPassword);
  const result = await transaction(async (tx) => {
    await lockAccountNames(tx);
    await lockActiveAccount(tx, account, expectedHash, true);
    const {
      rows: [target],
    } = await tx.query('SELECT id,username,role,disabled_at FROM accounts WHERE id=$1 FOR UPDATE', [
      accountId,
    ]);
    if (!target) throw new APIError(404, '账号不存在。');
    if (target.role !== 'member') throw new APIError(403, '不能通过此功能操作管理员账号。');
    if (action === 'enable') {
      await tx.query('UPDATE accounts SET disabled_at=NULL WHERE id=$1', [accountId]);
    } else if (action === 'disable') {
      await tx.query('UPDATE accounts SET disabled_at=now() WHERE id=$1', [accountId]);
      await tx.query('DELETE FROM sessions WHERE owner_id=$1', [accountId]);
      await tx.query(
        'UPDATE account_tokens SET revoked_at=now() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',
        [accountId],
      );
    } else if (action === 'revoke_sessions') {
      await tx.query('DELETE FROM sessions WHERE owner_id=$1', [accountId]);
    } else if (action === 'delete') {
      if (input.confirmation !== target.username)
        throw new APIError(400, '请准确输入要删除的用户名。');
      const { rows: files } = await tx.query('SELECT filename FROM uploads WHERE owner_id=$1', [
        accountId,
      ]);
      await tx.query('DELETE FROM accounts WHERE id=$1', [accountId]);
      return { ok: true as const, files: files.map((file) => file.filename as string) };
    } else if (action === 'reset_password') {
      if (target.disabled_at) throw new APIError(400, '请先启用账号，再生成密码重置链接。');
      await tx.query(
        "UPDATE account_tokens SET revoked_at=now() WHERE account_id=$1 AND kind='password_reset' AND consumed_at IS NULL AND revoked_at IS NULL",
        [accountId],
      );
      const issued = await issueToken(
        tx,
        account.id,
        'password_reset',
        target.username,
        accountId,
        3600_000,
      );
      return {
        ok: true as const,
        link: issued.link,
        code: issued.code,
        expiresAt: issued.expiresAt,
        files: [] as string[],
      };
    }
    return { ok: true as const, files: [] as string[] };
  });
  // Only committed, owner-scoped records are removed, and imagePath accepts UUID PNG names only.
  await Promise.allSettled(result.files.map((filename) => unlink(imagePath(filename))));
  const { files: _files, ...response } = result;
  return response;
}
async function publicTokenLimit(token: string, inspect = false) {
  await rateLimit([
    { key: inspect ? 'tokens:inspect:global' : 'tokens:accept:global', max: inspect ? 200 : 100 },
    {
      key: (inspect ? 'tokens:inspect:' : 'tokens:accept:') + tokenHash(token),
      max: inspect ? 30 : 10,
    },
  ]);
}
export async function inspectInvitation(token: unknown) {
  validTokenInput(token);
  await publicTokenLimit(token, true);
  const {
    rows: [row],
  } = await query<TokenRow>('SELECT * FROM account_tokens WHERE token_hash=$1', [tokenHash(token)]);
  if (!liveToken(row)) throw invalidLink();
  if (row.account_id) {
    const account = await query('SELECT id FROM accounts WHERE id=$1 AND disabled_at IS NULL', [
      row.account_id,
    ]);
    if (!account.rows.length) throw invalidLink();
  }
  return { kind: row.kind, username: row.username, expiresAt: asISO(row.expires_at) };
}
export async function acceptInvitation(input: {
  token?: unknown;
  code?: unknown;
  password?: unknown;
}) {
  const { token, code, password } = input;
  validTokenInput(token);
  await publicTokenLimit(token);
  validatePassword(password);
  const outcome = await transaction(async (tx) => {
    await lockAccountNames(tx);
    const {
      rows: [row],
    } = await tx.query<TokenRow>('SELECT * FROM account_tokens WHERE token_hash=$1 FOR UPDATE', [
      tokenHash(token),
    ]);
    if (!liveToken(row)) return null;
    const supplied =
      typeof code === 'string' && /^[0-9]{8}$/.test(code)
        ? tokenHash(token + ':' + code)
        : tokenHash('invalid-code');
    if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(supplied, 'hex'))) {
      // Do not throw inside this transaction: the attempt must remain committed.
      await tx.query('UPDATE account_tokens SET attempts=attempts+1 WHERE id=$1', [row.id]);
      return null;
    }
    if (row.kind === 'password_reset') {
      const {
        rows: [target],
      } = await tx.query(
        'SELECT id,username,role,disabled_at FROM accounts WHERE id=$1 FOR UPDATE',
        [row.account_id],
      );
      if (!target || target.disabled_at || target.role !== 'member') return null;
      await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [
        target.id,
        await hashPassword(password),
      ]);
      await tx.query('DELETE FROM sessions WHERE owner_id=$1', [target.id]);
      await tx.query('DELETE FROM login_limits WHERE key=$1', [
        tokenHash(target.username.toLocaleLowerCase('en-US')),
      ]);
      await tx.query(
        "UPDATE account_tokens SET revoked_at=now() WHERE account_id=$1 AND id<>$2 AND kind='password_reset' AND consumed_at IS NULL AND revoked_at IS NULL",
        [target.id, row.id],
      );
    } else {
      const existing = await tx.query('SELECT id FROM accounts WHERE lower(username)=lower($1)', [
        row.username,
      ]);
      if (existing.rows.length) return null;
      await tx.query(
        "INSERT INTO accounts(id,username,password_hash,settings,role) VALUES($1,$2,$3,$4::jsonb,'member')",
        [randomUUID(), row.username, await hashPassword(password), JSON.stringify(defaultSettings)],
      );
      await tx.query('DELETE FROM login_limits WHERE key=$1', [
        tokenHash(row.username.toLocaleLowerCase('en-US')),
      ]);
    }
    await tx.query('UPDATE account_tokens SET consumed_at=now() WHERE id=$1', [row.id]);
    return { ok: true, username: row.username };
  });
  if (!outcome) throw invalidLink();
  return outcome;
}

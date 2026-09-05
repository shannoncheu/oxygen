import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { query, transaction } from './db';
import { APIError } from './errors';

export const SESSION_COOKIE = 'subscribo_session';
// @node-rs/argon2 declares Algorithm as an ambient const enum; use its documented
// Argon2id numeric value to remain compatible with Next isolatedModules.
const ARGON2ID = 2;
let activePasswordJobs = 0;
const passwordQueue: (() => void)[] = [];
async function passwordJob<T>(work: () => Promise<T>): Promise<T> {
  // Bound Argon2's native memory use even during concurrent anonymous logins.
  if (activePasswordJobs >= 2) {
    if (passwordQueue.length >= 18) throw new APIError(429, '登录请求繁忙，请稍后重试。');
    await new Promise<void>((resolve) => passwordQueue.push(resolve));
  } else activePasswordJobs++;
  try {
    return await work();
  } finally {
    const next = passwordQueue.shift();
    if (next) next();
    else activePasswordJobs--;
  }
}
export interface Account {
  id: string;
  username: string;
  sessionId: string;
}
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function applicationURL(): URL {
  const raw =
    process.env.APP_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
  if (!raw) throw new Error('APP_URL must be configured');
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('APP_URL must be an origin such as https://subscriptions.example.com');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    throw new Error('Production APP_URL must use HTTPS');
  return url;
}
export function requireUnsafeRequest(request: Request) {
  if (
    request.headers.get('origin') !== applicationURL().origin ||
    request.headers.get('x-requested-with') !== 'subscribo'
  )
    throw new APIError(403, '请求来源校验失败，请从本站页面重试。');
}
function extractToken(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(SESSION_COOKIE + '='))
    ?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export async function accountForToken(token: string | null | undefined): Promise<Account | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const {
    rows: [row],
  } = await query(
    'SELECT a.id,a.username,s.id AS session_id FROM sessions s JOIN accounts a ON a.id=s.owner_id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [tokenHash(token)],
  );
  return row ? { id: row.id, username: row.username, sessionId: row.session_id } : null;
}
export async function getAccount(request: Request) {
  return accountForToken(extractToken(request));
}
export async function currentAccount() {
  return accountForToken((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireAccount(request: Request) {
  const account = await getAccount(request);
  if (!account) throw new APIError(401, '请先登录。');
  return account;
}
export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new APIError(400, '密码需要 12–128 个字符。');
}
export async function hashPassword(password: string) {
  validatePassword(password);
  return passwordJob(() =>
    hash(password, {
      algorithm: ARGON2ID,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    }),
  );
}
export function setSessionCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}
export function clearSessionCookie(response: NextResponse) {
  setSessionCookie(response, '', 0);
}
export async function authenticate(username: unknown, password: unknown, remember: unknown) {
  if (
    typeof username !== 'string' ||
    !username.trim() ||
    username.length > 64 ||
    typeof password !== 'string' ||
    password.length > 128
  )
    throw new APIError(400, '请输入有效的账号和密码。');
  username = username.trim();
  // Persistent account-based limiter; arbitrary client X-Forwarded-For is never trusted.
  // A global bucket also bounds requests against random nonexistent usernames.
  const keys = ['global', tokenHash(String(username).toLocaleLowerCase('en-US'))];
  await transaction(async (tx) => {
    await tx.query("DELETE FROM login_limits WHERE window_start<now()-interval '1 day'");
    for (const key of keys) {
      const {
        rows: [limit],
      } = await tx.query(
        "INSERT INTO login_limits(key,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,window_start=CASE WHEN login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE login_limits.window_start END RETURNING attempts",
        [key],
      );
      if (limit.attempts > (key === 'global' ? 100 : 5))
        throw new APIError(429, '尝试次数过多，请 15 分钟后重试。');
    }
  });
  const {
    rows: [account],
  } = await query('SELECT id,username,password_hash FROM accounts WHERE username=$1', [username]);
  // A fixed-cost hash on unknown users makes both branches perform Argon2 work.
  const submittedPassword = password;
  const valid = await passwordJob(async () =>
    account
      ? await verify(account.password_hash, submittedPassword)
      : Boolean(
          await hash(submittedPassword, {
            algorithm: ARGON2ID,
            memoryCost: 65536,
            timeCost: 3,
            parallelism: 1,
          }),
        ) && false,
  );
  if (!valid) throw new APIError(401, '账号或密码错误。');
  const token = randomBytes(32).toString('hex'),
    sessionId = randomUUID(),
    maxAge = remember === true ? 30 * 86400 : 12 * 3600;
  await transaction(async (tx) => {
    // Lock against concurrent password changes: never grant a session for an old password.
    const {
      rows: [latest],
    } = await tx.query('SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE', [account.id]);
    if (!latest || latest.password_hash !== account.password_hash)
      throw new APIError(401, '账号或密码错误。');
    await tx.query('DELETE FROM sessions WHERE expires_at<=now()');
    await tx.query('DELETE FROM login_limits WHERE key=$1', [keys[1]]);
    await tx.query('INSERT INTO sessions(id,owner_id,token_hash,expires_at) VALUES($1,$2,$3,$4)', [
      sessionId,
      account.id,
      tokenHash(token),
      new Date(Date.now() + maxAge * 1000),
    ]);
  });
  return { token, maxAge, username: account.username };
}
export async function logout(account: Account) {
  await query('DELETE FROM sessions WHERE id=$1 AND owner_id=$2', [account.sessionId, account.id]);
}
export async function changePassword(
  account: Account,
  current: unknown,
  next: unknown,
  revokeOthers: unknown,
) {
  validatePassword(next);
  if (typeof current !== 'string' || current.length > 128)
    throw new APIError(400, '请输入当前密码。');
  await transaction(async (tx) => {
    const {
      rows: [row],
    } = await tx.query('SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE', [account.id]);
    if (!row || !(await passwordJob(() => verify(row.password_hash, current))))
      throw new APIError(400, '当前密码不正确。');
    await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [
      account.id,
      await hashPassword(next),
    ]);
    if (revokeOthers !== false)
      await tx.query('DELETE FROM sessions WHERE owner_id=$1 AND id<>$2', [
        account.id,
        account.sessionId,
      ]);
  });
}

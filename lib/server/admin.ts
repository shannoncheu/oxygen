import { randomUUID } from 'node:crypto';
import { transaction } from './db';
import { hashPassword, validateUsername, lockAccountNames, tokenHash } from './auth';
import { defaultSettings } from '../model';

export async function createAdministrator(username: string, password: string) {
  username = validateUsername(username);
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    await lockAccountNames(tx);
    if ((await tx.query("SELECT id FROM accounts WHERE role='admin' LIMIT 1")).rows.length)
      throw new Error('管理员已存在，请使用 admin reset 重置密码。');
    if (
      (await tx.query('SELECT id FROM accounts WHERE lower(username)=lower($1)', [username])).rows
        .length
    )
      throw new Error('这个用户名已被使用。');
    await tx.query(
      "INSERT INTO accounts(id,username,password_hash,settings,role) VALUES($1,$2,$3,$4::jsonb,'admin')",
      [randomUUID(), username, passwordHash, JSON.stringify(defaultSettings)],
    );
  });
}
export async function resetAdministrator(password: string) {
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    await lockAccountNames(tx);
    const {
      rows: [account],
    } = await tx.query("SELECT id,username FROM accounts WHERE role='admin' LIMIT 1 FOR UPDATE");
    if (!account) throw new Error('尚未创建管理员，请先运行 admin create。');
    await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [account.id, passwordHash]);
    await tx.query('DELETE FROM sessions WHERE owner_id=$1', [account.id]);
    await tx.query(
      'UPDATE account_tokens SET revoked_at=now() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',
      [account.id],
    );
    await tx.query('DELETE FROM login_limits WHERE key=$1 OR key=$2', [
      tokenHash(account.username.toLocaleLowerCase('en-US')),
      'reauth:' + account.id,
    ]);
  });
}

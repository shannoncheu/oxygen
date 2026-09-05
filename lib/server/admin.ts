import { randomUUID } from 'node:crypto';
import { transaction } from './db';
import { hashPassword } from './auth';
import { defaultSettings } from '../model';

export async function createAdministrator(username: string, password: string) {
  if (!/^[\p{L}\p{N}._@-]{3,64}$/u.test(username))
    throw new Error('账号需为 3–64 个字符，使用文字、数字、点、下划线、@ 或短横线。');
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    if ((await tx.query('SELECT id FROM accounts LIMIT 1')).rows.length)
      throw new Error('管理员已存在，请使用 admin reset 重置密码。');
    await tx.query(
      'INSERT INTO accounts(id,username,password_hash,settings) VALUES($1,$2,$3,$4::jsonb)',
      [randomUUID(), username, passwordHash, JSON.stringify(defaultSettings)],
    );
  });
}
export async function resetAdministrator(password: string) {
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    const {
      rows: [account],
    } = await tx.query('SELECT id FROM accounts LIMIT 1 FOR UPDATE');
    if (!account) throw new Error('尚未创建管理员，请先运行 admin create。');
    await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [account.id, passwordHash]);
    await tx.query('DELETE FROM sessions WHERE owner_id=$1', [account.id]);
    await tx.query('DELETE FROM login_limits');
  });
}

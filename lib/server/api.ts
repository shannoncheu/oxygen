import { NextResponse } from 'next/server';
import { requireAccount, requireUnsafeRequest, lockActiveAccount } from './auth';
import { transaction, readBusiness, writeBusiness } from './db';
import type { BusinessData } from '../model';
import { materialize, validateData } from '../domain';
import { todayInTimezone } from '../billing';
import { APIError } from './errors';
import { assertUploadOwnership } from './uploads';

export { APIError } from './errors';
export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: privateHeaders });
}
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof APIError) return json({ error: error.message }, error.status);
      console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
      return json({ error: '服务器暂时无法完成请求，请稍后重试。' }, 500);
    }
  };
}
export async function bodyBytes(request: Request, limit = 1024 * 1024): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) throw new APIError(413, '请求内容过大。');
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new APIError(413, '请求内容过大。');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}
export async function bodyJSON<T = Record<string, any>>(
  request: Request,
  limit = 1024 * 1024,
): Promise<T> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new APIError(415, '请使用 JSON 请求。');
  try {
    const value = JSON.parse((await bodyBytes(request, limit)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Object required');
    return value;
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(400, 'JSON 格式无效，请提交 JSON 对象。');
  }
}
export function validateBusiness(data: unknown): asserts data is BusinessData {
  try {
    validateData(data as BusinessData);
  } catch (error) {
    throw new APIError(400, error instanceof Error ? error.message : '业务数据格式无效。');
  }
}
export async function business(
  request: Request,
  change?: (data: BusinessData) => void,
  revision?: number,
) {
  if (change) requireUnsafeRequest(request);
  const account = await requireAccount(request);
  return transaction(async (tx) => {
    const current = await lockActiveAccount(tx, account);
    const data = await readBusiness(tx, account.id);
    if (change && (!Number.isSafeInteger(revision) || revision !== data.revision))
      throw new APIError(409, '数据已在其他设备更新，请刷新后重试。');
    const before = JSON.stringify(data);
    const next = data;
    const startingRevision = data.revision;
    try {
      materialize(next, todayInTimezone(next.settings.timezone));
      if (change) change(next);
      validateData(next);
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(400, error instanceof Error ? error.message : '操作无效。');
    }
    if (JSON.stringify(next) !== before) {
      await assertUploadOwnership(tx, account.id, next);
      next.revision = startingRevision + 1;
      await writeBusiness(tx, account.id, next);
    }
    return { data: next, username: current.username, role: current.role };
  });
}

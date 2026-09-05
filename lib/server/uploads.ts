import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { APIError } from './errors';
import { query, transaction, type SQLExecutor } from './db';
import { lockActiveAccount, type Account } from './auth';
import type { BusinessData } from '../model';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const uploadDirectory = () =>
  path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads'));
export function referencedUploadIds(data: BusinessData): string[] {
  return [
    ...new Set(
      [
        ...data.subscriptions.map((item) => item.logo),
        ...data.bills.map((item) => item.logo),
        data.settings.avatarUrl || '',
      ]
        .filter((value) => value.startsWith('/api/files/'))
        .map((value) => value.slice('/api/files/'.length)),
    ),
  ];
}
export async function assertUploadOwnership(tx: SQLExecutor, ownerId: string, data: BusinessData) {
  const ids = referencedUploadIds(data);
  if (!ids.length) return;
  const { rows } = await tx.query(
    'SELECT id FROM uploads WHERE owner_id=$1 AND id=ANY($2::text[])',
    [ownerId, ids],
  );
  if (rows.length !== ids.length)
    throw new APIError(400, '存在无效或不可访问的自定义图片，请重新上传。');
}
export function imagePath(filename: string) {
  if (!/^[a-f0-9-]{36}\.png$/.test(filename)) throw new APIError(400, '图片标识无效。');
  return path.join(uploadDirectory(), filename);
}
export async function normalizeImage(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_IMAGE_BYTES || input.length === 0)
    throw new APIError(400, '图片最大 2 MB。');
  try {
    const decoder = sharp(input, { limitInputPixels: 16000000, animated: false, failOn: 'error' });
    const metadata = await decoder.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(metadata.format || '') ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages || 1) > 1
    )
      throw new Error('Unsupported image');
    // Decode real pixels, discard metadata, and store only a bounded canonical PNG.
    const output = await decoder
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (output.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
    return output;
  } catch {
    throw new APIError(400, '请上传有效的 PNG、JPEG 或 WebP 静态图片。');
  }
}
export async function saveUpload(ownerId: string, png: Buffer, executor?: SQLExecutor) {
  const id = randomUUID(),
    filename = id + '.png';
  try {
    await mkdir(uploadDirectory(), { recursive: true });
    await writeFile(imagePath(filename), png, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    throw uploadError(error, 'storage');
  }
  try {
    await (executor ? executor.query.bind(executor) : query)(
      'INSERT INTO uploads(id,owner_id,filename) VALUES($1,$2,$3)',
      [id, ownerId, filename],
    );
  } catch (error) {
    await unlink(imagePath(filename)).catch(() => {});
    throw uploadError(error, 'database');
  }
  return { id, url: '/api/files/' + id, filename };
}

/** Recheck the session after slow decoding/network work and serialize with account management. */
export async function saveAuthenticatedUpload(account: Account, png: Buffer) {
  let filename: string | undefined;
  try {
    return await transaction(async (tx) => {
      await lockActiveAccount(tx, account);
      const saved = await saveUpload(account.id, png, tx);
      filename = saved.filename;
      return saved;
    });
  } catch (error) {
    // saveUpload handles insertion failures; this also handles rollback/commit failure afterwards.
    if (filename) await unlink(imagePath(filename)).catch(() => {});
    throw error;
  }
}

function uploadError(error: unknown, stage: 'storage' | 'database'): APIError {
  // Keep database statements, credentials, paths and image data out of responses/logs.
  let current = error;
  let code = 'UNKNOWN';
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const entry = current as { code?: unknown; cause?: unknown };
    if (typeof entry.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(entry.code)) {
      code = entry.code;
      break;
    }
    current = entry.cause;
  }
  console.error('Upload failed:', { stage, code });
  if (stage === 'database')
    return new APIError(503, '图片记录保存失败，请稍后重试；持续失败时请检查服务器数据库日志。');
  if (['EACCES', 'EPERM', 'EROFS'].includes(code))
    return new APIError(503, '图片无法保存：服务器上传目录不可写。请检查上传目录权限后重试。');
  if (['ENOSPC', 'EDQUOT'].includes(code))
    return new APIError(507, '图片无法保存：服务器存储空间不足。请清理空间后重试。');
  if (['EEXIST', 'ENOTDIR', 'ENOENT'].includes(code))
    return new APIError(503, '图片无法保存：服务器上传目录配置异常。请检查上传目录后重试。');
  return new APIError(503, '图片存储暂不可用，请稍后重试；持续失败时请检查服务器上传日志。');
}
export async function readUpload(ownerId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new APIError(404, '图片不存在。');
  const {
    rows: [entry],
  } = await query('SELECT filename FROM uploads WHERE id=$1 AND owner_id=$2', [id, ownerId]);
  if (!entry) throw new APIError(404, '图片不存在。');
  try {
    return await readFile(imagePath(entry.filename));
  } catch {
    throw new APIError(404, '图片文件不可用，请恢复服务器上传目录备份。');
  }
}

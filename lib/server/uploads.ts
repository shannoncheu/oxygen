import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { APIError } from './errors';
import { query, type SQLExecutor } from './db';
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
  await mkdir(uploadDirectory(), { recursive: true });
  await writeFile(imagePath(filename), png, { flag: 'wx', mode: 0o600 });
  try {
    await (executor ? executor.query.bind(executor) : query)(
      'INSERT INTO uploads(id,owner_id,filename) VALUES($1,$2,$3)',
      [id, ownerId, filename],
    );
  } catch (error) {
    await unlink(imagePath(filename)).catch(() => {});
    throw error;
  }
  return { id, url: '/api/files/' + id, filename };
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

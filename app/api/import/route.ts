import { unlink } from 'node:fs/promises';
import { route, json, bodyJSON, APIError } from '@/lib/server/api';
import { requireAccount, requireUnsafeRequest, lockActiveAccount } from '@/lib/server/auth';
import { validateBackup } from '@/lib/server/backup';
import { transaction, readBusiness, writeBusiness } from '@/lib/server/db';
import { saveUpload, imagePath } from '@/lib/server/uploads';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAccount(request);
  const body = await bodyJSON(request, 50 * 1024 * 1024);
  if (body.mode !== 'preview' && body.mode !== 'restore')
    throw new APIError(400, '请选择预览或恢复。');
  const { backup, images } = await validateBackup(body.backup);
  const preview = {
    subscriptions: backup.data.subscriptions.length,
    groups: backup.data.groups.length,
    members: backup.data.members.length,
    bills: backup.data.bills.length,
    uploads: images.size,
  };
  if (body.mode === 'preview') return json({ preview, errors: [] });
  if (body.confirmation !== '覆盖现有数据')
    throw new APIError(400, '请明确输入“覆盖现有数据”后恢复。');
  const written: string[] = [];
  try {
    const data = await transaction(async (tx) => {
      await lockActiveAccount(tx, account);
      const existing = await readBusiness(tx, account.id);
      if (!Number.isSafeInteger(body.revision) || body.revision !== existing.revision)
        throw new APIError(409, '数据已更新，请刷新并重新预览备份。');
      const replacements = new Map<string, string>();
      for (const [oldId, png] of images) {
        const saved = await saveUpload(account.id, png, tx);
        written.push(saved.filename);
        replacements.set('/api/files/' + oldId, saved.url);
      }
      for (const item of [...backup.data.subscriptions, ...backup.data.bills]) {
        if (replacements.has(item.logo)) item.logo = replacements.get(item.logo)!;
      }
      const avatarUrl = backup.data.settings.avatarUrl;
      if (avatarUrl && replacements.has(avatarUrl))
        backup.data.settings.avatarUrl = replacements.get(avatarUrl)!;
      backup.data.revision = existing.revision + 1;
      await writeBusiness(tx, account.id, backup.data);
      return backup.data;
    });
    return json({ data, preview });
  } catch (error) {
    await Promise.allSettled(written.map((filename) => unlink(imagePath(filename))));
    throw error;
  }
});

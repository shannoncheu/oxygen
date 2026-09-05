import { route, business, privateHeaders, APIError } from '@/lib/server/api';
import { requireAccount } from '@/lib/server/auth';
import { exportBackup, csvExport, icsExport } from '@/lib/server/backup';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = route(async (request) => {
  const account = await requireAccount(request);
  const { data } = await business(request);
  const format = new URL(request.url).searchParams.get('format') || 'json';
  let content: string, type: string;
  if (format === 'json') {
    content = JSON.stringify(await exportBackup(account.id, data), null, 2);
    type = 'application/json';
  } else if (format === 'csv') {
    content = csvExport(data);
    type = 'text/csv; charset=utf-8';
  } else if (format === 'ics') {
    content = icsExport(data);
    type = 'text/calendar; charset=utf-8';
  } else throw new APIError(400, '导出格式不受支持。');
  if (format === 'json' && Buffer.byteLength(content) > 49 * 1024 * 1024)
    throw new APIError(413, '业务数据超过网页恢复上限，请使用服务器完整备份方案。');
  return new Response(content, {
    headers: {
      ...privateHeaders,
      'Content-Type': type,
      'Content-Disposition':
        'attachment; filename="subscribo-' +
        new Date().toISOString().slice(0, 10) +
        '.' +
        format +
        '"',
    },
  });
});

import type { BusinessData } from '../model';
import { validateData } from '../domain';
import { projectBills, todayInTimezone } from '../billing';
import { APIError } from './api';
import { normalizeImage, readUpload, MAX_IMAGE_BYTES } from './uploads';

export interface Backup {
  format: 'subscribo';
  version: 1;
  exportedAt: string;
  data: BusinessData;
  uploads: { id: string; contentBase64: string }[];
}
export function referencedUploads(data: BusinessData) {
  return [
    ...new Set(
      [...data.subscriptions, ...data.bills]
        .map((s) => s.logo)
        .filter((value) => typeof value === 'string' && value.startsWith('/api/files/'))
        .map((value) => value.slice('/api/files/'.length)),
    ),
  ];
}
export async function exportBackup(ownerId: string, data: BusinessData): Promise<Backup> {
  const uploads = [];
  let total = 0;
  for (const id of referencedUploads(data)) {
    const content = await readUpload(ownerId, id);
    total += content.length;
    if (total > 32 * 1024 * 1024)
      throw new APIError(413, '图片总量过大，请使用服务器完整备份方案。');
    uploads.push({ id, contentBase64: content.toString('base64') });
  }
  return { format: 'subscribo', version: 1, exportedAt: new Date().toISOString(), data, uploads };
}
export async function validateBackup(
  input: unknown,
): Promise<{ backup: Backup; images: Map<string, Buffer> }> {
  if (!input || typeof input !== 'object') throw new APIError(400, '备份文件格式无效。');
  const backup = input as Backup;
  if (
    backup.format !== 'subscribo' ||
    backup.version !== 1 ||
    !Array.isArray(backup.uploads) ||
    backup.uploads.length > 500
  )
    throw new APIError(400, '备份格式或版本不受支持。');
  try {
    backup.data = validateData(backup.data);
  } catch (error) {
    throw new APIError(400, error instanceof Error ? error.message : '业务数据无效。');
  }
  const images = new Map<string, Buffer>();
  for (const item of backup.uploads) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      images.has(item.id) ||
      typeof item.contentBase64 !== 'string' ||
      item.contentBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(item.contentBase64)
    )
      throw new APIError(400, '备份图片格式无效或标识重复。');
    images.set(item.id, await normalizeImage(Buffer.from(item.contentBase64, 'base64')));
  }
  if (referencedUploads(backup.data).some((id) => !images.has(id)))
    throw new APIError(400, '备份缺少引用的自定义图片，请使用完整 JSON 导出。');
  return { backup, images };
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function amount(minor: number, currency: string) {
  const precision = ['JPY', 'KRW'].includes(currency) ? 0 : currency === 'KWD' ? 3 : 2;
  const text = String(Math.abs(minor)).padStart(precision + 1, '0');
  return (
    (minor < 0 ? '-' : '') +
    (precision ? text.slice(0, -precision) + '.' + text.slice(-precision) : text)
  );
}
export function csvExport(data: BusinessData) {
  const rows: unknown[][] = [
    [
      '服务名称',
      '套餐',
      '类型',
      '分类',
      '金额',
      '币种',
      '周期间隔',
      '周期单位',
      '计费锚点',
      '计费起始',
      '试用截止',
      '状态',
      '自动续费',
      '停止日期',
      '官网',
      '备注',
    ],
  ];
  for (const s of data.subscriptions)
    rows.push([
      s.name,
      s.plan,
      s.kind === 'family' ? '家庭' : '个人',
      s.category,
      amount(s.amountMinor, s.currency),
      s.currency,
      s.interval,
      s.unit,
      s.anchorDate,
      s.billingStart,
      s.trialEnd,
      s.status,
      s.autoRenew ? '是' : '否',
      s.stopDate,
      s.website,
      s.notes,
    ]);
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function icsEscape(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
function foldLine(text: string) {
  let line = '',
    bytes = 0,
    result = '';
  for (const character of text) {
    const count = Buffer.byteLength(character);
    if (bytes + count > 75) {
      result += line + '\r\n';
      line = ' ';
      bytes = 1;
    }
    line += character;
    bytes += count;
  }
  return result + line;
}
export function icsExport(data: BusinessData, now = new Date()) {
  const today = todayInTimezone(data.settings.timezone, now);
  const end = new Date(today + 'T00:00:00Z');
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Subscribo//Private subscription tracker//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Subscribo 续费提醒',
  ];
  for (const bill of projectBills(data, today, end.toISOString().slice(0, 10)).filter(
    (b) => b.status !== 'skipped',
  )) {
    const nextDay = new Date(bill.dueDate + 'T00:00:00Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + icsEscape(bill.subscriptionId + '-' + bill.dueDate) + '@subscribo.local',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + bill.dueDate.replaceAll('-', ''),
      'DTEND;VALUE=DATE:' + nextDay.toISOString().slice(0, 10).replaceAll('-', ''),
      'SUMMARY:' +
        icsEscape(
          bill.name + ' · ' + amount(bill.amountMinor, bill.currency) + ' ' + bill.currency,
        ),
      'DESCRIPTION:' +
        icsEscape('预计续费，实际付款需自行确认。此文件是导出时的快照；重复导入时请使用同一日历。'),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

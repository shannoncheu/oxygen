import type { Bill, BusinessData, Currency, CycleUnit, Subscription } from './model';

export const CURRENCY_DIGITS: Record<Currency, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  TWD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
};
export const MAX_MONEY = 1_000_000_000_000;
const DAY = 86_400_000;

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= '1900-01-01' &&
    value <= '2200-12-31'
  );
}
function dateValue(value: string): number {
  if (!isDate(value)) throw new Error('日期无效，请使用 YYYY-MM-DD');
  return new Date(`${value}T00:00:00.000Z`).getTime();
}
export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error('天数必须为整数');
  return new Date(dateValue(date) + days * DAY).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return (dateValue(to) - dateValue(from)) / DAY;
}
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Every occurrence is calculated from the original anchor, never the clipped previous month. */
export function addCycle(anchor: string, interval: number, unit: CycleUnit, index: number): string {
  dateValue(anchor);
  if (
    !Number.isSafeInteger(interval) ||
    interval < 1 ||
    interval > 1000 ||
    !Number.isSafeInteger(index) ||
    index < 0
  )
    throw new Error('计费周期无效');
  if (unit === 'day' || unit === 'week')
    return addDays(anchor, interval * index * (unit === 'week' ? 7 : 1));
  if (unit !== 'month' && unit !== 'year') throw new Error('计费单位无效');
  const [year, month, day] = anchor.split('-').map(Number);
  const months = year * 12 + month - 1 + interval * index * (unit === 'year' ? 12 : 1);
  const targetYear = Math.floor(months / 12);
  const targetMonth = months % 12;
  if (targetYear > 9999) throw new Error('计费日期超出支持范围');
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear.toString().padStart(4, '0')}-${(targetMonth + 1).toString().padStart(2, '0')}-${Math.min(day, lastDay).toString().padStart(2, '0')}`;
}
function effectiveAnchor(subscription: Subscription): string {
  return subscription.trialEnd && subscription.trialEnd > subscription.anchorDate
    ? subscription.trialEnd
    : subscription.anchorDate;
}
function cycleIndexNear(subscription: Subscription, date: string): number {
  const anchor = effectiveAnchor(subscription);
  const [ay, am] = anchor.split('-').map(Number);
  const [dy, dm] = date.split('-').map(Number);
  if (subscription.unit === 'month' || subscription.unit === 'year')
    return Math.max(
      0,
      Math.floor(
        ((dy - ay) * 12 + dm - am) /
          (subscription.interval * (subscription.unit === 'year' ? 12 : 1)),
      ) - 1,
    );
  return Math.max(
    0,
    Math.floor(
      daysBetween(anchor, date) / (subscription.interval * (subscription.unit === 'week' ? 7 : 1)),
    ) - 1,
  );
}
function schedulePermits(subscription: Subscription, date: string): boolean {
  if (
    subscription.status === 'paused' ||
    subscription.status === 'archived' ||
    subscription.status === 'cancelled'
  )
    return false;
  if (subscription.stopDate && date >= subscription.stopDate) return false;
  if (!subscription.autoRenew && !subscription.stopDate && date !== effectiveAnchor(subscription))
    return false;
  return date >= subscription.billingStart;
}
export function occurrences(subscription: Subscription, from: string, to: string): string[] {
  dateValue(from);
  dateValue(to);
  if (to < from) return [];
  const anchor = effectiveAnchor(subscription);
  const dates: string[] = [];
  let index = cycleIndexNear(subscription, from);
  for (let guard = 0; guard < 110_000; guard++, index++) {
    const date = addCycle(anchor, subscription.interval, subscription.unit, index);
    if (date > to) return dates;
    if (date >= from && schedulePermits(subscription, date)) dates.push(date);
  }
  throw new Error('计划账期过多，请缩短查询日期范围');
}
export function nextDue(subscription: Subscription, today: string): string | null {
  dateValue(today);
  if (
    subscription.status === 'paused' ||
    subscription.status === 'archived' ||
    subscription.status === 'cancelled'
  )
    return null;
  const anchor = effectiveAnchor(subscription);
  const lower = today > subscription.billingStart ? today : subscription.billingStart;
  let index = cycleIndexNear(subscription, lower);
  for (let guard = 0; guard < 5; guard++, index++) {
    const due = addCycle(anchor, subscription.interval, subscription.unit, index);
    if (due >= lower) return schedulePermits(subscription, due) && due <= '2200-12-31' ? due : null;
  }
  return null;
}
export function parseMoney(value: string, currency: Currency): number {
  const digits = CURRENCY_DIGITS[currency];
  if (digits === undefined || typeof value !== 'string') throw new Error('币种或金额无效');
  const clean = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean)) throw new Error('请输入非负金额，不含千位分隔符');
  const [integer, fraction = ''] = clean.split('.');
  if (fraction.length > digits) throw new Error(`${currency} 金额最多支持 ${digits} 位小数`);
  const minor =
    BigInt(integer) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (minor > BigInt(MAX_MONEY)) throw new Error('金额超出允许范围');
  return Number(minor);
}
export function formatMoney(amountMinor: number, currency: Currency, locale = 'zh-CN'): string {
  if (!Number.isFinite(amountMinor) || CURRENCY_DIGITS[currency] === undefined)
    throw new Error('金额或币种无效');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: CURRENCY_DIGITS[currency],
    maximumFractionDigits: CURRENCY_DIGITS[currency],
  }).format(amountMinor / 10 ** CURRENCY_DIGITS[currency]);
}
/** Display-only approximation; never use it as an actual monthly charge. */
export function monthlyEquivalent(subscription: Subscription): number {
  const months =
    subscription.unit === 'year'
      ? subscription.interval * 12
      : subscription.unit === 'month'
        ? subscription.interval
        : subscription.unit === 'week'
          ? (subscription.interval * 7 * 12) / 365.2425
          : (subscription.interval * 12) / 365.2425;
  return subscription.amountMinor / months;
}
export function snapshotBill(
  subscription: Subscription,
  dueDate: string,
  id = `projected:${subscription.id}:${dueDate}`,
): Bill {
  const anchor = effectiveAnchor(subscription);
  let index = cycleIndexNear(subscription, dueDate);
  while (addCycle(anchor, subscription.interval, subscription.unit, index) < dueDate) index++;
  if (addCycle(anchor, subscription.interval, subscription.unit, index) !== dueDate)
    throw new Error('日期不属于该订阅的账期');
  return {
    id,
    subscriptionId: subscription.id,
    dueDate,
    periodEnd: addCycle(anchor, subscription.interval, subscription.unit, index + 1),
    name: subscription.name,
    category: subscription.category,
    serviceId: subscription.serviceId,
    logo: subscription.logo,
    color: subscription.color,
    amountMinor: subscription.amountMinor,
    currency: subscription.currency,
    status: 'pending',
    paidAt: '',
    note: '',
  };
}
export function projectBills(data: BusinessData, from: string, to: string): Bill[] {
  dateValue(from);
  dateValue(to);
  const result = new Map<string, Bill>();
  for (const bill of data.bills)
    if (bill.dueDate >= from && bill.dueDate <= to)
      result.set(`${bill.subscriptionId}|${bill.dueDate}`, bill);
  for (const subscription of data.subscriptions)
    for (const dueDate of occurrences(subscription, from, to)) {
      const key = `${subscription.id}|${dueDate}`;
      if (!result.has(key)) result.set(key, snapshotBill(subscription, dueDate));
    }
  return [...result.values()].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'zh-CN'),
  );
}
export function summarizeByCurrency(
  bills: Pick<Bill, 'amountMinor' | 'currency' | 'status'>[],
): Partial<Record<Currency, number>> {
  const totals: Partial<Record<Currency, number>> = {};
  for (const bill of bills)
    if (bill.status !== 'skipped') {
      const value = (totals[bill.currency] || 0) + bill.amountMinor;
      if (!Number.isSafeInteger(value)) throw new Error('汇总金额超出精确整数范围');
      totals[bill.currency] = value;
    }
  return totals;
}

import { CURRENCY_DIGITS } from './billing';
import type { Currency } from './model';

export const EXCHANGE_PROVIDER_URL = 'https://www.exchangerate-api.com';
export const EXCHANGE_CURRENCIES = Object.keys(CURRENCY_DIGITS) as Currency[];
export type ExchangeRates = Partial<Record<Currency, number>>;
/** Every rate is CNY per one major unit of the named currency, never per cent. */
export interface ExchangeSnapshot {
  base: 'CNY';
  rates: ExchangeRates;
  updatedAt: string;
  fetchedAt: string;
  nextUpdateAt: string;
  provider: 'exchangerate-api';
}
export interface ExchangeSettings {
  autoUpdate: boolean;
  snapshot: ExchangeSnapshot | null;
  manualRates: ExchangeRates;
}
export interface ExchangeResponse {
  snapshot: ExchangeSnapshot | null;
  stale: boolean;
  error?: string;
}
export const defaultExchangeSettings = (): ExchangeSettings => ({
  autoUpdate: true,
  snapshot: null,
  manualRates: {},
});

function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label}格式无效`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw Error(`${label}包含未知字段：${key}`);
  }
  return value as Record<string, unknown>;
}
export function validateExchangeRates(value: unknown): ExchangeRates {
  const values = object(value, EXCHANGE_CURRENCIES, '汇率');
  const rates: ExchangeRates = {};
  for (const [currency, rate] of Object.entries(values)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 1e-8 || rate > 1e8)
      throw Error(`${currency} 汇率必须是 0.00000001 到 100000000 之间的数值`);
    if (currency === 'CNY' && rate !== 1) throw Error('CNY 基准汇率必须为 1');
    rates[currency as Currency] = rate;
  }
  return rates;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw Error('汇率更新时间无效');
  return value;
}
export function validateExchangeSnapshot(value: unknown): ExchangeSnapshot {
  const p = object(
    value,
    ['base', 'rates', 'updatedAt', 'fetchedAt', 'nextUpdateAt', 'provider'],
    '汇率快照',
  );
  if (p.base !== 'CNY' || p.provider !== 'exchangerate-api') throw Error('汇率来源无效');
  const rates = validateExchangeRates(p.rates);
  if (rates.CNY !== 1) throw Error('缺少 CNY 基准汇率');
  const updatedAt = timestamp(p.updatedAt),
    fetchedAt = timestamp(p.fetchedAt),
    nextUpdateAt = timestamp(p.nextUpdateAt);
  if (nextUpdateAt <= updatedAt || Date.parse(nextUpdateAt) - Date.parse(updatedAt) > 7 * 86400000)
    throw Error('汇率更新间隔无效');
  if (Date.parse(updatedAt) > Date.parse(fetchedAt) + 300000)
    throw Error('汇率更新时间晚于获取时间');
  return { base: 'CNY', rates, updatedAt, fetchedAt, nextUpdateAt, provider: 'exchangerate-api' };
}
export function validateExchangeSettings(value: unknown): ExchangeSettings {
  if (value === undefined) return defaultExchangeSettings();
  const p = object(value, ['autoUpdate', 'snapshot', 'manualRates'], '汇率设置');
  if (typeof p.autoUpdate !== 'boolean') throw Error('汇率自动更新设置无效');
  return {
    autoUpdate: p.autoUpdate,
    snapshot: p.snapshot === null ? null : validateExchangeSnapshot(p.snapshot),
    manualRates: validateExchangeRates(p.manualRates),
  };
}
export function isSnapshotStale(
  snapshot: ExchangeSnapshot | null | undefined,
  now = Date.now(),
): boolean {
  return (
    !snapshot ||
    now >= Date.parse(snapshot.nextUpdateAt) ||
    now - Date.parse(snapshot.updatedAt) > 48 * 3600000
  );
}
function rateFor(currency: Currency, settings: ExchangeSettings): number | undefined {
  if (currency === 'CNY') return 1;
  return settings.manualRates[currency] ?? settings.snapshot?.rates[currency];
}
type Fraction = [bigint, bigint];
function fraction(value: number): Fraction {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [whole, decimals = ''] = coefficient.split('.');
  const shift = Number(exponent) - decimals.length;
  const numerator = BigInt(whole + decimals);
  return shift >= 0 ? [numerator * 10n ** BigInt(shift), 1n] : [numerator, 10n ** BigInt(-shift)];
}
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}
function add(a: Fraction, b: Fraction): Fraction {
  const n = a[0] * b[1] + b[0] * a[1],
    d = a[1] * b[1],
    divisor = gcd(n, d);
  return [n / divisor, d / divisor];
}
function convertedFraction(
  amountMinor: number,
  source: Currency,
  target: Currency,
  settings: ExchangeSettings,
): Fraction | null {
  if (!Number.isFinite(amountMinor) || amountMinor < 0 || amountMinor > Number.MAX_SAFE_INTEGER)
    throw Error('换算金额超出可精确显示范围');
  const amount = fraction(amountMinor);
  if (source === target || amountMinor === 0) return amount;
  const sourceRate = rateFor(source, settings),
    targetRate = rateFor(target, settings);
  if (!sourceRate || !targetRate) return null;
  const from = fraction(sourceRate),
    to = fraction(targetRate);
  return [
    amount[0] * from[0] * to[1] * 10n ** BigInt(CURRENCY_DIGITS[target]),
    amount[1] * from[1] * to[0] * 10n ** BigInt(CURRENCY_DIGITS[source]),
  ];
}
function roundedMinor(value: Fraction): number | null {
  const rounded = (value[0] * 2n + value[1]) / (value[1] * 2n);
  return rounded > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(rounded);
}
export function convertMinor(
  amountMinor: number,
  source: Currency,
  target: Currency,
  settings: ExchangeSettings = defaultExchangeSettings(),
): number | null {
  const value = convertedFraction(amountMinor, source, target, settings);
  return value ? roundedMinor(value) : null;
}
export interface ConvertedTotal {
  amountMinor: number | null;
  partialMinor: number | null;
  missing: Currency[];
  estimated: boolean;
  usedManual: boolean;
  usedProvider: boolean;
  stale: boolean;
  overflow: boolean;
}
/** Add unrounded conversions, then round the total once to the target currency's precision. */
export function convertTotal(
  values: ExchangeRates,
  target: Currency,
  settings: ExchangeSettings = defaultExchangeSettings(),
  now = Date.now(),
): ConvertedTotal {
  let total: Fraction = [0n, 1n],
    estimated = false,
    usedManual = false,
    usedProvider = false;
  const missing: Currency[] = [];
  for (const currency of EXCHANGE_CURRENCIES) {
    const amount = values[currency] ?? 0;
    if (!amount) continue;
    const value = convertedFraction(amount, currency, target, settings);
    if (!value) {
      missing.push(currency);
      continue;
    }
    total = add(total, value);
    if (currency !== target) {
      estimated = true;
      for (const code of [currency, target]) {
        if (code === 'CNY') continue;
        if (settings.manualRates[code] !== undefined) usedManual = true;
        else usedProvider = true;
      }
    }
  }
  const partialMinor = roundedMinor(total),
    overflow = partialMinor === null;
  return {
    amountMinor: missing.length || overflow ? null : partialMinor,
    partialMinor,
    missing,
    estimated,
    usedManual,
    usedProvider,
    stale: usedProvider && isSnapshotStale(settings.snapshot, now),
    overflow,
  };
}

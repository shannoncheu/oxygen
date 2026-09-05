import {
  EXCHANGE_CURRENCIES,
  isSnapshotStale,
  validateExchangeSnapshot,
  type ExchangeResponse,
  type ExchangeSnapshot,
} from '../exchange';

export const EXCHANGE_ENDPOINT = 'https://open.er-api.com/v6/latest/CNY';
const MAX_BODY = 64000;
const RETRY_AFTER = 3600000;

export function parseProviderRates(value: unknown, now = Date.now()): ExchangeSnapshot {
  if (!value || typeof value !== 'object') throw Error('汇率响应无效');
  const p = value as Record<string, unknown>;
  if (p.result !== 'success' || p.base_code !== 'CNY' || !p.rates || typeof p.rates !== 'object')
    throw Error('汇率服务未返回有效数据');
  if (typeof p.time_last_update_unix !== 'number' || typeof p.time_next_update_unix !== 'number')
    throw Error('汇率更新时间无效');
  const raw = p.rates as Record<string, unknown>;
  const rates: ExchangeSnapshot['rates'] = {};
  for (const currency of EXCHANGE_CURRENCIES) {
    const rate = raw[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw Error(`缺少 ${currency} 汇率`);
    rates[currency] = currency === 'CNY' ? 1 : Number((1 / rate).toPrecision(12));
  }
  if (raw.CNY !== 1) throw Error('汇率基准错误');
  return validateExchangeSnapshot({
    base: 'CNY',
    rates,
    provider: 'exchangerate-api',
    fetchedAt: new Date(now).toISOString(),
    updatedAt: new Date(p.time_last_update_unix * 1000).toISOString(),
    nextUpdateAt: new Date(p.time_next_update_unix * 1000).toISOString(),
  });
}

export async function fetchProviderRates(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ExchangeSnapshot> {
  const response = await fetcher(EXCHANGE_ENDPOINT, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('汇率服务暂时不可用');
  if (Number(response.headers.get('content-length') || 0) > MAX_BODY || !response.body)
    throw Error('汇率响应无效');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw Error('汇率响应过大');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return parseProviderRates(JSON.parse(Buffer.concat(parts).toString('utf8')), now);
}

/** Persisted account snapshots seed this shared process cache after a server restart. */
export function createExchangeCache(fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  let cached: ExchangeSnapshot | null = null;
  let retryAt = 0;
  let lastError = '';
  let pending: Promise<ExchangeResponse> | null = null;
  return async (saved: ExchangeSnapshot | null = null): Promise<ExchangeResponse> => {
    const now = clock();
    if (saved && (!cached || saved.updatedAt > cached.updatedAt)) cached = saved;
    if (cached && !isSnapshotStale(cached, now)) return { snapshot: cached, stale: false };
    if (pending) return pending;
    if (now < retryAt)
      return {
        snapshot: cached,
        stale: isSnapshotStale(cached, now),
        error: lastError || undefined,
      };
    pending = (async () => {
      try {
        const next = await fetchProviderRates(fetcher, now);
        if (!cached || next.updatedAt >= cached.updatedAt) cached = next;
        retryAt = Math.max(now + RETRY_AFTER, Date.parse(next.nextUpdateAt));
        lastError = '';
      } catch {
        retryAt = now + RETRY_AFTER;
        lastError = cached
          ? '汇率更新失败，继续使用上次汇率。也可以手动填写。'
          : '暂时无法获取汇率，请稍后重试或手动填写。';
      }
      return {
        snapshot: cached,
        stale: isSnapshotStale(cached, clock()),
        error: lastError || undefined,
      };
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}
const state = globalThis as typeof globalThis & {
  __oxygenExchangeCache?: ReturnType<typeof createExchangeCache>;
};
export const getExchangeRates = (saved: ExchangeSnapshot | null = null) =>
  (state.__oxygenExchangeCache ??= createExchangeCache())(saved);

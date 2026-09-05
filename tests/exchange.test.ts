import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../lib/domain';
import { emptyData } from '../lib/model';
import {
  convertMinor,
  convertTotal,
  defaultExchangeSettings,
  isSnapshotStale,
  validateExchangeSettings,
  validateExchangeSnapshot,
  type ExchangeSettings,
  type ExchangeSnapshot,
} from '../lib/exchange';
import {
  createExchangeCache,
  EXCHANGE_ENDPOINT,
  fetchProviderRates,
  parseProviderRates,
} from '../lib/server/exchange';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
function snapshot(overrides: Partial<ExchangeSnapshot> = {}): ExchangeSnapshot {
  return {
    base: 'CNY',
    provider: 'exchangerate-api',
    updatedAt: '2026-09-05T00:00:00.000Z',
    fetchedAt: '2026-09-05T12:00:00.000Z',
    nextUpdateAt: '2026-09-06T00:00:00.000Z',
    rates: {
      CNY: 1,
      USD: 7.2,
      EUR: 8,
      GBP: 9.5,
      HKD: 0.92,
      TWD: 0.22,
      JPY: 0.05,
      KRW: 0.005,
      KWD: 23.5,
    },
    ...overrides,
  };
}
function settings(overrides: Partial<ExchangeSettings> = {}): ExchangeSettings {
  return { autoUpdate: true, snapshot: snapshot(), manualRates: {}, ...overrides };
}
function provider(time = NOW) {
  const data = snapshot();
  return {
    result: 'success',
    base_code: 'CNY',
    time_last_update_unix: Math.floor(time / 86400000) * 86400,
    time_next_update_unix: (Math.floor(time / 86400000) + 1) * 86400,
    rates: Object.fromEntries(
      Object.entries(data.rates).map(([currency, rate]) => [currency, 1 / rate]),
    ),
  };
}
function fakeFetch(fn: () => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => {
    assert.equal(input, EXCHANGE_ENDPOINT);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    return fn();
  }) as typeof fetch;
}

test('combines CNY and USD into CNY without adding unlike minor units', () => {
  const result = convertTotal({ CNY: 10000, USD: 2000 }, 'CNY', settings(), NOW);
  assert.equal(result.amountMinor, 24400);
  assert.equal(result.estimated, true);
  assert.equal(result.usedProvider, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.stale, false);
});

test('respects zero-decimal JPY/KRW, three-decimal KWD and cross-rates', () => {
  assert.equal(convertMinor(1000, 'JPY', 'CNY', settings()), 5000);
  assert.equal(convertMinor(1234, 'KWD', 'CNY', settings()), 2900);
  assert.equal(convertMinor(100, 'CNY', 'JPY', settings()), 20);
  assert.equal(convertMinor(100, 'CNY', 'KWD', settings()), 43);
  assert.equal(convertMinor(2350, 'CNY', 'KWD', settings()), 1000);
  assert.equal(convertTotal({ USD: 1000, CNY: 7200 }, 'USD', settings()).amountMinor, 2000);
  assert.equal(convertMinor(1000, 'KRW', 'CNY', settings()), 500);
});

test('manual rates override individual automatic rates and work without network data', () => {
  const result = convertTotal({ USD: 100, CNY: 100 }, 'CNY', settings({ manualRates: { USD: 7 } }));
  assert.equal(result.amountMinor, 800);
  assert.equal(result.usedManual, true);
  assert.equal(result.usedProvider, false);
  assert.equal(
    convertMinor(100, 'USD', 'CNY', settings({ snapshot: null, manualRates: { USD: 7 } })),
    700,
  );
  assert.equal(convertMinor(100, 'EUR', 'USD', settings({ manualRates: { USD: 8 } })), 100);
});

test('missing rates cannot turn a partial subtotal into a complete total', () => {
  const result = convertTotal({ CNY: 2500, USD: 2000, JPY: 1000 }, 'CNY');
  assert.equal(result.amountMinor, null);
  assert.equal(result.partialMinor, 2500);
  assert.deepEqual(result.missing, ['USD', 'JPY']);
  assert.equal(convertMinor(100, 'USD', 'CNY'), null);
  assert.equal(convertTotal({ USD: 100, CNY: 100 }, 'USD').partialMinor, 100);
  assert.equal(convertTotal({ USD: 100 }, 'USD').amountMinor, 100);
  assert.equal(convertTotal({}, 'CNY').amountMinor, 0);
});

test('rounds once after aggregation and detects numeric overflow', () => {
  const rates = settings({ manualRates: { USD: 0.49, EUR: 0.49 } });
  assert.equal(convertTotal({ USD: 1, EUR: 1 }, 'CNY', rates).amountMinor, 1);
  assert.equal(convertMinor(1, 'USD', 'CNY', settings({ manualRates: { USD: 1.005 } })), 1);
  assert.equal(convertMinor(100, 'USD', 'CNY', settings({ manualRates: { USD: 1.005 } })), 101);
  assert.equal(
    convertTotal({ USD: 100 / 12 }, 'CNY', settings({ manualRates: { USD: 7.2 } })).amountMinor,
    60,
  );
  const result = convertTotal({ USD: Number.MAX_SAFE_INTEGER }, 'CNY', settings());
  assert.equal(result.amountMinor, null);
  assert.equal(result.overflow, true);
});

test('validates saved exchange settings and allows migration of old settings', () => {
  assert.deepEqual(validateExchangeSettings(undefined), defaultExchangeSettings());
  assert.deepEqual(validateExchangeSettings(settings()), settings());
  for (const rate of [0, -1, NaN, Infinity, 1e9])
    assert.throws(() => validateExchangeSettings(settings({ manualRates: { USD: rate } })));
  assert.throws(() => validateExchangeSettings({ ...settings(), source: 'arbitrary-url' }));
  assert.throws(() => validateExchangeSnapshot(snapshot({ rates: { CNY: 2 } })));
  assert.throws(() =>
    validateExchangeSnapshot(snapshot({ updatedAt: '2026-09-31T00:00:00.000Z' })),
  );
  assert.throws(() =>
    validateExchangeSnapshot(snapshot({ nextUpdateAt: '2026-09-04T00:00:00.000Z' })),
  );
});

test('snapshot action preserves manual rates and auto-update preference', () => {
  const data = emptyData();
  data.settings.exchange = settings({
    autoUpdate: false,
    snapshot: null,
    manualRates: { USD: 7.1 },
  });
  applyAction(data, { type: 'exchange.snapshot', payload: snapshot() }, '2026-09-05');
  assert.deepEqual(
    data.settings.exchange,
    settings({ autoUpdate: false, manualRates: { USD: 7.1 } }),
  );
});

test('provider normalization requires all supported currencies and exact CNY base', () => {
  const result = parseProviderRates(provider(), NOW);
  assert.equal(result.rates.USD, 7.2);
  assert.equal(result.rates.JPY, 0.05);
  assert.equal(result.rates.KWD, 23.5);
  assert.equal(result.fetchedAt, '2026-09-05T12:00:00.000Z');
  assert.throws(() => parseProviderRates({ ...provider(), result: 'error' }, NOW));
  assert.throws(() => parseProviderRates({ ...provider(), rates: { CNY: 1, USD: 0.14 } }, NOW));
  assert.throws(() => parseProviderRates({ ...provider(), base_code: 'USD' }, NOW));
});

test('provider fetch bounds response size and rejects malformed data', async () => {
  await assert.rejects(
    fetchProviderRates(
      fakeFetch(() => new Response('x'.repeat(64001))),
      NOW,
    ),
  );
  await assert.rejects(
    fetchProviderRates(
      fakeFetch(() => new Response('{}', { status: 429 })),
      NOW,
    ),
  );
  await assert.rejects(
    fetchProviderRates(
      fakeFetch(() => new Response('not-json')),
      NOW,
    ),
  );
  assert.equal(
    (
      await fetchProviderRates(
        fakeFetch(() => Response.json(provider())),
        NOW,
      )
    ).rates.USD,
    7.2,
  );
});

test('cache reuses persisted daily snapshot without issuing an outbound request', async () => {
  let calls = 0;
  const getRates = createExchangeCache(
    fakeFetch(() => {
      calls++;
      return Response.json(provider());
    }),
    () => NOW,
  );
  const result = await getRates(snapshot());
  assert.equal(result.stale, false);
  assert.equal(calls, 0);
});

test('failed refresh keeps last successful snapshot, marks stale, and backs off', async () => {
  let calls = 0,
    now = NOW + 86400000;
  const getRates = createExchangeCache(
    fakeFetch(() => {
      calls++;
      throw Error('network unavailable');
    }),
    () => now,
  );
  const result = await getRates(snapshot());
  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(result.stale, true);
  assert.match(result.error!, /上次汇率/);
  await getRates(snapshot());
  assert.equal(calls, 1);
  now += 3600001;
  await getRates(snapshot());
  assert.equal(calls, 2);
  assert.equal(isSnapshotStale(snapshot(), now), true);
});

test('concurrent cache requests share a single fetch and successful data updates after next publication', async () => {
  let calls = 0,
    now = NOW;
  const getRates = createExchangeCache(
    fakeFetch(async () => {
      calls++;
      await Promise.resolve();
      return Response.json(provider(now));
    }),
    () => now,
  );
  const results = await Promise.all([getRates(), getRates(), getRates()]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  now += 86400000;
  const next = await getRates(results[0].snapshot);
  assert.equal(calls, 2);
  assert.equal(next.snapshot?.updatedAt, '2026-09-06T00:00:00.000Z');
});

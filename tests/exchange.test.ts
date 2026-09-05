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
      NGN: 0.0045,
      TRY: 0.16,
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

test('NGN and TRY combine with original currencies using provider and manual rates', () => {
  assert.equal(convertMinor(100000, 'NGN', 'CNY', settings()), 450);
  assert.equal(convertMinor(10000, 'TRY', 'CNY', settings()), 1600);
  assert.equal(convertMinor(1600, 'CNY', 'TRY', settings()), 10000);
  assert.equal(convertMinor(320000, 'NGN', 'TRY', settings()), 9000);
  assert.equal(
    convertTotal({ NGN: 100000, TRY: 10000, CNY: 100 }, 'CNY', settings(), NOW).amountMinor,
    2150,
  );
  const manual = validateExchangeSettings(
    settings({ snapshot: null, manualRates: { NGN: 0.005, TRY: 0.2 } }),
  );
  const result = convertTotal({ NGN: 100000, TRY: 10000 }, 'CNY', manual, NOW);
  assert.equal(result.amountMinor, 2500);
  assert.equal(result.usedManual, true);
  assert.equal(result.usedProvider, false);
  assert.deepEqual(result.missing, []);
});

test('legacy nine-currency snapshots remain valid and missing new rates stay explicit', () => {
  const legacy = snapshot();
  delete legacy.rates.NGN;
  delete legacy.rates.TRY;
  assert.deepEqual(validateExchangeSnapshot(legacy), legacy);
  assert.equal(isSnapshotStale(legacy, NOW), true);
  const oldSettings = settings({ snapshot: legacy });
  assert.equal(convertMinor(100, 'USD', 'CNY', oldSettings), 720);
  const result = convertTotal({ CNY: 100, NGN: 100000, TRY: 10000 }, 'CNY', oldSettings, NOW);
  assert.equal(result.amountMinor, null);
  assert.equal(result.partialMinor, 100);
  assert.deepEqual(result.missing, ['NGN', 'TRY']);
  assert.equal(
    convertTotal(
      { CNY: 100, NGN: 100000, TRY: 10000 },
      'CNY',
      { ...oldSettings, manualRates: { NGN: 0.005, TRY: 0.2 } },
      NOW,
    ).amountMinor,
    2600,
  );
  const data = emptyData();
  applyAction(data, { type: 'settings.save', payload: { exchange: oldSettings } }, '2026-09-05');
  assert.deepEqual(data.settings.exchange, oldSettings);
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
  assert.equal(result.rates.NGN, 0.0045);
  assert.equal(result.rates.TRY, 0.16);
  assert.equal(result.fetchedAt, '2026-09-05T12:00:00.000Z');
  assert.throws(() => parseProviderRates({ ...provider(), result: 'error' }, NOW));
  assert.throws(() => parseProviderRates({ ...provider(), rates: { CNY: 1, USD: 0.14 } }, NOW));
  assert.throws(() => parseProviderRates({ ...provider(), base_code: 'USD' }, NOW));
  for (const missing of ['NGN', 'TRY']) {
    const incomplete = provider();
    delete incomplete.rates[missing];
    assert.throws(() => parseProviderRates(incomplete, NOW), new RegExp(missing));
  }
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

test('one account cannot seed shared rates through a saved or imported snapshot', async () => {
  let calls = 0;
  const getRates = createExchangeCache(
    fakeFetch(() => {
      calls++;
      return Response.json(provider());
    }),
    () => NOW,
  );
  const userSupplied = snapshot({
    rates: { ...snapshot().rates, USD: 999 },
    updatedAt: '2026-09-06T00:00:00.000Z',
    fetchedAt: '2026-09-06T00:00:00.000Z',
    nextUpdateAt: '2026-09-07T00:00:00.000Z',
  });
  validateExchangeSnapshot(userSupplied);
  assert.equal((await getRates(userSupplied)).snapshot?.rates.USD, 999);
  assert.equal(calls, 0, 'a private saved snapshot may serve its own account');
  const anotherAccount = await getRates();
  assert.equal(calls, 1, 'another account must fetch from the fixed provider');
  assert.equal(anotherAccount.snapshot?.rates.USD, 7.2);
  assert.equal((await getRates(userSupplied)).snapshot?.rates.USD, 7.2);
});

test('failed concurrent refresh and retry backoff preserve each account own fallback', async () => {
  let calls = 0;
  const getRates = createExchangeCache(
    fakeFetch(async () => {
      calls++;
      await Promise.resolve();
      throw Error('network unavailable');
    }),
    () => NOW + 86400000,
  );
  const firstSaved = snapshot({ rates: { ...snapshot().rates, USD: 999 } });
  const secondSaved = snapshot();
  const [first, second, fresh] = await Promise.all([
    getRates(firstSaved),
    getRates(secondSaved),
    getRates(),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first.snapshot, firstSaved);
  assert.deepEqual(second.snapshot, secondSaved);
  assert.equal(fresh.snapshot, null);
  assert.equal(first.stale, true);
  assert.equal(second.stale, true);
  assert.match(fresh.error!, /暂时无法获取/);
  assert.deepEqual((await getRates(secondSaved)).snapshot, secondSaved);
  assert.equal((await getRates()).snapshot, null);
  assert.equal(calls, 1, 'backoff is shared without sharing private snapshots');
});

test('cache refreshes a current legacy snapshot to fetch newly supported currencies', async () => {
  let calls = 0;
  const oldSnapshot = snapshot();
  delete oldSnapshot.rates.NGN;
  delete oldSnapshot.rates.TRY;
  const getRates = createExchangeCache(
    fakeFetch(() => {
      calls++;
      return Response.json(provider());
    }),
    () => NOW,
  );
  const result = await getRates(oldSnapshot);
  assert.equal(calls, 1);
  assert.equal(result.stale, false);
  assert.equal(result.snapshot?.rates.NGN, 0.0045);
  assert.equal(result.snapshot?.rates.TRY, 0.16);
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

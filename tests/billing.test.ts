import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCycle,
  formatMoney,
  monthlyEquivalent,
  nextDue,
  occurrences,
  parseMoney,
  projectBills,
  summarizeByCurrency,
  todayInTimezone,
} from '../lib/billing';
import {
  activeMemberships,
  applyAction,
  materialize,
  splitAmounts,
  validateData,
} from '../lib/domain';
import { emptyData, type BusinessData, type Subscription } from '../lib/model';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 's1',
    name: '示例订阅',
    serviceId: 'custom',
    logo: '',
    color: '#345678',
    category: '音乐',
    plan: '',
    kind: 'personal',
    amountMinor: 3000,
    currency: 'CNY',
    interval: 1,
    unit: 'month',
    anchorDate: '2026-01-31',
    billingStart: '2026-01-31',
    trialEnd: '',
    autoRenew: true,
    status: 'active',
    stopDate: '',
    notes: '',
    website: '',
    createdAt: '2026-01-01',
    ...overrides,
  };
}
function save(data: BusinessData, value: Subscription, today = '2026-01-10'): void {
  const { id: _id, createdAt: _createdAt, ...payload } = value;
  applyAction(data, { type: 'subscription.save', payload }, today);
}
function family(amountMinor = 3001): BusinessData {
  const data = emptyData();
  save(
    data,
    subscription({
      kind: 'family',
      amountMinor,
      anchorDate: '2026-02-01',
      billingStart: '2026-02-01',
    }),
  );
  for (const nickname of ['组长', '成员乙', '成员丙'])
    applyAction(
      data,
      {
        type: 'member.add',
        payload: { groupId: data.groups[0].id, nickname, seed: `stable-${nickname}` },
      },
      '2026-01-10',
    );
  applyAction(
    data,
    { type: 'group.save', payload: { id: data.groups[0].id, splitMode: 'equal' } },
    '2026-01-10',
  );
  return data;
}

test('month-end anchors recover after February, including multi-month cycles', () => {
  assert.equal(addCycle('2026-01-31', 1, 'month', 1), '2026-02-28');
  assert.equal(addCycle('2026-01-31', 1, 'month', 2), '2026-03-31');
  assert.equal(addCycle('2024-01-31', 1, 'month', 1), '2024-02-29');
  assert.equal(addCycle('2025-11-30', 3, 'month', 1), '2026-02-28');
  assert.equal(addCycle('2025-11-30', 3, 'month', 2), '2026-05-30');
});
test('leap annual anchors and day/week boundaries use calendar arithmetic', () => {
  assert.equal(addCycle('2024-02-29', 1, 'year', 1), '2025-02-28');
  assert.equal(addCycle('2024-02-29', 1, 'year', 4), '2028-02-29');
  assert.equal(addCycle('2025-12-31', 2, 'day', 1), '2026-01-02');
  assert.equal(addCycle('2026-02-25', 1, 'week', 1), '2026-03-04');
  assert.throws(() => addCycle('2026-02-30', 1, 'month', 1));
});
test('account timezone determines today without a UTC off-by-one', () => {
  const now = new Date('2026-02-01T01:00:00Z');
  assert.equal(todayInTimezone('Asia/Shanghai', now), '2026-02-01');
  assert.equal(todayInTimezone('America/Los_Angeles', now), '2026-01-31');
});
test('money uses exact integer minor units and currency precision', () => {
  assert.equal(parseMoney('0.29', 'CNY'), 29);
  assert.equal(parseMoney('123', 'JPY'), 123);
  assert.equal(parseMoney('1.007', 'KWD'), 1007);
  assert.equal(parseMoney('1.2', 'KWD'), 1200);
  assert.throws(() => parseMoney('1.01', 'JPY'));
  assert.throws(() => parseMoney('1.001', 'CNY'));
  assert.throws(() => parseMoney('1e5', 'USD'));
  assert.throws(() => parseMoney('-2', 'USD'));
  assert.throws(() => parseMoney('1000000000000000000000000', 'CNY'));
  assert.match(formatMoney(1007, 'KWD', 'en-US'), /1\.007/);
});

test('NGN and TRY preserve two-decimal prices through billing and backup validation', () => {
  const data = emptyData();
  for (const currency of ['NGN', 'TRY'] as const) {
    assert.equal(parseMoney('1234.56', currency), 123456);
    assert.equal(parseMoney('0.01', currency), 1);
    assert.throws(() => parseMoney('0.001', currency));
    assert.match(formatMoney(123456, currency, 'en-US'), /1,234\.56/);
    save(data, subscription({ currency, amountMinor: parseMoney('1234.56', currency) }));
  }
  materialize(data, '2026-01-31');
  assert.deepEqual(summarizeByCurrency(projectBills(data, '2026-01-01', '2026-01-31')), {
    NGN: 123456,
    TRY: 123456,
  });
  for (const displayCurrency of ['NGN', 'TRY'] as const) {
    applyAction(data, { type: 'settings.save', payload: { displayCurrency } }, '2026-01-31');
    assert.equal(data.settings.displayCurrency, displayCurrency);
    assert.deepEqual(validateData(JSON.parse(JSON.stringify(data)), '2026-01-31'), data);
  }
});
test('trial end is first paid date and becomes an independent cycle anchor', () => {
  const s = subscription({
    anchorDate: '2026-01-01',
    billingStart: '2026-01-01',
    trialEnd: '2026-01-15',
    status: 'trial',
  });
  assert.deepEqual(occurrences(s, '2026-01-01', '2026-03-31'), [
    '2026-01-15',
    '2026-02-15',
    '2026-03-15',
  ]);
  assert.equal(nextDue(s, '2026-02-16'), '2026-03-15');
});
test('expired trial advances its label and creates a pending bill without assuming payment', () => {
  const data = emptyData();
  save(
    data,
    subscription({
      anchorDate: '2026-01-01',
      billingStart: '2026-01-01',
      trialEnd: '2026-01-15',
      status: 'trial',
    }),
  );
  assert.equal(data.subscriptions[0].status, 'trial');
  materialize(data, '2026-01-15');
  assert.equal(data.subscriptions[0].status, 'active');
  assert.equal(data.bills[0].dueDate, '2026-01-15');
  assert.equal(data.bills[0].status, 'pending');
  assert.equal(data.bills[0].paidAt, '');
});
test('annual charge remains in its actual month, separate from monthly equivalent', () => {
  const data = emptyData();
  data.subscriptions.push(subscription({ amountMinor: 120000, unit: 'year' }));
  assert.equal(monthlyEquivalent(data.subscriptions[0]), 10000);
  assert.equal(summarizeByCurrency(projectBills(data, '2026-01-01', '2026-01-31')).CNY, 120000);
  assert.deepEqual(summarizeByCurrency(projectBills(data, '2026-02-01', '2026-02-28')), {});
});
test('old unconfirmed charges do not block next due; paid/skipped snapshots are deduplicated', () => {
  const data = emptyData();
  save(data, subscription());
  materialize(data, '2026-02-28');
  materialize(data, '2026-02-28');
  assert.equal(data.bills.length, 2);
  assert.equal(nextDue(data.subscriptions[0], '2026-03-01'), '2026-03-31');
  applyAction(
    data,
    {
      type: 'bill.status',
      payload: { subscriptionId: data.subscriptions[0].id, dueDate: '2026-03-31', status: 'paid' },
    },
    '2026-03-01',
  );
  applyAction(
    data,
    {
      type: 'bill.status',
      payload: {
        subscriptionId: data.subscriptions[0].id,
        dueDate: '2026-02-28',
        status: 'skipped',
      },
    },
    '2026-03-01',
  );
  const all = projectBills(data, '2026-01-01', '2026-03-31');
  assert.equal(all.length, 3);
  assert.equal(summarizeByCurrency(all).CNY, 6000);
});
test('currencies are aggregated separately and family internal split is never an extra expense', () => {
  const data = family();
  save(
    data,
    subscription({
      currency: 'USD',
      amountMinor: 500,
      anchorDate: '2026-02-01',
      billingStart: '2026-02-01',
    }),
  );
  materialize(data, '2026-02-01');
  assert.deepEqual(summarizeByCurrency(projectBills(data, '2026-02-01', '2026-02-28')), {
    CNY: 3001,
    USD: 500,
  });
  assert.equal(
    data.allocations.reduce((sum, item) => sum + item.amountMinor, 0),
    3001,
  );
});
test('equal split distributes every last minor unit, with a stable leader-first remainder', () => {
  const data = family(100);
  const amounts = splitAmounts(data, data.groups[0], 100, '2026-02-01');
  assert.deepEqual(
    amounts.map((item) => item.amountMinor),
    [34, 33, 33],
  );
  assert.equal(amounts[0].membership.memberId, data.groups[0].leaderId);
});
test('custom split can explicitly leave remainder with leader and rejects overspending atomically', () => {
  const data = family(3000),
    group = data.groups[0];
  applyAction(
    data,
    { type: 'membership.update', payload: { id: data.memberships[1].id, customAmountMinor: 700 } },
    '2026-01-10',
  );
  applyAction(
    data,
    { type: 'membership.update', payload: { id: data.memberships[2].id, customAmountMinor: 900 } },
    '2026-01-10',
  );
  applyAction(
    data,
    { type: 'group.save', payload: { id: group.id, splitMode: 'custom' } },
    '2026-01-10',
  );
  const portions = splitAmounts(data, data.groups[0], 3000, '2026-02-01');
  assert.equal(
    portions.find((item) => item.membership.memberId === data.groups[0].leaderId)?.amountMinor,
    1400,
  );
  const before = structuredClone(data);
  assert.throws(
    () =>
      applyAction(
        data,
        {
          type: 'membership.update',
          payload: { id: data.memberships[1].id, customAmountMinor: 3001 },
        },
        '2026-01-10',
      ),
    /超过套餐/,
  );
  assert.deepEqual(data, before);
});
test('seat capacity includes leader; expired and removed members release seats', () => {
  const data = family();
  applyAction(
    data,
    { type: 'group.save', payload: { id: data.groups[0].id, seats: 3 } },
    '2026-01-10',
  );
  const before = structuredClone(data);
  assert.throws(
    () =>
      applyAction(
        data,
        { type: 'member.add', payload: { groupId: data.groups[0].id, nickname: '第四人' } },
        '2026-01-10',
      ),
    /席位已满/,
  );
  assert.deepEqual(data, before);
  applyAction(
    data,
    { type: 'membership.remove', payload: { id: data.memberships[2].id } },
    '2026-01-11',
  );
  applyAction(
    data,
    {
      type: 'member.add',
      payload: { groupId: data.groups[0].id, nickname: '第四人', expiresAt: '2026-01-12' },
    },
    '2026-01-11',
  );
  assert.equal(activeMemberships(data, data.groups[0].id, '2026-01-12').length, 3);
  assert.equal(activeMemberships(data, data.groups[0].id, '2026-01-13').length, 2);
  applyAction(
    data,
    { type: 'group.save', payload: { id: data.groups[0].id, seats: 2 } },
    '2026-01-13',
  );
});
test('member profile reuse preserves seed; renaming and price changes do not rewrite past snapshots', () => {
  const data = family();
  materialize(data, '2026-02-01');
  const bill = structuredClone(data.bills[0]),
    allocations = structuredClone(data.allocations);
  applyAction(
    data,
    { type: 'member.update', payload: { id: data.members[0].id, nickname: '新昵称' } },
    '2026-02-02',
  );
  applyAction(
    data,
    { type: 'subscription.save', payload: { ...data.subscriptions[0], amountMinor: 6000 } },
    '2026-02-02',
  );
  applyAction(
    data,
    { type: 'membership.remove', payload: { id: data.memberships[2].id } },
    '2026-02-02',
  );
  assert.deepEqual(data.bills[0], bill);
  assert.deepEqual(data.allocations, allocations);
  assert.equal(data.members[0].seed, 'stable-组长');
  materialize(data, '2026-03-01');
  const march = data.bills.find((item) => item.dueDate === '2026-03-01')!;
  assert.equal(march.amountMinor, 6000);
  assert.equal(data.allocations.filter((item) => item.billId === march.id).length, 2);
});
test('pause, resume, stop renewal and archive preserve historical expense', () => {
  const data = emptyData();
  save(data, subscription());
  applyAction(
    data,
    { type: 'subscription.status', payload: { id: data.subscriptions[0].id, status: 'paused' } },
    '2026-02-10',
  );
  assert.equal(nextDue(data.subscriptions[0], '2026-02-10'), null);
  applyAction(
    data,
    {
      type: 'subscription.status',
      payload: { id: data.subscriptions[0].id, status: 'active', resumeDate: '2026-03-05' },
    },
    '2026-02-10',
  );
  assert.equal(nextDue(data.subscriptions[0], '2026-02-10'), '2026-03-05');
  applyAction(
    data,
    { type: 'subscription.status', payload: { id: data.subscriptions[0].id, status: 'cancelled' } },
    '2026-03-06',
  );
  assert.equal(data.subscriptions[0].stopDate, '2026-04-05');
  assert.equal(nextDue(data.subscriptions[0], '2026-03-06'), null);
  assert.equal(projectBills(data, '2026-04-01', '2026-04-30').length, 0);
  applyAction(
    data,
    { type: 'subscription.status', payload: { id: data.subscriptions[0].id, status: 'archived' } },
    '2026-03-06',
  );
  assert.equal(data.bills.length, 2);
});
test('stopping a nonrenewing subscription retains its current period end and never projects renewals', () => {
  const data = emptyData();
  save(data, subscription({ autoRenew: false }));
  applyAction(
    data,
    { type: 'subscription.status', payload: { id: data.subscriptions[0].id, status: 'cancelled' } },
    '2026-02-10',
  );
  assert.equal(data.subscriptions[0].stopDate, '2026-02-28');
  assert.equal(occurrences(data.subscriptions[0], '2026-02-10', '2026-12-31').length, 0);
  assert.equal(data.bills.length, 1);
});
test('resuming through the full subscription editor clears cancellation and starts a new current cycle', () => {
  const data = emptyData();
  save(data, subscription());
  applyAction(
    data,
    { type: 'subscription.status', payload: { id: data.subscriptions[0].id, status: 'cancelled' } },
    '2026-02-10',
  );
  applyAction(
    data,
    { type: 'subscription.save', payload: { ...data.subscriptions[0], status: 'active' } },
    '2026-03-05',
  );
  assert.equal(data.subscriptions[0].autoRenew, true);
  assert.equal(data.subscriptions[0].stopDate, '');
  assert.equal(data.subscriptions[0].anchorDate, '2026-03-05');
  assert.equal(nextDue(data.subscriptions[0], '2026-03-06'), '2026-04-05');
  assert.deepEqual(
    data.bills.map((item) => item.dueDate),
    ['2026-01-31', '2026-03-05'],
  );
});
test('cancelling in the full editor disables auto-renew and retains the current entitlement end', () => {
  const data = emptyData();
  save(data, subscription());
  applyAction(
    data,
    { type: 'subscription.save', payload: { ...data.subscriptions[0], status: 'cancelled' } },
    '2026-02-10',
  );
  assert.equal(data.subscriptions[0].autoRenew, false);
  assert.equal(data.subscriptions[0].stopDate, '2026-02-28');
  assert.deepEqual(
    projectBills(data, '2026-01-01', '2026-04-30').map((item) => item.dueDate),
    ['2026-01-31'],
  );
});
test('profile and membership edits save together and roll back together when either is invalid', () => {
  const data = family();
  const before = structuredClone(data);
  assert.throws(
    () =>
      applyAction(
        data,
        {
          type: 'member.update',
          payload: {
            id: data.members[0].id,
            nickname: '不应被保存',
            membership: { id: data.memberships[0].id, expiresAt: '2025-12-01' },
          },
        },
        '2026-01-11',
      ),
    /截止日期不能早于/,
  );
  assert.deepEqual(data, before);
  applyAction(
    data,
    {
      type: 'member.update',
      payload: {
        id: data.members[0].id,
        nickname: '一起保存',
        membership: { id: data.memberships[0].id, customAmountMinor: 500 },
      },
    },
    '2026-01-11',
  );
  assert.equal(data.members[0].nickname, '一起保存');
  assert.equal(data.memberships[0].customAmountMinor, 500);
  assert.equal(data.revision, before.revision + 1);
});
test('manual current split adjustment requires exact sum and resets affected payment confirmation', () => {
  const data = family(3000);
  materialize(data, '2026-02-01');
  applyAction(
    data,
    { type: 'allocation.pay', payload: { id: data.allocations[0].id, status: 'paid' } },
    '2026-02-02',
  );
  assert.equal(data.bills[0].status, 'pending');
  const changes = data.allocations.map((item, index) => ({
    id: item.id,
    amountMinor: [1400, 900, 700][index],
  }));
  applyAction(
    data,
    { type: 'allocation.adjust', payload: { billId: data.bills[0].id, allocations: changes } },
    '2026-02-02',
  );
  assert.equal(data.allocations[0].status, 'pending');
  const before = structuredClone(data);
  assert.throws(
    () =>
      applyAction(
        data,
        {
          type: 'allocation.adjust',
          payload: {
            billId: data.bills[0].id,
            allocations: changes.map((item) => ({ ...item, amountMinor: 1 })),
          },
        },
        '2026-02-02',
      ),
    /恰好等于/,
  );
  assert.deepEqual(data, before);
});
test('a family bill created before adding members can receive an explicit current-period split', () => {
  const data = emptyData();
  save(
    data,
    subscription({ kind: 'family', anchorDate: '2026-01-10', billingStart: '2026-01-10' }),
  );
  assert.equal(data.bills.length, 1);
  assert.equal(data.allocations.length, 0);
  for (const nickname of ['甲', '乙'])
    applyAction(
      data,
      { type: 'member.add', payload: { groupId: data.groups[0].id, nickname } },
      '2026-01-10',
    );
  assert.equal(data.allocations.length, 0);
  applyAction(
    data,
    {
      type: 'allocation.adjust',
      payload: {
        billId: data.bills[0].id,
        allocations: data.members.map((member) => ({ memberId: member.id, amountMinor: 1500 })),
      },
    },
    '2026-01-10',
  );
  assert.equal(data.allocations.length, 2);
  applyAction(
    data,
    { type: 'allocation.pay', payload: { id: data.allocations[0].id, status: 'paid' } },
    '2026-01-10',
  );
  assert.throws(
    () =>
      applyAction(
        data,
        {
          type: 'allocation.adjust',
          payload: {
            billId: data.bills[0].id,
            allocations: [{ id: data.allocations[1].id, amountMinor: 3000 }],
          },
        },
        '2026-01-10',
      ),
    /不能移除已记录交费/,
  );
});
test('changing a schedule never creates phantom retroactive invoices at the new price', () => {
  const data = emptyData();
  save(data, subscription());
  applyAction(
    data,
    {
      type: 'subscription.save',
      payload: {
        ...data.subscriptions[0],
        anchorDate: '2026-01-15',
        billingStart: '2026-01-15',
        amountMinor: 6000,
      },
    },
    '2026-02-10',
  );
  assert.equal(data.subscriptions[0].billingStart, '2026-02-11');
  const bills = projectBills(data, '2026-01-01', '2026-02-28');
  assert.deepEqual(
    bills.map((item) => [item.dueDate, item.amountMinor]),
    [
      ['2026-01-31', 3000],
      ['2026-02-15', 6000],
    ],
  );
  materialize(data, '2026-02-15');
  materialize(data, '2026-02-15');
  assert.equal(data.bills.length, 2);
});
test('restore rejects broken references, malformed money, duplicate periods and unexpected secret fields', () => {
  const data = family();
  materialize(data, '2026-02-01');
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data)), '2026-02-01'), data);
  const invalidReference = structuredClone(data);
  invalidReference.allocations[0].memberId = 'missing';
  assert.throws(() => validateData(invalidReference));
  const invalidMoney = structuredClone(data);
  invalidMoney.subscriptions[0].amountMinor = 0.1;
  assert.throws(() => validateData(invalidMoney));
  const duplicateBill = structuredClone(data);
  duplicateBill.bills.push({ ...duplicateBill.bills[0], id: 'different-id' });
  assert.throws(() => validateData(duplicateBill), /同账期重复/);
  assert.throws(() => validateData({ ...data, passwordHash: 'forbidden' }), /未知字段/);
  assert.throws(() =>
    validateData({ ...data, settings: { ...data.settings, timezone: 'invalid' } }),
  );
});
test('optimistic revision rejects stale updates and the same service may have multiple subscriptions', () => {
  const data = emptyData();
  save(data, subscription());
  save(data, subscription());
  assert.equal(data.subscriptions.length, 2);
  assert.notEqual(data.subscriptions[0].id, data.subscriptions[1].id);
  assert.throws(
    () =>
      applyAction(
        data,
        { type: 'settings.save', revision: data.revision - 1, payload: { theme: 'dark' } },
        '2026-01-10',
      ),
    /其他设备/,
  );
});

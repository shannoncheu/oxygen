import type {
  Action,
  Allocation,
  Bill,
  BusinessData,
  FamilyGroup,
  Member,
  Membership,
  Settings,
  Subscription,
} from './model';
import {
  CURRENCY_DIGITS,
  MAX_MONEY,
  addDays,
  isDate,
  nextDue,
  occurrences,
  snapshotBill,
  todayInTimezone,
} from './billing';

type RecordValue = Record<string, unknown>;
const currencies = Object.keys(CURRENCY_DIGITS);
const statuses = ['active', 'trial', 'paused', 'cancelled', 'archived'];
const id = () => crypto.randomUUID();
function fail(message: string): never {
  throw new Error(message);
}
function object(value: unknown, label = '数据'): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式无效`);
  return value as RecordValue;
}
function keys(value: RecordValue, allowed: string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${label}包含未知字段：${key}`);
}
function string(value: unknown, label: string, max = 500, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
  )
    fail(`${label}无效或过长`);
  return value;
}
function identifier(value: unknown, label = 'ID'): string {
  const result = string(value, label, 160, true);
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) fail(`${label}格式无效`);
  return result;
}
function integer(value: unknown, label: string, min = 0, max = MAX_MONEY): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label}必须为 ${min} 到 ${max} 之间的整数`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}必须为布尔值`);
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(`${label}无效`);
  return value as T;
}
function date(value: unknown, label: string, optional = false): string {
  if (optional && value === '') return '';
  if (!isDate(value)) fail(`${label}无效，请使用 1900—2200 年的 YYYY-MM-DD 日期`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  const result = string(value, label, 40, true);
  if (
    !isDate(result) &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result)))
  )
    fail(`${label}无效`);
  return result;
}
function color(value: unknown): string {
  const result = string(value, '品牌色', 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(result)) fail('品牌色必须为六位十六进制颜色');
  return result;
}
function logo(value: unknown): string {
  const result = string(value, 'Logo', 240);
  if (
    result &&
    !/^(?:[a-zA-Z0-9_-]+|\/(?:logos|brands)\/[a-zA-Z0-9_-]+\.(?:svg|png|jpg|jpeg|webp)|\/api\/files\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
      result,
    )
  )
    fail('Logo 只能引用本地服务标识或已上传文件');
  return result;
}
function website(value: unknown): string {
  const result = string(value, '服务网址', 2000);
  if (result) {
    let url: URL;
    try {
      url = new URL(result);
    } catch {
      fail('服务网址格式无效');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      fail('服务网址必须使用 HTTP 或 HTTPS，且不能包含凭据');
  }
  return result;
}

function subscriptionSchema(value: unknown): Subscription {
  const p = object(value, '订阅');
  keys(
    p,
    [
      'id',
      'name',
      'serviceId',
      'logo',
      'color',
      'category',
      'plan',
      'kind',
      'amountMinor',
      'currency',
      'interval',
      'unit',
      'anchorDate',
      'billingStart',
      'trialEnd',
      'autoRenew',
      'status',
      'stopDate',
      'notes',
      'website',
      'createdAt',
    ],
    '订阅',
  );
  const result: Subscription = {
    id: identifier(p.id),
    name: string(p.name, '服务名称', 100, true).trim(),
    serviceId: string(p.serviceId, '服务标识', 100),
    logo: logo(p.logo),
    color: color(p.color),
    category: string(p.category, '分类', 50, true),
    plan: string(p.plan, '套餐', 100),
    kind: choice(p.kind, ['personal', 'family'], '订阅类型'),
    amountMinor: integer(p.amountMinor, '订阅金额'),
    currency: choice(p.currency, currencies, '币种') as Subscription['currency'],
    interval: integer(p.interval, '周期', 1, 1000),
    unit: choice(p.unit, ['day', 'week', 'month', 'year'], '计费单位'),
    anchorDate: date(p.anchorDate, '计费锚点'),
    billingStart: date(p.billingStart, '计费开始日期'),
    trialEnd: date(p.trialEnd, '试用截止日期', true),
    autoRenew: boolean(p.autoRenew, '自动续费'),
    status: choice(p.status, statuses, '订阅状态') as Subscription['status'],
    stopDate: date(p.stopDate, '停止续费日期', true),
    notes: string(p.notes, '备注', 5000),
    website: website(p.website),
    createdAt: timestamp(p.createdAt, '创建时间'),
  };
  if (result.billingStart < result.anchorDate) fail('计费开始日期不能早于计费锚点');
  if (result.trialEnd && result.trialEnd < result.anchorDate) fail('试用截止日期不能早于计费锚点');
  if (result.status === 'trial' && !result.trialEnd) fail('试用订阅需要填写试用截止日期');
  return result;
}
function groupSchema(value: unknown): FamilyGroup {
  const p = object(value, '家庭组');
  keys(p, ['id', 'subscriptionId', 'name', 'seats', 'splitMode', 'leaderId', 'notes'], '家庭组');
  return {
    id: identifier(p.id),
    subscriptionId: identifier(p.subscriptionId),
    name: string(p.name, '家庭组名称', 100, true).trim(),
    seats: integer(p.seats, '总席位', 1, 100),
    splitMode: choice(p.splitMode, ['none', 'equal', 'custom'], '分摊方式'),
    leaderId: p.leaderId === '' ? '' : identifier(p.leaderId),
    notes: string(p.notes, '家庭组备注', 5000),
  };
}
function memberSchema(value: unknown): Member {
  const p = object(value, '成员');
  keys(p, ['id', 'nickname', 'seed', 'avatarStyle', 'avatarVersion', 'contact', 'notes'], '成员');
  return {
    id: identifier(p.id),
    nickname: string(p.nickname, '昵称', 80, true).trim(),
    seed: string(p.seed, '头像种子', 160, true),
    avatarStyle: choice(p.avatarStyle, ['thumbs'], '头像风格'),
    avatarVersion: string(p.avatarVersion, '头像版本', 32, true),
    contact: string(p.contact, '联系方式', 300),
    notes: string(p.notes, '成员备注', 5000),
  };
}
function membershipSchema(value: unknown): Membership {
  const p = object(value, '成员关系');
  keys(
    p,
    [
      'id',
      'groupId',
      'memberId',
      'role',
      'joinedAt',
      'leftAt',
      'expiresAt',
      'participates',
      'customAmountMinor',
    ],
    '成员关系',
  );
  const result: Membership = {
    id: identifier(p.id),
    groupId: identifier(p.groupId),
    memberId: identifier(p.memberId),
    role: choice(p.role, ['leader', 'member'], '成员身份'),
    joinedAt: date(p.joinedAt, '加入日期'),
    leftAt: date(p.leftAt, '退出日期', true),
    expiresAt: date(p.expiresAt, '个人使用截止日期', true),
    participates: boolean(p.participates, '参与分摊'),
    customAmountMinor: integer(p.customAmountMinor, '成员自定义金额'),
  };
  if (result.leftAt && result.leftAt < result.joinedAt) fail('退出日期不能早于加入日期');
  if (result.expiresAt && result.expiresAt < result.joinedAt)
    fail('个人使用截止日期不能早于加入日期');
  return result;
}
function billSchema(value: unknown): Bill {
  const p = object(value, '账单');
  keys(
    p,
    [
      'id',
      'subscriptionId',
      'dueDate',
      'periodEnd',
      'name',
      'category',
      'serviceId',
      'logo',
      'color',
      'amountMinor',
      'currency',
      'status',
      'paidAt',
      'note',
    ],
    '账单',
  );
  const result: Bill = {
    id: identifier(p.id),
    subscriptionId: identifier(p.subscriptionId),
    dueDate: date(p.dueDate, '账单日期'),
    periodEnd: date(p.periodEnd, '账期结束'),
    name: string(p.name, '账单名称', 100, true),
    category: string(p.category, '账单分类', 50, true),
    serviceId: string(p.serviceId, '服务标识', 100),
    logo: logo(p.logo),
    color: color(p.color),
    amountMinor: integer(p.amountMinor, '账单金额'),
    currency: choice(p.currency, currencies, '币种') as Bill['currency'],
    status: choice(p.status, ['pending', 'paid', 'skipped'], '账单状态'),
    paidAt: date(p.paidAt, '付款记录日期', true),
    note: string(p.note, '账单备注', 5000),
  };
  if (result.periodEnd <= result.dueDate) fail('账期结束必须晚于开始日期');
  if ((result.status === 'paid') !== Boolean(result.paidAt)) fail('账单付款状态与记录日期不一致');
  return result;
}
function allocationSchema(value: unknown): Allocation {
  const p = object(value, '分摊');
  keys(
    p,
    ['id', 'billId', 'memberId', 'nickname', 'seed', 'amountMinor', 'status', 'paidAt'],
    '分摊',
  );
  const result: Allocation = {
    id: identifier(p.id),
    billId: identifier(p.billId),
    memberId: identifier(p.memberId),
    nickname: string(p.nickname, '分摊昵称', 80, true),
    seed: string(p.seed, '分摊头像', 160, true),
    amountMinor: integer(p.amountMinor, '分摊金额'),
    status: choice(p.status, ['pending', 'paid'], '交费状态'),
    paidAt: date(p.paidAt, '交费记录日期', true),
  };
  if ((result.status === 'paid') !== Boolean(result.paidAt)) fail('交费状态与记录日期不一致');
  return result;
}
function settingsSchema(value: unknown): Settings {
  const p = object(value, '设置');
  keys(p, ['timezone', 'displayCurrency', 'theme', 'categories', 'reminderDays'], '设置');
  const timezone = string(p.timezone, '时区', 100, true);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    fail('时区无效');
  }
  if (!Array.isArray(p.categories) || p.categories.length < 1 || p.categories.length > 50)
    fail('分类数量必须为 1—50 个');
  const categories = p.categories.map((item) => string(item, '分类', 50, true).trim());
  if (new Set(categories).size !== categories.length) fail('分类不能重复');
  return {
    timezone,
    displayCurrency: choice(
      p.displayCurrency,
      currencies,
      '显示币种',
    ) as Settings['displayCurrency'],
    theme: choice(p.theme, ['light', 'dark', 'system'], '主题'),
    categories,
    reminderDays: integer(p.reminderDays, '提醒天数', 0, 90),
  };
}

export function activeMemberships(data: BusinessData, groupId: string, day: string): Membership[] {
  return data.memberships.filter(
    (item) =>
      item.groupId === groupId &&
      item.joinedAt <= day &&
      (!item.leftAt || item.leftAt > day) &&
      (!item.expiresAt || item.expiresAt >= day),
  );
}
function participants(data: BusinessData, group: FamilyGroup, day: string): Membership[] {
  return activeMemberships(data, group.id, day)
    .filter((item) => item.participates)
    .sort(
      (a, b) =>
        Number(b.memberId === group.leaderId) - Number(a.memberId === group.leaderId) ||
        a.id.localeCompare(b.id),
    );
}
/** With custom amounts, the participating leader explicitly bears any remainder. */
export function splitAmounts(
  data: BusinessData,
  group: FamilyGroup,
  amountMinor: number,
  day: string,
): { membership: Membership; amountMinor: number }[] {
  const members = participants(data, group, day);
  if (group.splitMode === 'none' || members.length === 0) return [];
  if (group.splitMode === 'equal') {
    const base = Math.floor(amountMinor / members.length),
      remainder = amountMinor % members.length;
    return members.map((membership, index) => ({
      membership,
      amountMinor: base + (index < remainder ? 1 : 0),
    }));
  }
  const total = members.reduce((sum, item) => sum + item.customAmountMinor, 0);
  if (total > amountMinor) fail('自定义分摊总额超过套餐金额，请先调整成员金额');
  const remainder = amountMinor - total;
  const leader = members.find((item) => item.memberId === group.leaderId);
  if (remainder && !leader) fail('自定义分摊总额必须等于套餐金额，或指定参与分摊的组长承担余款');
  return members.map((membership) => ({
    membership,
    amountMinor: membership.customAmountMinor + (membership === leader ? remainder : 0),
  }));
}
function makeAllocations(data: BusinessData, bill: Bill): void {
  const subscription = data.subscriptions.find((item) => item.id === bill.subscriptionId)!;
  const group = data.groups.find((item) => item.subscriptionId === subscription.id);
  if (!group || subscription.kind !== 'family') return;
  for (const portion of splitAmounts(data, group, bill.amountMinor, bill.dueDate)) {
    const member = data.members.find((item) => item.id === portion.membership.memberId)!;
    data.allocations.push({
      id: id(),
      billId: bill.id,
      memberId: member.id,
      nickname: member.nickname,
      seed: member.seed,
      amountMinor: portion.amountMinor,
      status: 'pending',
      paidAt: '',
    });
  }
}
export function materialize(data: BusinessData, today: string): void {
  date(today, '今天');
  const seen = new Set(data.bills.map((item) => `${item.subscriptionId}|${item.dueDate}`));
  for (const subscription of data.subscriptions) {
    if (subscription.status === 'trial' && subscription.trialEnd && subscription.trialEnd <= today)
      subscription.status = 'active';
    for (const due of occurrences(subscription, subscription.billingStart, today)) {
      const key = `${subscription.id}|${due}`;
      if (seen.has(key)) continue;
      if (data.bills.length >= 50_000) fail('账单超过 50,000 条，请先归档历史数据');
      const bill = snapshotBill(subscription, due, id());
      makeAllocations(data, bill);
      data.bills.push(bill);
      seen.add(key);
    }
  }
}
function unique<T extends { id: string }>(items: T[], label: string): Set<string> {
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) fail(`${label} ID 重复`);
  return ids;
}
function validateRelations(data: BusinessData, today: string): void {
  const subscriptions = unique(data.subscriptions, '订阅'),
    groups = unique(data.groups, '家庭组'),
    members = unique(data.members, '成员'),
    bills = unique(data.bills, '账单');
  unique(data.memberships, '成员关系');
  unique(data.allocations, '分摊');
  const subscriptionGroups = new Set<string>();
  for (const group of data.groups) {
    if (!subscriptions.has(group.subscriptionId) || subscriptionGroups.has(group.subscriptionId))
      fail('家庭组关联订阅不存在或一个订阅有多个家庭组');
    subscriptionGroups.add(group.subscriptionId);
    if (
      group.leaderId &&
      (!members.has(group.leaderId) ||
        !data.memberships.some(
          (item) => item.groupId === group.id && item.memberId === group.leaderId,
        ))
    )
      fail('组长必须是家庭组中的成员');
  }
  for (const subscription of data.subscriptions)
    if (subscription.kind === 'family' && !subscriptionGroups.has(subscription.id))
      fail('家庭订阅缺少关联家庭组');
  for (const relation of data.memberships)
    if (!groups.has(relation.groupId) || !members.has(relation.memberId))
      fail('成员关系引用不存在的数据');
  for (const group of data.groups) {
    const relationships = data.memberships.filter((item) => item.groupId === group.id);
    const events: { day: string; change: number; memberId: string }[] = [];
    for (const item of relationships) {
      const end =
        [item.leftAt, item.expiresAt ? addDays(item.expiresAt, 1) : ''].filter(Boolean).sort()[0] ||
        '9999-12-31';
      if (end <= item.joinedAt || end <= today) continue;
      events.push({
        day: item.joinedAt > today ? item.joinedAt : today,
        change: 1,
        memberId: item.memberId,
      });
      events.push({ day: end, change: -1, memberId: item.memberId });
    }
    events.sort((a, b) => a.day.localeCompare(b.day) || a.change - b.change);
    const occupied = new Set<string>();
    for (const event of events) {
      if (event.change < 0) occupied.delete(event.memberId);
      else {
        if (occupied.has(event.memberId)) fail('同一成员不能重复占用同一家庭组席位');
        occupied.add(event.memberId);
        if (occupied.size > group.seats)
          fail(`家庭组「${group.name}」席位已满（${occupied.size}/${group.seats}）`);
      }
    }
  }
  const billKeys = new Set<string>();
  for (const bill of data.bills) {
    const key = `${bill.subscriptionId}|${bill.dueDate}`;
    if (!subscriptions.has(bill.subscriptionId) || billKeys.has(key))
      fail('账单关联无效或同账期重复');
    billKeys.add(key);
  }
  const allocationKeys = new Set<string>(),
    totals = new Map<string, number>();
  for (const allocation of data.allocations) {
    const key = `${allocation.billId}|${allocation.memberId}`;
    if (
      !bills.has(allocation.billId) ||
      !members.has(allocation.memberId) ||
      allocationKeys.has(key)
    )
      fail('分摊关联无效或成员在同一账期重复');
    allocationKeys.add(key);
    totals.set(allocation.billId, (totals.get(allocation.billId) || 0) + allocation.amountMinor);
  }
  for (const bill of data.bills)
    if (totals.has(bill.id) && totals.get(bill.id) !== bill.amountMinor)
      fail('历史账单的成员分摊总额必须等于账单金额');
}
/** Strict, bounded business-data decoder. Auth/session fields are never accepted. */
export function validateData(input: unknown, asOf?: string): BusinessData {
  const p = object(input);
  keys(
    p,
    [
      'settings',
      'subscriptions',
      'groups',
      'members',
      'memberships',
      'bills',
      'allocations',
      'revision',
    ],
    '业务数据',
  );
  function list<T>(key: string, max: number, decode: (value: unknown) => T): T[] {
    const values = p[key];
    if (!Array.isArray(values) || values.length > max)
      fail(`${key} 数据格式无效或超过 ${max} 条限制`);
    return values.map(decode);
  }
  const data: BusinessData = {
    settings: settingsSchema(p.settings),
    subscriptions: list('subscriptions', 2000, subscriptionSchema),
    groups: list('groups', 2000, groupSchema),
    members: list('members', 10_000, memberSchema),
    memberships: list('memberships', 20_000, membershipSchema),
    bills: list('bills', 50_000, billSchema),
    allocations: list('allocations', 200_000, allocationSchema),
    revision: integer(p.revision, '数据版本', 0, Number.MAX_SAFE_INTEGER - 1),
  };
  const today = asOf || todayInTimezone(data.settings.timezone);
  validateRelations(data, today);
  validateUpcomingSplits(data, today);
  return data;
}

function byId<T extends { id: string }>(items: T[], value: unknown, label: string): T {
  const key = identifier(value);
  return items.find((item) => item.id === key) || fail(`${label}不存在`);
}
function ensureGroup(data: BusinessData, subscription: Subscription): void {
  if (
    subscription.kind === 'family' &&
    !data.groups.some((item) => item.subscriptionId === subscription.id)
  )
    data.groups.push({
      id: id(),
      subscriptionId: subscription.id,
      name: `${subscription.name} 家庭组`,
      seats: 6,
      splitMode: 'none',
      leaderId: '',
      notes: '',
    });
}
function setLeader(data: BusinessData, group: FamilyGroup, memberId: string): void {
  group.leaderId = memberId;
  for (const membership of data.memberships.filter((item) => item.groupId === group.id))
    membership.role = membership.memberId === memberId ? 'leader' : 'member';
}
function updateMembership(data: BusinessData, membership: Membership, p: RecordValue): void {
  keys(
    p,
    ['id', 'role', 'joinedAt', 'leftAt', 'expiresAt', 'participates', 'customAmountMinor'],
    '成员关系更新',
  );
  Object.assign(membership, membershipSchema({ ...membership, ...p }));
  const group = byId(data.groups, membership.groupId, '家庭组');
  if (membership.role === 'leader') setLeader(data, group, membership.memberId);
  else if (group.leaderId === membership.memberId) setLeader(data, group, '');
}
function validateUpcomingSplits(data: BusinessData, today: string): void {
  for (const group of data.groups) {
    const subscription = data.subscriptions.find((item) => item.id === group.subscriptionId)!;
    if (subscription.kind !== 'family') continue;
    const boundaries = new Set([addDays(today, 1)]);
    for (const membership of data.memberships.filter((item) => item.groupId === group.id)) {
      for (const point of [
        membership.joinedAt,
        membership.leftAt,
        membership.expiresAt ? addDays(membership.expiresAt, 1) : '',
      ])
        if (point > today) boundaries.add(point);
    }
    for (const point of boundaries) {
      const due = nextDue(subscription, point);
      if (due) splitAmounts(data, group, subscription.amountMinor, due);
    }
  }
}

/** Atomic at the object level: an invalid action leaves the caller's data unchanged. */
export function applyAction(data: BusinessData, action: Action, today: string): void {
  date(today, '今天');
  object(action, '操作');
  if (action.revision !== undefined && action.revision !== data.revision)
    fail('数据已在其他设备更新，请刷新后重试');
  const draft = structuredClone(data);
  materialize(draft, today);
  const p = object(action.payload, '操作参数');
  switch (action.type) {
    case 'subscription.save': {
      const existing = p.id ? byId(draft.subscriptions, p.id, '订阅') : undefined;
      const subscription = subscriptionSchema({
        ...p,
        id: existing?.id || id(),
        createdAt: existing?.createdAt || today,
      });
      // The old schedule was materialized above. A changed schedule starts tomorrow
      // at the earliest, so it cannot invent retroactive charges at today's price.
      if (
        existing &&
        (['anchorDate', 'billingStart', 'interval', 'unit', 'trialEnd'] as const).some(
          (key) => existing[key] !== subscription[key],
        )
      ) {
        const earliest = addDays(today, 1);
        if (subscription.billingStart < earliest) subscription.billingStart = earliest;
      }
      if (
        existing &&
        ['paused', 'cancelled', 'archived'].includes(existing.status) &&
        ['active', 'trial'].includes(subscription.status)
      ) {
        const resume = subscription.billingStart > today ? subscription.billingStart : today;
        subscription.anchorDate = resume;
        subscription.billingStart = resume;
        subscription.stopDate = '';
        subscription.autoRenew = true;
        if (subscription.status === 'active') subscription.trialEnd = '';
      }
      if (subscription.status === 'cancelled') {
        subscription.autoRenew = false;
        if (!subscription.stopDate && existing) {
          const currentPeriodEnd = draft.bills
            .filter(
              (item) =>
                item.subscriptionId === subscription.id &&
                item.dueDate <= today &&
                item.periodEnd > today &&
                item.status !== 'skipped',
            )
            .map((item) => item.periodEnd)
            .sort()
            .at(-1);
          subscription.stopDate = nextDue(existing, addDays(today, 1)) || currentPeriodEnd || today;
        }
      }
      if (existing) Object.assign(existing, subscription);
      else {
        if (draft.subscriptions.length >= 2000) fail('订阅数量已达上限');
        draft.subscriptions.push(subscription);
      }
      ensureGroup(draft, subscription);
      break;
    }
    case 'subscription.status': {
      keys(p, ['id', 'status', 'resumeDate'], '状态操作');
      const subscription = byId(draft.subscriptions, p.id, '订阅');
      const status = choice(p.status, statuses, '订阅状态') as Subscription['status'];
      if (
        status === 'active' &&
        ['paused', 'cancelled', 'archived'].includes(subscription.status)
      ) {
        const resume = date(p.resumeDate || today, '恢复计费日期');
        if (resume < today) fail('恢复日期不能早于今天');
        subscription.anchorDate = resume;
        subscription.billingStart = resume;
        subscription.trialEnd = '';
        subscription.stopDate = '';
        subscription.autoRenew = true;
      } else if (status === 'cancelled') {
        const currentPeriodEnd = draft.bills
          .filter(
            (item) =>
              item.subscriptionId === subscription.id &&
              item.dueDate <= today &&
              item.periodEnd > today &&
              item.status !== 'skipped',
          )
          .map((item) => item.periodEnd)
          .sort()
          .at(-1);
        subscription.stopDate =
          nextDue(subscription, addDays(today, 1)) || currentPeriodEnd || today;
        subscription.autoRenew = false;
      }
      if (status === 'trial' && !subscription.trialEnd) fail('请先填写试用截止日期');
      subscription.status = status;
      break;
    }
    case 'group.save': {
      keys(
        p,
        ['id', 'subscriptionId', 'name', 'seats', 'splitMode', 'leaderId', 'notes'],
        '家庭组设置',
      );
      const group = p.id
        ? byId(draft.groups, p.id, '家庭组')
        : draft.groups.find((item) => item.subscriptionId === p.subscriptionId) ||
          fail('家庭组不存在');
      if (p.subscriptionId !== undefined && p.subscriptionId !== group.subscriptionId)
        fail('不能改变家庭组关联订阅');
      Object.assign(
        group,
        groupSchema({ ...group, ...p, id: group.id, subscriptionId: group.subscriptionId }),
      );
      setLeader(draft, group, group.leaderId);
      break;
    }
    case 'member.add': {
      keys(
        p,
        [
          'groupId',
          'memberId',
          'nickname',
          'seed',
          'avatarStyle',
          'avatarVersion',
          'contact',
          'notes',
          'role',
          'joinedAt',
          'expiresAt',
          'participates',
          'customAmountMinor',
        ],
        '添加成员',
      );
      const group = byId(draft.groups, p.groupId, '家庭组');
      let member: Member;
      if (p.memberId) member = byId(draft.members, p.memberId, '成员档案');
      else {
        member = memberSchema({
          id: id(),
          nickname: p.nickname,
          seed: p.seed || id(),
          avatarStyle: 'thumbs',
          avatarVersion: p.avatarVersion || '9.4.2',
          contact: p.contact ?? '',
          notes: p.notes ?? '',
        });
        draft.members.push(member);
      }
      const relation = membershipSchema({
        id: id(),
        groupId: group.id,
        memberId: member.id,
        role: p.role || (!group.leaderId ? 'leader' : 'member'),
        joinedAt: p.joinedAt || today,
        leftAt: '',
        expiresAt: p.expiresAt || '',
        participates: p.participates ?? true,
        customAmountMinor: p.customAmountMinor ?? 0,
      });
      draft.memberships.push(relation);
      if (relation.role === 'leader') setLeader(draft, group, member.id);
      break;
    }
    case 'member.update': {
      keys(
        p,
        [
          'id',
          'nickname',
          'seed',
          'avatarStyle',
          'avatarVersion',
          'contact',
          'notes',
          'membership',
        ],
        '成员档案更新',
      );
      const member = byId(draft.members, p.id, '成员');
      const { membership: relationPatch, ...profilePatch } = p;
      Object.assign(member, memberSchema({ ...member, ...profilePatch }));
      if (relationPatch !== undefined) {
        const fields = object(relationPatch, '成员关系');
        const membership = byId(draft.memberships, fields.id, '成员关系');
        if (membership.memberId !== member.id) fail('成员关系不属于这个成员档案');
        updateMembership(draft, membership, fields);
      }
      break;
    }
    case 'membership.update': {
      keys(
        p,
        ['id', 'role', 'joinedAt', 'leftAt', 'expiresAt', 'participates', 'customAmountMinor'],
        '成员关系更新',
      );
      const membership = byId(draft.memberships, p.id, '成员关系');
      updateMembership(draft, membership, p);
      break;
    }
    case 'membership.remove': {
      keys(p, ['id'], '移除成员');
      const membership = byId(draft.memberships, p.id, '成员关系');
      membership.leftAt = membership.joinedAt > today ? membership.joinedAt : today;
      const group = byId(draft.groups, membership.groupId, '家庭组');
      if (group.leaderId === membership.memberId)
        setLeader(draft, group, activeMemberships(draft, group.id, today)[0]?.memberId || '');
      break;
    }
    case 'bill.status': {
      keys(p, ['subscriptionId', 'dueDate', 'status', 'note'], '账单状态');
      const subscription = byId(draft.subscriptions, p.subscriptionId, '订阅');
      const due = date(p.dueDate, '账单日期');
      let bill = draft.bills.find(
        (item) => item.subscriptionId === subscription.id && item.dueDate === due,
      );
      if (!bill) {
        if (!occurrences(subscription, due, due).length) fail('该日没有计划账单');
        bill = snapshotBill(subscription, due, id());
        makeAllocations(draft, bill);
        draft.bills.push(bill);
      }
      bill.status = choice(p.status, ['pending', 'paid', 'skipped'], '账单状态');
      bill.paidAt = bill.status === 'paid' ? today : '';
      if (p.note !== undefined) bill.note = string(p.note, '账单备注', 5000);
      break;
    }
    case 'allocation.pay': {
      keys(p, ['id', 'status'], '成员交费');
      const allocation = byId(draft.allocations, p.id, '分摊');
      allocation.status = choice(p.status, ['pending', 'paid'], '交费状态');
      allocation.paidAt = allocation.status === 'paid' ? today : '';
      break;
    }
    case 'allocation.adjust': {
      keys(p, ['billId', 'allocations'], '本期分摊调整');
      const bill = byId(draft.bills, p.billId, '账单');
      const existing = draft.allocations.filter((item) => item.billId === bill.id);
      if (!Array.isArray(p.allocations) || p.allocations.length > 100)
        fail('请提交本账期完整分摊清单，最多 100 人');
      const seen = new Set<string>();
      const replacement: Allocation[] = [];
      let total = 0;
      for (const value of p.allocations) {
        const entry = object(value);
        keys(entry, ['id', 'memberId', 'amountMinor'], '分摊金额');
        let allocation: Allocation;
        if (entry.id) {
          allocation = byId(existing, entry.id, '本账期分摊');
          if (entry.memberId !== undefined && entry.memberId !== allocation.memberId)
            fail('不能改变已有分摊记录的成员');
        } else {
          const member = byId(draft.members, entry.memberId, '成员档案');
          allocation = existing.find((item) => item.memberId === member.id) || {
            id: id(),
            billId: bill.id,
            memberId: member.id,
            nickname: member.nickname,
            seed: member.seed,
            amountMinor: 0,
            status: 'pending',
            paidAt: '',
          };
        }
        if (seen.has(allocation.memberId)) fail('分摊成员不能重复');
        seen.add(allocation.memberId);
        const amount = integer(entry.amountMinor, '本期分摊金额');
        if (amount !== allocation.amountMinor) {
          allocation.status = 'pending';
          allocation.paidAt = '';
        }
        allocation.amountMinor = amount;
        total += amount;
        replacement.push(allocation);
      }
      if (total !== bill.amountMinor) fail('分摊金额之和必须恰好等于本期账单金额');
      if (existing.some((item) => item.status === 'paid' && !seen.has(item.memberId)))
        fail('不能移除已记录交费的分摊，请先将其改为待交费');
      draft.allocations = [
        ...draft.allocations.filter((item) => item.billId !== bill.id),
        ...replacement,
      ];
      break;
    }
    case 'settings.save':
      draft.settings = settingsSchema({ ...draft.settings, ...p });
      break;
    default:
      fail('不支持的操作');
  }
  validateRelations(draft, today);
  validateUpcomingSplits(draft, today);
  materialize(draft, today);
  draft.revision = data.revision + 1;
  Object.assign(data, validateData(draft, today));
}

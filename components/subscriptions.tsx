'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  Search,
  Plus,
  Users,
  CalendarDays,
  Pause,
  Play,
  Archive,
  Pencil,
  Upload,
  CreditCard,
  Filter,
  Check,
  Ban,
} from 'lucide-react';
import type { Bill, BusinessData, Currency, Subscription } from '@/lib/model';
import {
  nextDue,
  parseMoney,
  formatMoney,
  monthlyEquivalent,
  projectBills,
  summarizeByCurrency,
} from '@/lib/billing';
import { activeMemberships } from '@/lib/domain';
import { searchServices, type ServiceDefinition } from '@/lib/catalog';
import { convertMinor } from '@/lib/exchange';
import { CurrencyTotal } from './currency-total';
import { ServiceSearch, discoverService } from './service-search';
import {
  Act,
  Avatar,
  currencies,
  cycleLabel,
  DataProps,
  dayDiff,
  displayDate,
  Empty,
  Field,
  Logo,
  Modal,
  Money,
  monthRange,
  Notice,
  offsetDay,
  statusLabels,
  SubmitBar,
} from './shared';
export function SubscriptionView({ data, act, today, openSubscription }: DataProps) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [status, setStatus] = useState('all'),
    [kind, setKind] = useState('all'),
    [sort, setSort] = useState('date'),
    [filters, setFilters] = useState(false);
  const range = monthRange(today.slice(0, 7)),
    monthBills = projectBills(data, range.from, range.to),
    weekBills = projectBills(data, today, offsetDay(today, 6)).filter(
      (b) => b.status !== 'skipped',
    );
  const upcoming = projectBills(data, today, offsetDay(today, 365))
    .filter((b) => b.status === 'pending')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .filter(
      (bill, index, all) =>
        all.findIndex((item) => item.subscriptionId === bill.subscriptionId) === index,
    )
    .slice(0, 3);
  const overdue = data.bills.filter((b) => b.status === 'pending' && b.dueDate < today);
  const active = data.subscriptions.filter((s) => ['active', 'trial'].includes(s.status)).length;
  const subs = data.subscriptions
    .filter(
      (s) =>
        s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (category === 'all' || s.category === category) &&
        (status === 'all' ? s.status !== 'archived' : s.status === status) &&
        (kind === 'all' || s.kind === kind),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'zh')
        : sort === 'amount'
          ? (convertMinor(
              b.amountMinor,
              b.currency,
              data.settings.displayCurrency,
              data.settings.exchange,
            ) ?? -1) -
            (convertMinor(
              a.amountMinor,
              a.currency,
              data.settings.displayCurrency,
              data.settings.exchange,
            ) ?? -1)
          : (nextDue(a, today) || '9999').localeCompare(nextDue(b, today) || '9999'),
    );
  return (
    <>
      <div className="overview-grid">
        <section className="stat-card stat-primary">
          <span className="stat-label">
            本月预计支出<span>{Number(today.slice(5, 7))} 月</span>
          </span>
          <CurrencyTotal
            values={summarizeByCurrency(monthBills)}
            target={data.settings.displayCurrency}
            exchange={data.settings.exchange}
          />
          <p>按本月账期计算，含已记录付款</p>
          <CalendarDays className="stat-watermark" aria-hidden="true" />
        </section>
        <section className="stat-card">
          <span className="stat-label">
            未来 7 天续费
            <CalendarDays size={19} />
          </span>
          <div className="stat-number">
            {weekBills.length}
            <small>笔</small>
          </div>
          <CurrencyTotal
            values={summarizeByCurrency(weekBills)}
            target={data.settings.displayCurrency}
            exchange={data.settings.exchange}
            empty="这周没有计划支出"
          />
          <p>
            {today.slice(5).replace('-', '/')} — {offsetDay(today, 6).slice(5).replace('-', '/')}
          </p>
        </section>
        <section className="stat-card">
          <span className="stat-label">
            正在启用
            <CreditCard size={19} />
          </span>
          <div className="stat-number">
            {active}
            <small>项订阅</small>
          </div>
          <p className="stat-bottom">
            <span className="status-dot" />
            {data.groups.length} 个家庭组，一处管理
          </p>
        </section>
      </div>
      <div className="dashboard-columns">
        <div className="main-column">
          <div className="section-heading">
            <h2>近期续费</h2>
            <span className="muted">下一笔，提前心中有数</span>
          </div>
          {upcoming.length ? (
            <div className="upcoming-grid">
              {upcoming.map((b, i) => (
                <button
                  className={`renewal-card renewal-${i}`}
                  key={b.id}
                  style={{ '--brand': b.color } as React.CSSProperties}
                  onClick={() =>
                    openSubscription(data.subscriptions.find((s) => s.id === b.subscriptionId))
                  }
                >
                  <div className="row-between">
                    <Logo name={b.name} logo={b.logo} color={b.color} />
                    <span className="renewal-days">
                      {b.dueDate === today ? '今天' : `${dayDiff(today, b.dueDate)} 天后`}
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                  <h3>{b.name}</h3>
                  <div className="row-between">
                    <Money amount={b.amountMinor} currency={b.currency} />
                    <small>{displayDate(b.dueDate)}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="calm-empty">
              <CalendarDays size={22} />
              <span>暂无待续费计划</span>
              <span className="muted">添加订阅后，续费日期会出现在这里。</span>
            </div>
          )}
          <section className="panel subscriptions-panel">
            <div className="section-heading">
              <h2>
                全部订阅 <span className="count-pill">{subs.length}</span>
              </h2>
              <button className="text-button" onClick={() => openSubscription()}>
                <Plus size={16} />
                新增
              </button>
            </div>
            <div className="list-toolbar">
              <div className="search-field">
                <Search size={17} />
                <input
                  aria-label="搜索订阅"
                  placeholder="搜索你的订阅…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                className={`button filter-button ${filters ? 'selected' : ''}`}
                onClick={() => setFilters(!filters)}
                aria-expanded={filters}
              >
                <Filter size={16} />
                筛选
              </button>
              <select aria-label="订阅排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="date">按续费日期</option>
                <option value="amount">按折算金额</option>
                <option value="name">按名称</option>
              </select>
            </div>
            {filters && (
              <div className="filter-row">
                <select
                  aria-label="分类筛选"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">全部分类</option>
                  {Array.from(
                    new Set([
                      ...data.settings.categories,
                      ...data.subscriptions.map((item) => item.category),
                    ]),
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  aria-label="状态筛选"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">未归档状态</option>
                  {Object.entries(statusLabels)
                    .slice(0, 5)
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="类型筛选"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="all">所有类型</option>
                  <option value="personal">个人订阅</option>
                  <option value="family">家庭订阅</option>
                </select>
              </div>
            )}
            <div className="subscription-table">
              <div className="table-head">
                <span>服务 / 套餐</span>
                <span>下次续费</span>
                <span>金额 / 周期</span>
                <span />
              </div>
              {subs.length ? (
                subs.map((s) => {
                  const due = nextDue(s, today);
                  const g = data.groups.find((g) => g.subscriptionId === s.id);
                  const members = g ? activeMemberships(data, g.id, today) : [];
                  return (
                    <button
                      className="subscription-row"
                      key={s.id}
                      onClick={() => openSubscription(s)}
                    >
                      <div className="subscription-name">
                        <Logo name={s.name} logo={s.logo} color={s.color} />
                        <div>
                          <strong>{s.name}</strong>
                          <span className="sub-meta">
                            {s.plan || s.category} · {s.kind === 'family' ? '家庭' : '个人'}
                            {s.status !== 'active' && (
                              <i className={`badge ${s.status}`}>{statusLabels[s.status]}</i>
                            )}
                          </span>
                          {g && (
                            <div className="inline-members">
                              {members.slice(0, 3).map((m) => {
                                const p = data.members.find((p) => p.id === m.memberId);
                                return p ? (
                                  <Avatar key={p.id} seed={p.seed} name={p.nickname} size={20} />
                                ) : null;
                              })}
                              <small>
                                {members.length} / {g.seats} 席
                              </small>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="next-date">
                        <span>{due ? displayDate(due) : '暂无计划'}</span>
                        <small>
                          {due
                            ? due === today
                              ? '今天续费'
                              : `${dayDiff(today, due)} 天后`
                            : statusLabels[s.status]}
                        </small>
                      </div>
                      <div className="subscription-price">
                        <Money amount={s.amountMinor} currency={s.currency} />
                        <small>{cycleLabel(s)}</small>
                      </div>
                      <ChevronRight className="row-chevron" size={17} />
                    </button>
                  );
                })
              ) : (
                <Empty
                  title={data.subscriptions.length ? '没有找到匹配的订阅' : '从第一份订阅开始'}
                  description={
                    data.subscriptions.length
                      ? '试试其他关键词或筛选条件。'
                      : '音乐、云存储或喜欢的视频服务，都可以记录在这里。'
                  }
                  action={data.subscriptions.length ? undefined : () => openSubscription()}
                />
              )}
            </div>
          </section>
        </div>
        <aside className="right-column">
          <section className="panel reminders-panel">
            <div className="section-heading">
              <h3>待办提醒</h3>
              <span className="count-pill">{overdue.length}</span>
            </div>
            {overdue.length ? (
              <>
                <p className="muted small">日期已过，付款还没有确认。</p>
                {overdue.slice(0, 5).map((b) => (
                  <div className="reminder" key={b.id}>
                    <Logo name={b.name} logo={b.logo} color={b.color} size={34} />
                    <div>
                      <strong>{b.name}</strong>
                      <small>
                        {displayDate(b.dueDate)} · {formatMoney(b.amountMinor, b.currency)}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      title="查看账单"
                      aria-label={`查看${b.name}账单`}
                      onClick={() =>
                        openSubscription(data.subscriptions.find((s) => s.id === b.subscriptionId))
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="quiet-state">
                <span>
                  <Check size={21} />
                </span>
                <p>没有待确认的旧账单</p>
                <small>到期只会提醒，付款由你确认。</small>
              </div>
            )}
          </section>
          <section className="panel family-summary">
            <div className="section-heading">
              <h3>一起共享</h3>
              <Users size={18} />
            </div>
            {data.groups.length ? (
              data.groups.slice(0, 3).map((g) => {
                const s = data.subscriptions.find((s) => s.id === g.subscriptionId)!;
                const count = activeMemberships(data, g.id, today).length;
                return (
                  <button className="family-mini" key={g.id} onClick={() => openSubscription(s)}>
                    <div className="row-between">
                      <strong>{g.name}</strong>
                      <span>
                        {count} / {g.seats}
                      </span>
                    </div>
                    <div className="seat-line">
                      <i style={{ width: `${(count / g.seats) * 100}%`, background: s.color }} />
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="muted small">把订阅设为家庭类型，即可管理成员和费用分摊。</p>
            )}
          </section>
          <p className="aside-note">
            总额按 {data.settings.displayCurrency} 折算，单笔保留原币种。
            <br />
            仅记录费用，不会自动扣款。
          </p>
        </aside>
      </div>
    </>
  );
}
export function SubscriptionEditor({
  subscription,
  data,
  act,
  today,
  onClose,
}: {
  subscription?: Subscription;
  data: BusinessData;
  act: Act;
  today: string;
  onClose: () => void;
}) {
  const [s, setS] = useState<any>(
    subscription
      ? {
          ...subscription,
          amount: String(
            subscription.amountMinor /
              10 ** ({ JPY: 0, KRW: 0, KWD: 3 }[subscription.currency as 'JPY'] ?? 2),
          ),
        }
      : {
          name: '',
          serviceId: 'custom',
          logo: '',
          color: '#6252da',
          category: data.settings.categories[0] || '其他',
          plan: '',
          kind: 'personal',
          amount: '',
          currency: data.settings.displayCurrency,
          interval: 1,
          unit: 'month',
          anchorDate: today,
          billingStart: today,
          trialEnd: '',
          autoRenew: true,
          status: 'active',
          stopDate: '',
          notes: '',
          website: '',
        },
  );
  const [term, setTerm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [picked, setPicked] = useState(!!subscription),
    [uploading, setUploading] = useState(false),
    [logoError, setLogoError] = useState(''),
    [logoBusy, setLogoBusy] = useState(false),
    [logoMessage, setLogoMessage] = useState('');
  const matches = searchServices(term);
  const logoRequest = useRef<AbortController | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const manualLogo = useRef(false);
  useEffect(() => () => logoRequest.current?.abort(), []);
  function cancelLogoLookup() {
    logoRequest.current?.abort();
    logoRequest.current = null;
    setLogoBusy(false);
    setLogoMessage('');
  }
  function pickService(c: ServiceDefinition) {
    cancelLogoLookup();
    manualLogo.current = false;
    setLogoError('');
    setS((old: any) => ({
      ...old,
      name: c.name,
      serviceId: c.id,
      logo: c.logo,
      color: c.color,
      category: c.category,
      website: c.website,
    }));
    setPicked(true);
    setLogoMessage('');
  }
  async function findLogo(query: string) {
    if (!query.trim() || logoBusy) return;
    const request = new AbortController();
    logoRequest.current = request;
    setLogoBusy(true);
    setLogoError('');
    setLogoMessage('');
    try {
      const result = await discoverService(query.trim(), request.signal);
      if (request.signal.aborted) return;
      setS((old: any) => ({
        ...old,
        logo: result.service.logo,
        name: old.name || result.service.name,
        website: old.website || result.service.website,
      }));
      setLogoMessage(`已获取图标 · ${result.sourceLabel}`);
    } catch (e) {
      if (!request.signal.aborted) setLogoMessage((e as Error).message);
    } finally {
      if (logoRequest.current === request) {
        logoRequest.current = null;
        setLogoBusy(false);
      }
    }
  }
  function set(key: string, value: any) {
    if (['name', 'website', 'logo'].includes(key)) cancelLogoLookup();
    setS((old: any) => ({ ...old, [key]: value }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || logoBusy) return;
    setBusy(true);
    setError('');
    try {
      const { amount, ...payload } = s;
      await act('subscription.save', { ...payload, amountMinor: parseMoney(amount, s.currency) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    cancelLogoLookup();
    setLogoError('');
    if (file.size === 0 || file.size > 2 * 1024 * 1024) {
      setLogoError('请选择 2 MB 以内的图片。');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('支持 PNG、JPEG 和 WebP 图片。');
      return;
    }
    manualLogo.current = true;
    setUploading(true);
    setBusy(true);
    try {
      const f = new FormData();
      f.append('file', file);
      const r = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'X-Requested-With': 'subscribo' },
        body: f,
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || 'Logo 上传失败，请重试。');
      set('logo', j.url);
      setLogoMessage('Logo 已上传，保存订阅后生效。');
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={subscription ? '编辑订阅' : '添加一份订阅'}
      description={
        subscription
          ? '价格变更用于未生成账期；日期与周期变更最早从明日起生效，历史保留。'
          : '选择常用服务，或记录你自己的订阅。'
      }
    >
      {!picked ? (
        <>
          <div className="search-field picker-search">
            <Search size={18} />
            <input
              placeholder="输入应用名称或官网，如 ChatGPT、Claude…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              aria-label="搜索常用服务"
            />
          </div>
          <div className="service-picker">
            {matches.map((c) => (
              <button key={c.id} onClick={() => pickService(c)}>
                <Logo name={c.name} logo={c.logo} color={c.color} />
                <span>{c.name}</span>
                <Plus size={16} />
              </button>
            ))}
          </div>
          <ServiceSearch query={term} enabled={matches.length === 0} onPick={pickService} />
          <button
            className="button custom-service"
            onClick={() => {
              set('name', /^https?:\/\//i.test(term) ? '' : term);
              if (/^https?:\/\//i.test(term)) set('website', term);
              setPicked(true);
            }}
          >
            <Plus size={18} />
            创建自定义服务
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="form-stack">
          <div className="selected-service">
            <Logo name={s.name || '自定'} logo={s.logo} color={s.color} size={54} />
            <div>
              <strong>{s.name || '自定义服务'}</strong>
              <span>价格与套餐请按你的实际订阅填写</span>
            </div>
            {!subscription && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  cancelLogoLookup();
                  setPicked(false);
                }}
              >
                更换
              </button>
            )}
          </div>
          <div className="subscription-logo-upload">
            <input
              ref={logoInput}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              aria-label="上传订阅 Logo"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void upload(file);
              }}
            />
            <div className="subscription-logo-actions">
              <button
                type="button"
                className="button logo-upload-button"
                disabled={busy}
                onClick={() => logoInput.current?.click()}
              >
                <Upload size={16} />
                {uploading ? '正在上传…' : '上传 Logo'}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy || logoBusy || (!s.website && !s.name)}
                onClick={() => findLogo(s.website || s.name)}
              >
                {logoBusy ? '正在获取…' : '自动获取图标'}
              </button>
              {s.logo && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    manualLogo.current = true;
                    set('logo', '');
                    setLogoError('');
                    setLogoMessage('Logo 已移除，保存订阅后生效。');
                  }}
                >
                  移除 Logo
                </button>
              )}
            </div>
            <p className="field-hint">
              PNG / JPG / WebP，最大 2 MB。图片会显示在上方，保存订阅后生效。
            </p>
            {logoMessage && (
              <p className="field-hint" role="status">
                {logoMessage}
              </p>
            )}
            {logoError && (
              <p className="form-error" role="alert">
                {logoError}
              </p>
            )}
          </div>
          <div className="form-grid">
            <Field label="服务名称">
              <input
                required
                maxLength={80}
                value={s.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => {
                  if (!manualLogo.current && !s.logo && !s.website) void findLogo(s.name);
                }}
              />
            </Field>
            <Field label="套餐名称（可选）">
              <input
                maxLength={120}
                placeholder="例如：Premium"
                value={s.plan}
                onChange={(e) => set('plan', e.target.value)}
              />
            </Field>
            <Field label="订阅类型">
              <select value={s.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="personal">个人订阅</option>
                <option value="family">家庭订阅</option>
              </select>
            </Field>
            <Field label="分类">
              <select value={s.category} onChange={(e) => set('category', e.target.value)}>
                {Array.from(new Set([...data.settings.categories, s.category])).map((c) => (
                  <option key={String(c)}>{String(c)}</option>
                ))}
              </select>
            </Field>
            <Field label="每个账期总金额">
              <input
                inputMode="decimal"
                required
                value={s.amount}
                placeholder="0.00"
                onChange={(e) => set('amount', e.target.value)}
              />
            </Field>
            <Field label="币种">
              <select value={s.currency} onChange={(e) => set('currency', e.target.value)}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="周期数量">
              <input
                type="number"
                required
                min="1"
                max="366"
                value={s.interval}
                onChange={(e) => set('interval', Number(e.target.value))}
              />
            </Field>
            <Field label="周期单位">
              <select value={s.unit} onChange={(e) => set('unit', e.target.value)}>
                <option value="day">天</option>
                <option value="week">周</option>
                <option value="month">月</option>
                <option value="year">年</option>
              </select>
            </Field>
            <Field
              label="计费锚点日期"
              hint="月底日期会保留原始日号；季度选 3 个月，半年选 6 个月。"
            >
              <input
                type="date"
                required
                value={s.anchorDate}
                onChange={(e) => set('anchorDate', e.target.value)}
              />
            </Field>
            <Field label="从哪天开始记录账单" hint="早于此日期的周期不会生成账单。">
              <input
                type="date"
                required
                value={s.billingStart}
                onChange={(e) => set('billingStart', e.target.value)}
              />
            </Field>
            <Field label="试用截止（可选）">
              <input
                type="date"
                value={s.trialEnd}
                onChange={(e) => {
                  set('trialEnd', e.target.value);
                  if (e.target.value) set('status', 'trial');
                }}
              />
            </Field>
            <Field label="状态">
              <select value={s.status} onChange={(e) => set('status', e.target.value)}>
                {['active', 'trial', 'paused', 'cancelled', 'archived'].map((v) => (
                  <option key={v} value={v}>
                    {statusLabels[v]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={s.autoRenew}
              onChange={(e) => set('autoRenew', e.target.checked)}
            />
            自动续费
          </label>
          <Field
            label="权益截止 / 停止续费生效日（可选）"
            hint="该日期起不再计划扣费。已记录账单会保留。"
          >
            <input
              type="date"
              value={s.stopDate}
              onChange={(e) => set('stopDate', e.target.value)}
            />
          </Field>
          {s.kind === 'family' && (
            <Notice>
              保存后会建立关联家庭组。在「家庭组」中设置席位、组长和分摊规则；成员档案不会获得网站登录权限。
            </Notice>
          )}
          <Field label="官网或管理链接（可选）">
            <input
              type="url"
              placeholder="https://"
              value={s.website}
              onChange={(e) => set('website', e.target.value)}
              onBlur={() => {
                if (!manualLogo.current && s.website && !s.logo) void findLogo(s.website);
              }}
            />
          </Field>
          <Field label="品牌色">
            <input type="color" value={s.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="备注">
            <textarea
              maxLength={2000}
              value={s.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <SubmitBar
            busy={busy || logoBusy}
            onCancel={onClose}
            label={subscription ? '保存修改' : '添加订阅'}
          />
        </form>
      )}
    </Modal>
  );
}
export function BillRow({
  bill,
  act,
  today,
  compact = false,
}: {
  bill: Bill;
  act: Act;
  today: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function mark(status: string) {
    setBusy(true);
    try {
      await act('bill.status', {
        subscriptionId: bill.subscriptionId,
        dueDate: bill.dueDate,
        status,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`bill-row ${compact ? 'compact' : ''}`}>
      <div className="bill-info">
        <Logo name={bill.name} logo={bill.logo} color={bill.color} size={36} />
        <div>
          <strong>{bill.name}</strong>
          <small>
            {bill.dueDate} ·{' '}
            <span
              className={bill.status === 'pending' && bill.dueDate < today ? 'text-danger' : ''}
            >
              {bill.status === 'pending' && bill.dueDate < today
                ? '逾期待确认'
                : statusLabels[bill.status]}
            </span>
          </small>
        </div>
        <Money amount={bill.amountMinor} currency={bill.currency} />
      </div>
      <div className="bill-actions">
        {bill.status !== 'paid' && (
          <button className="button small-button" disabled={busy} onClick={() => mark('paid')}>
            <Check size={14} />
            记录付款
          </button>
        )}
        {bill.status === 'pending' && (
          <button className="text-button muted" disabled={busy} onClick={() => mark('skipped')}>
            跳过
          </button>
        )}
        {bill.status !== 'pending' && (
          <button className="text-button muted" disabled={busy} onClick={() => mark('pending')}>
            改为待确认
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
export function SubscriptionDetail({
  subscription: s,
  data,
  act,
  today,
  onClose,
  onEdit,
}: {
  subscription: Subscription;
  data: BusinessData;
  act: Act;
  today: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const due = nextDue(s, today);
  const bills = projectBills(data, offsetDay(today, -365), offsetDay(today, 90))
    .filter((b) => b.subscriptionId === s.id)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [resume, setResume] = useState(false),
    [date, setDate] = useState(today);
  async function status(v: string) {
    setBusy(true);
    try {
      await act('subscription.status', { id: s.id, status: v, resumeDate: date });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="订阅详情">
      <div className="detail-brand" style={{ '--brand': s.color } as React.CSSProperties}>
        <Logo name={s.name} logo={s.logo} color={s.color} size={64} />
        <h2>{s.name}</h2>
        <p>
          {s.plan || s.category} · {s.kind === 'family' ? '家庭订阅' : '个人订阅'}
        </p>
        <Money amount={s.amountMinor} currency={s.currency} />
        <span>{cycleLabel(s)}</span>
      </div>
      <div className="detail-meta">
        <div>
          <span>下一次预计扣费</span>
          <strong>{due || '暂无计划'}</strong>
        </div>
        <div>
          <span>当前状态</span>
          <strong>{statusLabels[s.status]}</strong>
        </div>
        <div>
          <span>月均折算（估算）</span>
          <strong>{formatMoney(Math.round(monthlyEquivalent(s)), s.currency)} / 月</strong>
        </div>
        <div>
          <span>自动续费</span>
          <strong>{s.autoRenew ? '开启' : '关闭'}</strong>
        </div>
        {s.stopDate && (
          <div>
            <span>权益截止</span>
            <strong>{s.stopDate}</strong>
          </div>
        )}
        {s.trialEnd && (
          <div>
            <span>试用截止</span>
            <strong>{s.trialEnd}</strong>
          </div>
        )}
      </div>
      <Notice>月均折算便于比较，不代表每月实际扣款。记录付款仅用于记账，不会向第三方付款。</Notice>
      <div className="detail-actions">
        <button className="button" onClick={onEdit}>
          <Pencil size={15} />
          编辑
        </button>
        {['paused', 'archived', 'cancelled'].includes(s.status) ? (
          <button className="button" onClick={() => setResume(!resume)}>
            <Play size={15} />
            恢复
          </button>
        ) : (
          <>
            <button className="button" disabled={busy} onClick={() => status('paused')}>
              <Pause size={15} />
              暂停
            </button>
            <button className="button" disabled={busy} onClick={() => status('cancelled')}>
              <Ban size={15} />
              停止续费
            </button>
          </>
        )}
        {s.status !== 'archived' && (
          <button className="button" disabled={busy} onClick={() => status('archived')}>
            <Archive size={15} />
            归档
          </button>
        )}
        {s.website && (
          <a className="button" target="_blank" rel="noopener noreferrer" href={s.website}>
            <ArrowUpRight size={15} />
            服务官网
          </a>
        )}
      </div>
      {resume && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            status('active');
          }}
        >
          <Field label="恢复后的首次扣费日">
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <button className="button primary" disabled={busy}>
            确认恢复
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
      {s.notes && <p className="notes">{s.notes}</p>}
      <div className="section-heading">
        <h3>账期与付款记录</h3>
        <span className="muted small">近一年与未来 90 天</span>
      </div>
      {bills.length ? (
        bills.map((b) => <BillRow key={b.id} bill={b} act={act} today={today} />)
      ) : (
        <p className="muted">暂无账单记录</p>
      )}
    </Modal>
  );
}

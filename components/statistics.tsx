'use client';
import { useState } from 'react';
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Download,
} from 'lucide-react';
import type { Currency } from '@/lib/model';
import { projectBills, summarizeByCurrency, formatMoney } from '@/lib/billing';
import { convertTotal } from '@/lib/exchange';
import { CurrencyTotal } from './currency-total';
import { DataProps, Empty, Logo, Money, monthRange, offsetDay, shiftMonth } from './shared';
import { BillRow } from './subscriptions';
export default function Statistics({ data, act, today, openSubscription }: DataProps) {
  const [view, setView] = useState('calendar'),
    [month, setMonth] = useState(today.slice(0, 7)),
    [day, setDay] = useState(today),
    [currency, setCurrency] = useState<Currency>(data.settings.displayCurrency);
  const { from, to } = monthRange(month);
  const bills = projectBills(data, from, to);
  const daily = bills.filter((b) => b.dueDate === day);
  const allCurrencies = Array.from(
    new Set([
      data.settings.displayCurrency,
      ...data.subscriptions.map((s) => s.currency),
      ...data.bills.map((b) => b.currency),
    ]),
  );
  const firstWeekDay = (new Date(from + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((firstWeekDay + Number(to.slice(8))) / 7) * 7;
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const totals = months.map((m) => {
    const r = monthRange(m);
    return convertTotal(
      summarizeByCurrency(projectBills(data, r.from, r.to)),
      currency,
      data.settings.exchange,
    ).amountMinor;
  });
  const max = Math.max(1, ...totals.map((value) => value ?? 0));
  const relevant = bills.filter((b) => b.status !== 'skipped');
  const monthTotal = convertTotal(summarizeByCurrency(relevant), currency, data.settings.exchange);
  const sum = monthTotal.amountMinor || 0;
  function grouped(field: 'category' | 'subscriptionId'): [string, number][] {
    if (monthTotal.amountMinor === null) return [];
    const groups = new Map<string, typeof relevant>();
    for (const bill of relevant)
      groups.set(bill[field], [...(groups.get(bill[field]) || []), bill]);
    return [...groups]
      .map(([name, rows]): [string, number] => [
        name,
        convertTotal(summarizeByCurrency(rows), currency, data.settings.exchange).amountMinor || 0,
      ])
      .sort((a, b) => b[1] - a[1]);
  }
  const cats = grouped('category');
  const sources = grouped('subscriptionId');
  function changeMonth(m: string) {
    setMonth(m);
    setDay(m + '-01');
  }
  return (
    <>
      <div className="statistics-toolbar">
        <div className="segmented">
          <button
            className={view === 'calendar' ? 'active' : ''}
            onClick={() => setView('calendar')}
          >
            <CalendarDays size={17} />
            扣费日历
          </button>
          <button className={view === 'trend' ? 'active' : ''} onClick={() => setView('trend')}>
            <ChartNoAxesCombined size={17} />
            支出趋势
          </button>
        </div>
        <a className="button" href="/api/export?format=ics">
          <Download size={16} />
          导出日历
        </a>
      </div>
      <div className="month-overview">
        <div>
          <span className="eyebrow">{month.slice(0, 4)} · YOUR SPENDING</span>
          <h2>{Number(month.slice(5))} 月，订阅一览</h2>
          <p>
            {bills.filter((b) => b.status !== 'skipped').length} 笔计划扣费 ·
            含已记录付款，跳过不计入
          </p>
        </div>
        <CurrencyTotal
          values={summarizeByCurrency(bills)}
          target={currency}
          exchange={data.settings.exchange}
        />
      </div>
      <div className="month-navigation">
        <button
          className="icon-button"
          aria-label="上个月"
          onClick={() => changeMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <strong>
          {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
        </strong>
        <button
          className="icon-button"
          aria-label="下个月"
          onClick={() => changeMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={20} />
        </button>
        <button
          className="text-button"
          onClick={() => {
            setMonth(today.slice(0, 7));
            setDay(today);
          }}
        >
          回到今天
        </button>
        {view === 'trend' && (
          <select
            className="currency-picker"
            aria-label="统计折算币种"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            {allCurrencies.map((c) => (
              <option key={c} value={c}>
                折算 {c}
              </option>
            ))}
          </select>
        )}
      </div>
      {view === 'calendar' ? (
        <div className="calendar-layout">
          <section className="panel calendar-panel">
            <div className="calendar-week">
              {['一', '二', '三', '四', '五', '六', '日'].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: cellCount }, (_, i) => {
                const d = offsetDay(from, i - firstWeekDay),
                  events = bills.filter((b) => b.dueDate === d);
                return (
                  <button
                    key={d}
                    className={`calendar-cell ${d.slice(0, 7) !== month ? 'outside' : ''} ${d === today ? 'today' : ''} ${d === day ? 'selected' : ''}`}
                    aria-label={`${d}，${events.length} 笔账单`}
                    onClick={() => {
                      if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7));
                      setDay(d);
                    }}
                  >
                    <span className="date-number">{Number(d.slice(8))}</span>
                    <div className="calendar-logos">
                      {events.slice(0, 2).map((e) => (
                        <Logo key={e.id} name={e.name} logo={e.logo} color={e.color} size={25} />
                      ))}
                      {events.length > 2 && (
                        <span className="calendar-more">+{events.length - 2}</span>
                      )}
                    </div>
                    {events.length > 0 && <span className="event-dot" />}
                  </button>
                );
              })}
            </div>
            <p className="calendar-caption">
              日期按 {data.settings.timezone} 显示 · 到期不代表已经扣款
            </p>
          </section>
          <aside className="panel day-details">
            <div className="section-heading">
              <h3>
                {Number(day.slice(5, 7))} 月 {Number(day.slice(8))} 日
              </h3>
              <span className="count-pill">{daily.length} 笔</span>
            </div>
            {daily.length ? (
              daily.map((b) => (
                <div key={b.id}>
                  <BillRow bill={b} act={act} today={today} compact />
                  <button
                    className="text-button day-detail-link"
                    onClick={() =>
                      openSubscription(data.subscriptions.find((s) => s.id === b.subscriptionId))
                    }
                  >
                    订阅详情
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              ))
            ) : (
              <Empty title="这一天没有扣费" description="换个日期看看，或享受今天的轻松。" />
            )}
          </aside>
        </div>
      ) : (
        <div className="trend-grid">
          <section className="panel trend-main">
            <div className="section-heading">
              <h3>最近六个月的计划支出</h3>
              <span className="badge">统一折算 {currency}</span>
            </div>
            <div className="bar-chart">
              {months.map((m, i) => (
                <div className="chart-column" key={m}>
                  <span>{totals[i] === null ? '缺少汇率' : formatMoney(totals[i]!, currency)}</span>
                  <div className="bar-track">
                    <i
                      style={{
                        height: totals[i] ? Math.max(3, (totals[i]! / max) * 100) + '%' : '0%',
                        background: i === 5 ? 'var(--accent)' : 'var(--accent-soft)',
                      }}
                    />
                  </div>
                  <small>{Number(m.slice(5))}月</small>
                </div>
              ))}
            </div>
            <p className="muted small">
              按各月账期合计，使用当前保存的汇率折算。年付计入续费月份；折算金额可能与实际扣款不同。
            </p>
          </section>
          <section className="panel category-panel">
            <h3>本月分类占比</h3>
            {cats.length ? (
              cats.map(([cat, amount], i) => (
                <div className="category-stat" key={cat}>
                  <div className="row-between">
                    <span>
                      <i
                        style={{
                          background: ['#7061df', '#70b99e', '#dfb064', '#729ccf', '#c783a5'][
                            i % 5
                          ],
                        }}
                      />
                      {cat}
                    </span>
                    <strong>{sum ? Math.round((amount / sum) * 100) : 0}%</strong>
                  </div>
                  <div className="seat-line">
                    <i
                      style={{
                        width: (sum ? (amount / sum) * 100 : 0) + '%',
                        background: ['#7061df', '#70b99e', '#dfb064', '#729ccf', '#c783a5'][i % 5],
                      }}
                    />
                  </div>
                  <small>{formatMoney(amount, currency)}</small>
                </div>
              ))
            ) : (
              <p className="muted">
                {monthTotal.amountMinor === null
                  ? '补齐汇率后显示分类占比。'
                  : '本月暂无计划支出。'}
              </p>
            )}
          </section>
          <section className="panel sources-panel">
            <h3>主要支出来源</h3>
            {sources.length ? (
              sources.map(([id, amount]) => {
                const snapshot = relevant.find((b) => b.subscriptionId === id)!;
                return (
                  <button
                    className="source-row"
                    key={id}
                    onClick={() => openSubscription(data.subscriptions.find((s) => s.id === id))}
                  >
                    <Logo name={snapshot.name} logo={snapshot.logo} color={snapshot.color} />
                    <span>{snapshot.name}</span>
                    <Money amount={amount} currency={currency} />
                    <ChevronRight size={16} />
                  </button>
                );
              })
            ) : (
              <p className="muted">
                {monthTotal.amountMinor === null ? '补齐汇率后显示支出来源。' : '暂无记录。'}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

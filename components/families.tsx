'use client';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Users,
  Pencil,
  Shuffle,
  Check,
  UserMinus,
  Wallet,
  ChevronRight,
} from 'lucide-react';
import type { Bill, FamilyGroup, Member, Membership } from '@/lib/model';
import { formatMoney, nextDue, parseMoney, projectBills } from '@/lib/billing';
import { activeMemberships, splitAmounts } from '@/lib/domain';
import {
  Act,
  Avatar,
  cycleLabel,
  DataProps,
  Empty,
  Field,
  Logo,
  Modal,
  Money,
  Notice,
  offsetDay,
  SubmitBar,
} from './shared';
import { BillRow } from './subscriptions';
export default function Families(props: DataProps) {
  const { data, act, today, openSubscription } = props;
  const [selected, setSelected] = useState<string | null>(null),
    [edit, setEdit] = useState(false),
    [adding, setAdding] = useState(false),
    [memberEdit, setMemberEdit] = useState<Membership | null>(null),
    [error, setError] = useState(''),
    [adjust, setAdjust] = useState<Bill | null>(null),
    [billId, setBillId] = useState('');
  const group = data.groups.find((g) => g.id === selected),
    sub = data.subscriptions.find((s) => s.id === group?.subscriptionId);
  async function action(type: string, payload: any) {
    setError('');
    try {
      await act(type, payload);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!group || !sub)
    return (
      <>
        <div className="page-description">
          <div>
            <h2>一起分享，各自清楚</h2>
            <p>管理家庭席位、成员与每个账期的费用分摊。</p>
          </div>
          <button className="button primary" onClick={() => openSubscription()}>
            <Plus size={17} />
            新增订阅
          </button>
        </div>
        {data.groups.length ? (
          <div className="family-grid">
            {data.groups.map((g) => {
              const s = data.subscriptions.find((s) => s.id === g.subscriptionId)!;
              const members = activeMemberships(data, g.id, today);
              return (
                <button
                  key={g.id}
                  className="family-card"
                  onClick={() => {
                    setSelected(g.id);
                    setBillId('');
                  }}
                >
                  <div
                    className="family-card-top"
                    style={{ '--brand': s.color } as React.CSSProperties}
                  >
                    <Logo name={s.name} logo={s.logo} color={s.color} size={54} />
                    <span className="badge">
                      {members.length} / {g.seats} 席
                    </span>
                    <h3>{g.name}</h3>
                    <p>
                      {s.name} · {s.plan || '家庭套餐'}
                    </p>
                  </div>
                  <div className="family-card-bottom">
                    <div className="row-between">
                      <div>
                        <Money amount={s.amountMinor} currency={s.currency} />
                        <small> / {cycleLabel(s)}</small>
                      </div>
                      <ChevronRight size={18} />
                    </div>
                    <div className="member-stack">
                      {members.slice(0, 6).map((m) => {
                        const p = data.members.find((p) => p.id === m.memberId)!;
                        return <Avatar key={p.id} seed={p.seed} name={p.nickname} />;
                      })}
                      {members.length === 0 && (
                        <span className="muted small">还没有成员，邀请生活里的伙伴</span>
                      )}
                    </div>
                    <div className="seat-line">
                      <i
                        style={{
                          width: (members.length / g.seats) * 100 + '%',
                          background: s.color,
                        }}
                      />
                    </div>
                    <div className="row-between muted small">
                      <span>{g.seats - members.length} 个空余席位</span>
                      <span>{nextDue(s, today) || '暂无计划'} 续费</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <section className="panel">
            <Empty
              title="为共享订阅留一个家"
              description="新增家庭类型的订阅后，就可以添加成员、设置席位与分摊规则。"
              label="添加订阅"
              action={() => openSubscription()}
            />
          </section>
        )}
        <Notice>
          成员是站内档案，不是网站账号；这里不会连接第三方平台的家庭组，也不会实际收款。
        </Notice>
      </>
    );
  const memberships = data.memberships
    .filter((m) => m.groupId === group.id)
    .sort(
      (a, b) =>
        a.joinedAt.localeCompare(b.joinedAt) ||
        (data.members.find((m) => m.id === a.memberId)?.nickname || '').localeCompare(
          data.members.find((m) => m.id === b.memberId)?.nickname || '',
          'zh-CN',
        ),
    );
  const active = activeMemberships(data, group.id, today),
    next = nextDue(
      sub,
      data.bills.some((b) => b.subscriptionId === sub.id && b.dueDate === today)
        ? offsetDay(today, 1)
        : today,
    );
  let preview: ReturnType<typeof splitAmounts> = [];
  let splitError = '';
  try {
    preview = splitAmounts(data, group, sub.amountMinor, next || today);
  } catch (e) {
    splitError = (e as Error).message;
  }
  const bills = data.bills
    .filter((b) => b.subscriptionId === sub.id)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const bill =
    bills.find((b) => b.id === billId) || bills.find((b) => b.dueDate <= today) || bills[0];
  const allocations = data.allocations
    .filter((a) => a.billId === bill?.id)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-CN'));
  const received = allocations
    .filter((a) => a.status === 'paid')
    .reduce((n, a) => n + a.amountMinor, 0);
  return (
    <>
      <button className="text-button back-button" onClick={() => setSelected(null)}>
        <ArrowLeft size={17} />
        所有家庭组
      </button>
      <section
        className="family-detail-head"
        style={{ '--brand': sub.color } as React.CSSProperties}
      >
        <Logo name={sub.name} logo={sub.logo} color={sub.color} size={66} />
        <div>
          <span className="eyebrow">FAMILY SPACE</span>
          <h2>{group.name}</h2>
          <p>
            {sub.name} · {sub.plan || '家庭套餐'}
          </p>
        </div>
        <div className="family-head-price">
          <Money amount={sub.amountMinor} currency={sub.currency} />
          <span>
            {cycleLabel(sub)} · 下次 {next || '暂无计划'}
          </span>
        </div>
        <button className="button" onClick={() => setEdit(true)}>
          <Pencil size={16} />
          编辑家庭组
        </button>
      </section>
      <div className="family-detail-columns">
        <section className="panel">
          <div className="section-heading">
            <h2>
              家庭成员{' '}
              <span className="count-pill">
                {active.length} / {group.seats}
              </span>
            </h2>
            <button
              className="button primary"
              onClick={() => setAdding(true)}
              disabled={active.length >= group.seats}
            >
              <Plus size={16} />
              添加成员
            </button>
          </div>
          {active.length >= group.seats && (
            <Notice>席位已满。请调整总席位或移除已退出的成员后再添加。</Notice>
          )}
          <p className="muted small">成员与规则变更作用于之后生成的账期，本期可单独调整。</p>
          {memberships.length ? (
            <div className="member-list">
              {memberships.map((m) => {
                const p = data.members.find((p) => p.id === m.memberId)!;
                return (
                  <div key={m.id} className={`member-row ${m.leftAt ? 'inactive' : ''}`}>
                    <Avatar seed={p.seed} name={p.nickname} size={46} />
                    <div className="member-description">
                      <strong>
                        {p.nickname}
                        {m.role === 'leader' && <span className="badge">组长</span>}
                        {m.leftAt && <span className="badge">已退出</span>}
                      </strong>
                      <span>
                        {m.joinedAt} 加入{m.expiresAt ? ` · 使用至 ${m.expiresAt}` : ''}
                      </span>
                      {p.contact && <small>{p.contact}</small>}
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`编辑成员${p.nickname}`}
                      onClick={() => setMemberEdit(m)}
                    >
                      <Pencil size={17} />
                    </button>
                    {!m.leftAt && (
                      <button
                        className="icon-button text-danger"
                        aria-label={`移除成员${p.nickname}`}
                        onClick={() => {
                          if (
                            confirm(
                              `将「${p.nickname}」标记为已退出？会释放后续席位，保留历史分摊记录。`,
                            )
                          )
                            action('membership.remove', { id: m.id });
                        }}
                      >
                        <UserMinus size={17} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              title="第一位伙伴，从昵称开始"
              description="随机头像会跟随成员保存，在每台设备上保持一致。"
              label="添加成员"
              action={() => setAdding(true)}
            />
          )}
          <div className="section-heading spaced">
            <h3>下期分摊预览</h3>
            <span className="badge">
              {{ none: '不记录分摊', equal: '均摊', custom: '自定义金额' }[group.splitMode]}
            </span>
          </div>
          {splitError ? (
            <p className="form-error">{splitError}</p>
          ) : group.splitMode === 'none' ? (
            <p className="muted small">仅管理成员和席位，不记录成员费用。</p>
          ) : (
            <>
              {preview.map((p) => {
                const memberId = p.membership.memberId;
                const m = data.members.find((m) => m.id === memberId);
                return (
                  <div className="split-preview" key={memberId}>
                    <span>
                      {m?.nickname}
                      {memberId === group.leaderId && <small> · 负责人（含余款）</small>}
                    </span>
                    <Money amount={p.amountMinor} currency={sub.currency} />
                  </div>
                );
              })}
              <Notice>
                这是预计应付，不是已收到的钱。总计 {formatMoney(sub.amountMinor, sub.currency)}
                ；零头按最小货币单位分配。
              </Notice>
            </>
          )}
          {group.notes && <p className="notes">{group.notes}</p>}
        </section>
        <section className="panel period-panel">
          <div className="section-heading">
            <h2>账期与交费</h2>
            <Wallet size={19} />
          </div>
          {bills.length ? (
            <>
              <label className="period-picker">
                选择账期
                <select
                  aria-label="选择家庭账期"
                  value={bill?.id || ''}
                  onChange={(e) => setBillId(e.target.value)}
                >
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.dueDate} · {formatMoney(b.amountMinor, b.currency)}
                    </option>
                  ))}
                </select>
              </label>
              {bill && (
                <>
                  <BillRow bill={bill} act={act} today={today} compact />
                  <div className="received-box">
                    <span>本期已记录成员交费</span>
                    <Money amount={received} currency={bill.currency} />
                    <small>套餐总支出只计算一次</small>
                  </div>
                  {allocations.map((a) => (
                    <div className="allocation-row" key={a.id}>
                      <Avatar seed={a.seed} name={a.nickname} size={34} />
                      <div>
                        <strong>{a.nickname}</strong>
                        <small>{formatMoney(a.amountMinor, bill.currency)}</small>
                      </div>
                      <button
                        className={`button small-button ${a.status === 'paid' ? 'paid-button' : ''}`}
                        onClick={() =>
                          action('allocation.pay', {
                            id: a.id,
                            status: a.status === 'paid' ? 'pending' : 'paid',
                          })
                        }
                      >
                        {a.status === 'paid' ? (
                          <>
                            <Check size={14} />
                            已记录交费
                          </>
                        ) : (
                          '记录交费'
                        )}
                      </button>
                    </div>
                  ))}
                  {!allocations.length && (
                    <p className="muted small">本账期尚无成员分摊，可手动设置本期应付。</p>
                  )}
                  <button className="text-button" onClick={() => setAdjust(bill)}>
                    调整本期分摊
                    <ArrowRight size={14} />
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="muted">尚未生成到期账单。</p>
          )}
          {next && (
            <button
              className="button next-period-button"
              onClick={() =>
                action('bill.status', { subscriptionId: sub.id, dueDate: next, status: 'pending' })
              }
            >
              生成 {next} 的账期记录
            </button>
          )}
          <Notice>
            生成后保存当期价格与成员快照。后续变更不会改写该账期；本期调整需要手动保存。
          </Notice>
        </section>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {edit && (
        <GroupEditor
          group={group}
          members={data.members.filter((m) => active.some((a) => a.memberId === m.id))}
          act={act}
          onClose={() => setEdit(false)}
        />
      )}{' '}
      {(adding || memberEdit) && (
        <MemberEditor
          group={group}
          props={props}
          membership={memberEdit || undefined}
          onClose={() => {
            setAdding(false);
            setMemberEdit(null);
          }}
        />
      )}
      {adjust && (
        <AdjustPeriod bill={adjust} props={props} group={group} onClose={() => setAdjust(null)} />
      )}
    </>
  );
}
function GroupEditor({
  group,
  members,
  act,
  onClose,
}: {
  group: FamilyGroup;
  members: Member[];
  act: Act;
  onClose: () => void;
}) {
  const [g, setG] = useState(group),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await act('group.save', g);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="编辑家庭组">
      <form className="form-stack" onSubmit={submit}>
        <Field label="家庭组名称">
          <input
            required
            maxLength={80}
            value={g.name}
            onChange={(e) => setG({ ...g, name: e.target.value })}
          />
        </Field>
        <Field label="总席位数" hint="负责人占用服务名额时也算一个席位。">
          <input
            required
            type="number"
            min="1"
            max="100"
            value={g.seats}
            onChange={(e) => setG({ ...g, seats: Number(e.target.value) })}
          />
        </Field>
        <Field label="分摊方式">
          <select
            value={g.splitMode}
            onChange={(e) => setG({ ...g, splitMode: e.target.value as any })}
          >
            <option value="none">不记录分摊</option>
            <option value="equal">参与成员均摊</option>
            <option value="custom">自定义金额，负责人承担余款</option>
          </select>
        </Field>
        <Field label="组长 / 付款负责人">
          <select value={g.leaderId} onChange={(e) => setG({ ...g, leaderId: e.target.value })}>
            <option value="">暂不设置</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </select>
        </Field>
        <Field label="备注">
          <textarea
            maxLength={2000}
            value={g.notes}
            onChange={(e) => setG({ ...g, notes: e.target.value })}
          />
        </Field>
        <Notice>
          分摊规则与成员改动用于之后生成的账期。已生成的账期请到「调整本期分摊」单独修改。
        </Notice>
        {error && <p className="form-error">{error}</p>}
        <SubmitBar busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
function MemberEditor({
  group,
  props,
  membership,
  onClose,
}: {
  group: FamilyGroup;
  props: DataProps;
  membership?: Membership;
  onClose: () => void;
}) {
  const { data, act, today } = props;
  const profile = data.members.find((m) => m.id === membership?.memberId),
    sub = data.subscriptions.find((s) => s.id === group.subscriptionId)!;
  const [seed, setSeed] = useState(profile?.seed || crypto.randomUUID()),
    [nickname, setNickname] = useState(profile?.nickname || ''),
    [contact, setContact] = useState(profile?.contact || ''),
    [notes, setNotes] = useState(profile?.notes || ''),
    [memberId, setMemberId] = useState(''),
    [joinedAt, setJoined] = useState(membership?.joinedAt || today),
    [expiresAt, setExpires] = useState(membership?.expiresAt || ''),
    [role, setRole] = useState(membership?.role || (group.leaderId ? 'member' : 'leader')),
    [participates, setParticipates] = useState(membership?.participates ?? true),
    [amount, setAmount] = useState(
      membership
        ? String(
            membership.customAmountMinor /
              10 ** ({ JPY: 0, KRW: 0, KWD: 3 }[sub.currency as 'JPY'] ?? 2),
          )
        : '0',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const reusable = data.members.filter(
    (m) => !activeMemberships(data, group.id, today).some((r) => r.memberId === m.id),
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const fields = {
        joinedAt,
        expiresAt,
        role,
        participates,
        customAmountMinor: parseMoney(amount, sub.currency),
      };
      if (membership && profile) {
        await act('member.update', {
          id: profile.id,
          nickname,
          seed,
          contact,
          notes,
          membership: { id: membership.id, ...fields },
        });
      } else
        await act('member.add', {
          groupId: group.id,
          memberId: memberId || undefined,
          nickname,
          seed,
          contact,
          notes,
          ...fields,
        });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={profile ? '编辑成员' : '添加家庭成员'}>
      <form className="form-stack" onSubmit={submit}>
        {!profile && reusable.length > 0 && (
          <Field label="使用已有成员档案">
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">创建新成员</option>
              {reusable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!memberId && (
          <>
            <div className="avatar-preview">
              <Avatar seed={seed} name={nickname || '新成员'} size={88} />
              <button className="button" type="button" onClick={() => setSeed(crypto.randomUUID())}>
                <Shuffle size={15} />
                换一个
              </button>
            </div>
            <Field label="昵称">
              <input
                autoFocus
                required
                maxLength={60}
                placeholder="怎么称呼这位伙伴？"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </Field>
            <Field label="联系方式（可选）">
              <input maxLength={160} value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <Field label="成员备注（可选）">
              <input maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        )}
        <div className="form-grid">
          <Field label="加入日期">
            <input
              type="date"
              required
              value={joinedAt}
              onChange={(e) => setJoined(e.target.value)}
            />
          </Field>
          <Field label="个人使用截止（可选）">
            <input type="date" value={expiresAt} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Field label="身份">
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="member">成员</option>
              <option value="leader">组长 / 负责人</option>
            </select>
          </Field>
          <Field label={`自定义应付（${sub.currency}）`}>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={participates}
            onChange={(e) => setParticipates(e.target.checked)}
          />
          参与后续账期分摊
        </label>
        <Notice>
          个人使用截止只影响成员资格，与服务续费日分开。修改共享成员档案会同步到其加入的所有家庭组。
        </Notice>
        {error && <p className="form-error">{error}</p>}
        <SubmitBar busy={busy} label={profile ? '保存修改' : '添加成员'} onCancel={onClose} />
      </form>
    </Modal>
  );
}
function AdjustPeriod({
  bill,
  props,
  group,
  onClose,
}: {
  bill: Bill;
  props: DataProps;
  group: FamilyGroup;
  onClose: () => void;
}) {
  const { data, act, today } = props;
  const old = data.allocations.filter((a) => a.billId === bill.id);
  const ids = Array.from(
    new Set([
      ...old.map((a) => a.memberId),
      ...activeMemberships(data, group.id, today).map((a) => a.memberId),
    ]),
  );
  const precision = { JPY: 0, KRW: 0, KWD: 3 }[bill.currency as 'JPY'] ?? 2;
  const [amounts, setAmounts] = useState<Record<string, string>>(
      Object.fromEntries(
        ids.map((id) => [
          id,
          String((old.find((a) => a.memberId === id)?.amountMinor || 0) / 10 ** precision),
        ]),
      ),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await act('allocation.adjust', {
        billId: bill.id,
        allocations: ids.map((id) => ({
          id: old.find((a) => a.memberId === id)?.id,
          memberId: id,
          amountMinor: parseMoney(amounts[id], bill.currency),
        })),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function even() {
    const n = ids.length;
    if (!n) return;
    const base = Math.floor(bill.amountMinor / n),
      rem = bill.amountMinor % n;
    setAmounts(
      Object.fromEntries(
        ids.map((id, i) => [id, String((base + (i < rem ? 1 : 0)) / 10 ** precision)]),
      ),
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="调整本期分摊"
      description={`${bill.dueDate} · 总额 ${formatMoney(bill.amountMinor, bill.currency)}`}
    >
      <form className="form-stack" onSubmit={submit}>
        <Notice>
          仅修改这个账期。请保证所有成员金额合计等于套餐总额；金额未变的已交费记录会保留；金额变动后需要重新确认交费。
        </Notice>
        <button type="button" className="button" onClick={even}>
          本期成员均摊
        </button>
        {ids.map((id) => (
          <Field
            key={id}
            label={
              data.members.find((m) => m.id === id)?.nickname ||
              old.find((a) => a.memberId === id)?.nickname ||
              '历史成员'
            }
          >
            <input
              required
              inputMode="decimal"
              value={amounts[id]}
              onChange={(e) => setAmounts({ ...amounts, [id]: e.target.value })}
            />
          </Field>
        ))}
        {error && <p className="form-error">{error}</p>}
        <SubmitBar busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

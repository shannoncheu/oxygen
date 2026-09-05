'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Layers3,
  LayoutGrid,
  ChartNoAxesCombined,
  Users,
  Settings2,
  Plus,
  Bell,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import type { BusinessData, Subscription } from '@/lib/model';
import { projectBills, todayInTimezone } from '@/lib/billing';
import { Act, Modal, offsetDay } from './shared';
import { BillRow, SubscriptionView, SubscriptionDetail, SubscriptionEditor } from './subscriptions';
import Families from './families';
import Statistics from './statistics';
import Settings from './settings';
const tabs = [
  { id: 'subscriptions', label: '订阅', icon: LayoutGrid, title: '我的订阅' },
  { id: 'statistics', label: '统计', icon: ChartNoAxesCombined, title: '支出统计' },
  { id: 'families', label: '家庭组', icon: Users, title: '家庭空间' },
  { id: 'settings', label: '设置', icon: Settings2, title: '偏好设置' },
];
export default function Dashboard({ username }: { username: string }) {
  const [data, setData] = useState<BusinessData | null>(null),
    [tab, setTab] = useState('subscriptions'),
    [error, setError] = useState(''),
    [syncing, setSyncing] = useState(false),
    [lastSync, setLastSync] = useState(''),
    [modal, setModal] = useState<'new' | 'detail' | 'edit' | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [reminders, setReminders] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      const j = await r.json();
      if (r.status === 401) {
        location.href = '/login';
        return;
      }
      if (!r.ok) throw Error(j.error || '读取数据失败');
      setData(j.data);
      dataRef.current = j.data;
      setLastSync(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const q = new URLSearchParams(location.search).get('view');
    if (tabs.some((t) => t.id === q)) setTab(q!);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30000);
    window.addEventListener('focus', refresh);
    const pop = () => setTab(new URLSearchParams(location.search).get('view') || 'subscriptions');
    window.addEventListener('popstate', pop);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('popstate', pop);
    };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        data.settings.theme === 'system'
          ? media.matches
            ? 'dark'
            : 'light'
          : data.settings.theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data?.settings.theme]);
  const act: Act = async (type, payload) => {
    const r = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
      body: JSON.stringify({ type, payload, revision: dataRef.current?.revision }),
    });
    const j = await r.json();
    if (r.status === 401) {
      location.href = '/login';
      throw Error('登录已过期');
    }
    if (!r.ok) {
      if (r.status === 409) await refresh();
      throw Error(j.error || '保存失败，请重试');
    }
    setData(j.data);
    dataRef.current = j.data;
    setLastSync(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  };
  function navigate(id: string) {
    setTab(id);
    history.pushState({}, '', id === 'subscriptions' ? '/' : `/?view=${id}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function openSubscription(s?: Subscription) {
    setSelected(s?.id || null);
    setModal(s ? 'detail' : 'new');
  }
  const active = tabs.find((t) => t.id === tab) || tabs[0];
  const today = data ? todayInTimezone(data.settings.timezone) : '';
  const reminderBills = data
    ? projectBills(data, today, offsetDay(today, data.settings.reminderDays)).filter(
        (b) => b.status === 'pending',
      )
    : [];
  const selectedSub = data?.subscriptions.find((s) => s.id === selected);
  const props = data ? { data, act, today, openSubscription } : null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="/">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          续订<span className="wordmark-en">RENEW</span>
        </a>
        <span className="sidebar-label">个人空间</span>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => navigate(t.id)}
            >
              <t.icon size={21} />
              <span>{t.label}</span>
              {t.id === 'subscriptions' && data && (
                <small>{data.subscriptions.filter((s) => s.status !== 'archived').length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={19} />
            <div>
              <strong>安心的私人空间</strong>
              <span>数据存储在你的服务器</span>
            </div>
          </div>
          <button className="sidebar-account" onClick={() => navigate('settings')}>
            <span className="user-initial">{username.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{username}</strong>
              <small>管理员</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <main className="app-main">
        <header className="app-header">
          <div>
            <p className="greeting">
              {today ? `${Number(today.slice(5, 7))} 月 ${Number(today.slice(8))} 日，` : ''}
              欢迎回来，{username}
            </p>
            <h1>
              {active.title}
              <span className="title-dot" />
            </h1>
          </div>
          <div className="header-actions">
            <button
              className="icon-button sync-button"
              onClick={refresh}
              aria-label="同步数据"
              title={`上次同步 ${lastSync || '尚未'}`}
            >
              <RefreshCw size={19} className={syncing ? 'spin' : ''} />
            </button>
            <button
              className="icon-button notification-button"
              onClick={() => setReminders(true)}
              aria-label="续费提醒"
            >
              <Bell size={21} />
              {reminderBills.length > 0 && <i />}
            </button>
            <button className="button primary desktop-add" onClick={() => openSubscription()}>
              <Plus size={18} />
              添加订阅
            </button>
          </div>
        </header>
        {error && (
          <div className="page-error" role="alert">
            {error}
            <button className="text-button" onClick={refresh}>
              重试
            </button>
          </div>
        )}
        {props ? (
          <div className="view-content" key={tab}>
            {tab === 'subscriptions' ? (
              <SubscriptionView {...props} />
            ) : tab === 'statistics' ? (
              <Statistics {...props} />
            ) : tab === 'families' ? (
              <Families {...props} />
            ) : (
              <Settings data={data!} act={act} onReload={refresh} username={username} />
            )}
          </div>
        ) : (
          <section className="panel loading-panel">
            <RefreshCw className="spin" size={25} />
            <p>正在读取你的订阅空间…</p>
          </section>
        )}
        <footer className="app-footer">
          <span>续订 · 把每一份订阅照顾好</span>
          <span className="sync-indicator">
            <i />
            {lastSync ? `${lastSync} 已同步` : '连接中'}
          </span>
        </footer>
      </main>
      <div className="mobile-bottom">
        <nav className="mobile-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => navigate(t.id)}
            >
              <t.icon size={21} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <button className="mobile-add" aria-label="添加订阅" onClick={() => openSubscription()}>
          <Plus size={26} />
        </button>
      </div>
      {data && modal === 'new' && (
        <SubscriptionEditor data={data} act={act} today={today} onClose={() => setModal(null)} />
      )}{' '}
      {data && selectedSub && modal === 'edit' && (
        <SubscriptionEditor
          data={data}
          subscription={selectedSub}
          act={act}
          today={today}
          onClose={() => setModal(null)}
        />
      )}{' '}
      {data && selectedSub && modal === 'detail' && (
        <SubscriptionDetail
          subscription={selectedSub}
          data={data}
          act={act}
          today={today}
          onClose={() => setModal(null)}
          onEdit={() => setModal('edit')}
        />
      )}{' '}
      {reminders && data && (
        <Modal
          open
          onClose={() => setReminders(false)}
          title="续费提醒"
          description={`今天起 ${data.settings.reminderDays} 天内的待确认账单。打开网站时可查看。`}
        >
          {reminderBills.length ? (
            reminderBills.map((b) => <BillRow bill={b} act={act} today={today} key={b.id} />)
          ) : (
            <p className="muted">目前没有临近续费，安心享用你的订阅。</p>
          )}
        </Modal>
      )}
    </div>
  );
}

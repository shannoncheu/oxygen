'use client';
import { useState } from 'react';
import {
  LockKeyhole,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Check,
  Trash2,
  Plus,
  LogOut,
  ShieldCheck,
  Bell,
  Globe,
  Folder,
  Database,
} from 'lucide-react';
import type { Settings as SettingsType } from '@/lib/model';
import { currencies, DataProps, Field, Modal, Notice, SubmitBar } from './shared';
import { AccountAvatar } from './account-avatar';
import { Brand } from './brand';
async function post(path: string, body: any) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || '操作失败');
  return j;
}
export default function Settings({
  data,
  act,
  onReload,
  username,
}: {
  data: DataProps['data'];
  act: DataProps['act'];
  onReload: () => Promise<void>;
  username: string;
}) {
  const [s, setS] = useState<SettingsType>(data.settings),
    [category, setCategory] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(false),
    [backup, setBackup] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [confirm, setConfirm] = useState('');
  function edit(key: keyof SettingsType, value: any) {
    setS({ ...s, [key]: value });
    setSuccess('');
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await act('settings.save', s);
      setSuccess('设置已保存，其他设备重新读取后同步。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(file?: File) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      if (file.size > 49 * 1024 * 1024) throw Error('导入文件不能超过 49 MB。');
      const content = JSON.parse(await file.text());
      const result = await post('/api/import', { mode: 'preview', backup: content });
      setBackup(content);
      setPreview(result.preview);
      setConfirm('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    setError('');
    try {
      await post('/api/import', {
        mode: 'restore',
        backup,
        confirmation: confirm,
        revision: data.revision,
      });
      await onReload();
      setPreview(null);
      setSuccess('业务数据已恢复。请刷新查看恢复后的显示设置。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setError('');
    try {
      await post('/api/auth/logout', {});
      location.href = '/login';
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="settings-layout">
      <form className="settings-main" onSubmit={save}>
        <section className="panel settings-panel">
          <div className="section-heading">
            <h2>
              <Globe size={19} />
              显示与偏好
            </h2>
          </div>
          <div className="setting-row">
            <div>
              <strong>外观</strong>
              <p>选择适合你的屏幕风格</p>
            </div>
            <div className="theme-options">
              {(['light', 'dark', 'system'] as const).map((theme, i) => {
                const Icon = [Sun, Moon, Monitor][i];
                return (
                  <button
                    type="button"
                    key={theme}
                    className={s.theme === theme ? 'active' : ''}
                    onClick={() => edit('theme', theme)}
                  >
                    <Icon size={19} />
                    <span>{['浅色', '深色', '跟随系统'][i]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>默认显示货币</strong>
              <p>用于新订阅与统计选择；不同币种不会自动换算</p>
            </div>
            <select
              aria-label="默认显示货币"
              value={s.displayCurrency}
              onChange={(e) => edit('displayCurrency', e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>账户时区</strong>
              <p>计费按当地日历日期显示，历史账单日期保留</p>
            </div>
            <input
              list="timezones"
              aria-label="账户时区"
              value={s.timezone}
              onChange={(e) => edit('timezone', e.target.value)}
              required
            />
            <datalist id="timezones">
              {[
                'Asia/Shanghai',
                'Asia/Hong_Kong',
                'Asia/Taipei',
                'Asia/Tokyo',
                'Asia/Singapore',
                'Europe/London',
                'Europe/Berlin',
                'America/New_York',
                'America/Los_Angeles',
                'Australia/Sydney',
                'UTC',
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </datalist>
          </div>
        </section>
        <section className="panel settings-panel">
          <h2>
            <Folder size={19} />
            分类管理
          </h2>
          <div className="category-chips">
            {s.categories.map((c) => (
              <span key={c}>
                {c}
                <button
                  type="button"
                  aria-label={`移除分类${c}`}
                  onClick={() =>
                    edit(
                      'categories',
                      s.categories.filter((v) => v !== c),
                    )
                  }
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
          <div className="category-add">
            <input
              aria-label="新分类名称"
              value={category}
              maxLength={40}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="新的分类名称"
            />
            <button
              type="button"
              className="button"
              onClick={() => {
                if (category.trim() && !s.categories.includes(category.trim())) {
                  edit('categories', [...s.categories, category.trim()]);
                  setCategory('');
                }
              }}
            >
              <Plus size={16} />
              添加
            </button>
          </div>
          <p className="muted small">移除分类不会删除已有订阅或改写历史账单。</p>
        </section>
        <section className="panel settings-panel">
          <h2>
            <Bell size={19} />
            站内提醒
          </h2>
          <div className="setting-row">
            <div>
              <strong>提前提醒天数</strong>
              <p>首页提醒中心显示这个时间范围内的续费</p>
            </div>
            <select
              aria-label="提前提醒天数"
              value={s.reminderDays}
              onChange={(e) => edit('reminderDays', Number(e.target.value))}
            >
              {[0, 1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? '仅当天' : `提前 ${d} 天`}
                </option>
              ))}
            </select>
          </div>
          <Notice>
            站内提醒需要打开网站才能查看。也可导出 .ics 到你的日历应用；没有邮件或浏览器推送服务。
          </Notice>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="success-message" role="status">
            <Check size={17} />
            {success}
          </p>
        )}
        <div className="settings-save">
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : '保存设置'}
          </button>
        </div>
      </form>
      <div className="settings-aside">
        <section className="panel settings-panel">
          <h2>
            <LockKeyhole size={19} />
            账号与安全
          </h2>
          <div className="account-card">
            <AccountAvatar username={username} size={48} />
            <div>
              <strong>{username}</strong>
              <small>站点管理员</small>
            </div>
            <ShieldCheck size={20} />
          </div>
          <button className="button full-width" onClick={() => setPassword(true)}>
            修改密码
          </button>
          <button className="text-button logout-button" onClick={logout}>
            <LogOut size={16} />
            退出登录
          </button>
        </section>
        <section className="panel settings-panel">
          <h2>
            <Database size={19} />
            数据备份
          </h2>
          <p className="muted small">
            完整 JSON 包含业务记录与上传图片，不包含账号密码、会话或部署密钥。
          </p>
          <div className="export-buttons">
            <a className="button" href="/api/export?format=json">
              <Download size={16} />
              完整 JSON 备份
            </a>
            <a className="button" href="/api/export?format=csv">
              <Download size={16} />
              订阅 CSV 表格
            </a>
            <a className="button" href="/api/export?format=ics">
              <Download size={16} />
              续费日历 .ics
            </a>
          </div>
          <label className="button import-button">
            <Upload size={16} />从 JSON 恢复
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                inspect(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <p className="muted small">
            先校验和预览，再由你确认覆盖。服务器完整备份请使用随项目提供的备份脚本。
          </p>
        </section>
        <section className="settings-about">
          <Brand />
          <p>你的私人订阅管家 · 1.0.0</p>
          <p>本地头像与品牌资源，无需外部 API Key。</p>
        </section>
      </div>
      {password && <PasswordDialog onClose={() => setPassword(false)} />}{' '}
      {preview && (
        <Modal open onClose={() => setPreview(null)} title="恢复预览">
          <div className="form-stack">
            <Notice>这会覆盖现有业务数据。账号与密码保持不变。建议先导出当前 JSON 备份。</Notice>
            <dl className="import-preview">
              {Object.entries(preview).map(([k, v]) => (
                <div key={k}>
                  <dt>
                    {{
                      subscriptions: '订阅',
                      groups: '家庭组',
                      members: '成员档案',
                      bills: '账期',
                      uploads: '上传图片',
                      allocations: '分摊记录',
                    }[k] || k}
                  </dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
            <Field label="输入「覆盖现有数据」确认">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error && <p className="form-error">{error}</p>}
            <button
              className="button danger"
              disabled={confirm !== '覆盖现有数据' || busy}
              onClick={restore}
            >
              {busy ? '正在恢复…' : '确认覆盖并恢复'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (form.get('new') !== form.get('confirm')) throw Error('两次新密码不一致。');
      await post('/api/auth/password', {
        currentPassword: form.get('current'),
        newPassword: form.get('new'),
        revokeOthers: form.get('revoke') === 'on',
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="修改密码">
      <form className="form-stack" onSubmit={submit}>
        <Field label="当前密码">
          <input
            type="password"
            name="current"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </Field>
        <Field label="新密码（至少 12 个字符）">
          <input
            type="password"
            name="new"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </Field>
        <Field label="确认新密码">
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </Field>
        <label className="check-label">
          <input type="checkbox" name="revoke" defaultChecked />
          同时退出其他设备的登录
        </label>
        {error && <p className="form-error">{error}</p>}
        <SubmitBar busy={busy} onCancel={onClose} label="更新密码" />
      </form>
    </Modal>
  );
}

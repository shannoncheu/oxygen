'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { Field, Modal, Notice, SubmitBar } from './shared';

type ManagedAccount = {
  id: string;
  username: string;
  role: 'admin' | 'member';
  disabledAt: string | null;
  createdAt: string;
};
type Invitation = {
  id: string;
  kind: 'invitation' | 'password_reset';
  username: string;
  accountId?: string;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  attempts: number;
};
type AccountData = { accounts: ManagedAccount[]; invitations: Invitation[] };
type SecretLink = {
  link: string;
  code: string;
  expiresAt: string;
  username: string;
  reset: boolean;
};
type ManageAction = 'disable' | 'enable' | 'revoke_sessions' | 'delete' | 'reset_password';
type DialogAction =
  | { type: 'create' }
  | { type: 'revoke'; invitation: Invitation }
  | { type: 'manage'; account: ManagedAccount; action: ManageAction };
const actionLabels: Record<ManageAction, string> = {
  disable: '停用账号',
  enable: '启用账号',
  revoke_sessions: '退出所有设备',
  delete: '删除账号',
  reset_password: '重置密码',
};

async function post<T>(url: string, value: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。');
  return result;
}
function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
function invitationStatus(invitation: Invitation) {
  if (invitation.consumedAt) return '已使用';
  if (invitation.revokedAt) return '已撤销';
  if (invitation.attempts >= 5) return '已失效';
  if (Date.parse(invitation.expiresAt) <= Date.now()) return '已过期';
  return '待使用';
}

export function AccountManagement() {
  const [data, setData] = useState<AccountData | null>(null);
  const [tab, setTab] = useState<'accounts' | 'invitations'>('accounts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [secret, setSecret] = useState<SecretLink | null>(null);
  const [success, setSuccess] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '账号列表读取失败，请重试。');
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账号列表读取失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function completed(result?: SecretLink) {
    setDialog(null);
    if (result) setSecret(result);
    else setSuccess('操作已完成。');
    await reload();
  }
  const members = data?.accounts.filter((account) => account.role === 'member') || [];
  return (
    <section
      className="panel settings-panel account-management"
      aria-labelledby="account-management-heading"
    >
      <div className="account-management-heading">
        <div>
          <h2 id="account-management-heading">
            <Users size={19} />
            账号管理
          </h2>
          <p className="muted small">仅通过邀请注册。每个账号有独立的订阅、图片和设置。</p>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setSuccess('');
            setDialog({ type: 'create' });
          }}
        >
          <Plus size={17} />
          创建邀请
        </button>
      </div>
      <div className="account-tabs" role="group" aria-label="账号管理视图">
        <button
          type="button"
          aria-pressed={tab === 'accounts'}
          className={tab === 'accounts' ? 'active' : ''}
          onClick={() => setTab('accounts')}
        >
          账号 <span>{data?.accounts.length || 0}</span>
        </button>
        <button
          type="button"
          aria-pressed={tab === 'invitations'}
          className={tab === 'invitations' ? 'active' : ''}
          onClick={() => setTab('invitations')}
        >
          邀请记录 <span>{data?.invitations.length || 0}</span>
        </button>
        <button
          type="button"
          className="icon-button account-refresh"
          aria-label="刷新账号列表"
          disabled={loading}
          onClick={() => void reload()}
        >
          <RefreshCw className={loading ? 'spin' : ''} size={16} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-message small" role="status">
          <Check size={16} />
          {success}
        </p>
      )}
      {loading && !data && (
        <p className="account-loading" role="status">
          <LoaderCircle size={17} className="spin" />
          正在读取账号…
        </p>
      )}
      {data &&
        (tab === 'accounts' ? (
          <div className="managed-accounts">
            {data.accounts.map((account) => (
              <article className="managed-account" key={account.id}>
                <div className="managed-account-info">
                  <span className="managed-account-symbol" aria-hidden="true">
                    {account.role === 'admin' ? <ShieldCheck size={20} /> : <UserRound size={20} />}
                  </span>
                  <div>
                    <strong>{account.username}</strong>
                    <small>
                      {account.role === 'admin'
                        ? '管理员'
                        : account.disabledAt
                          ? '已停用'
                          : '普通账号'}{' '}
                      · {new Date(account.createdAt).toLocaleDateString('zh-CN')} 创建
                    </small>
                  </div>
                  {account.disabledAt && <span className="account-status disabled">已停用</span>}
                </div>
                {account.role === 'member' && (
                  <div className="managed-account-actions">
                    {(
                      [
                        account.disabledAt ? 'enable' : 'disable',
                        'revoke_sessions',
                        'reset_password',
                        'delete',
                      ] as ManageAction[]
                    ).map((action) => (
                      <button
                        type="button"
                        key={action}
                        className={`text-button ${action === 'delete' ? 'account-delete' : ''}`}
                        onClick={() => {
                          setSuccess('');
                          setDialog({ type: 'manage', account, action });
                        }}
                      >
                        {actionLabels[action]}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {members.length === 0 && (
              <p className="account-empty muted">
                还没有其他账号。创建邀请后，把链接和验证码分别发给对方。
              </p>
            )}
          </div>
        ) : (
          <div className="managed-invitations">
            {data.invitations.length === 0 && (
              <p className="account-empty muted">还没有邀请记录。</p>
            )}
            {data.invitations.map((invitation) => {
              const status = invitationStatus(invitation);
              return (
                <article className="managed-invitation" key={invitation.id}>
                  <div>
                    <strong>{invitation.username}</strong>
                    <span className={`account-status ${status === '待使用' ? 'pending' : ''}`}>
                      {status}
                    </span>
                    <p>
                      {invitation.kind === 'password_reset' ? '重置密码' : '邀请注册'} · 有效期至{' '}
                      {date(invitation.expiresAt)}
                    </p>
                  </div>
                  {status === '待使用' && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setDialog({ type: 'revoke', invitation })}
                    >
                      撤销
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      <p className="muted small account-management-note">
        这里管理登录权限，不展示其他账号的订阅内容。
      </p>
      {dialog && (
        <AccountActionDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onComplete={completed}
        />
      )}
      {secret && <SecretLinkDialog value={secret} onClose={() => setSecret(null)} />}
    </section>
  );
}

function AccountActionDialog({
  dialog,
  onClose,
  onComplete,
}: {
  dialog: DialogAction;
  onClose: () => void;
  onComplete: (value?: SecretLink) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isDelete = dialog.type === 'manage' && dialog.action === 'delete';
  const title =
    dialog.type === 'create'
      ? '创建邀请'
      : dialog.type === 'revoke'
        ? '撤销链接'
        : actionLabels[dialog.action];
  const close = () => {
    if (!busy) onClose();
  };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const currentPassword = form.get('currentPassword');
    try {
      let value: SecretLink | undefined;
      if (dialog.type === 'create') {
        const result = await post<{
          invitation: { username: string; expiresAt: string };
          link: string;
          code: string;
        }>('/api/admin/invitations', {
          username: form.get('username'),
          expiresInDays: Number(form.get('expiresInDays')),
          currentPassword,
        });
        value = {
          ...result,
          username: result.invitation.username,
          expiresAt: result.invitation.expiresAt,
          reset: false,
        };
      } else if (dialog.type === 'revoke') {
        await post('/api/admin/invitations/revoke', { id: dialog.invitation.id, currentPassword });
      } else {
        const result = await post<{ link?: string; code?: string; expiresAt?: string }>(
          '/api/admin/accounts/manage',
          {
            accountId: dialog.account.id,
            action: dialog.action,
            currentPassword,
            confirmation: form.get('confirmation') || undefined,
          },
        );
        if (result.link && result.code && result.expiresAt)
          value = {
            link: result.link,
            code: result.code,
            expiresAt: result.expiresAt,
            username: dialog.account.username,
            reset: true,
          };
      }
      await onComplete(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={close} title={title}>
      <form className="form-stack" onSubmit={submit}>
        {dialog.type === 'create' ? (
          <>
            <Field
              label="受邀用户名"
              hint="3–64 个字符，可用文字、数字和 . _ @ -。此链接只能注册这个用户名。"
            >
              <input
                name="username"
                required
                minLength={3}
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="为对方指定用户名"
                disabled={busy}
              />
            </Field>
            <Field label="邀请有效期">
              <select name="expiresInDays" defaultValue="7" disabled={busy}>
                <option value="1">1 天</option>
                <option value="3">3 天</option>
                <option value="7">7 天</option>
              </select>
            </Field>
            <Notice>注册需要专属链接和独立验证码。两项将在创建后显示，请分开发给对方。</Notice>
          </>
        ) : dialog.type === 'revoke' ? (
          <Notice>
            撤销 {dialog.invitation.username} 的
            {dialog.invitation.kind === 'password_reset' ? '密码重置' : '邀请注册'}
            链接后，原链接和验证码将立即失效。
          </Notice>
        ) : (
          <>
            <p className="managed-target">
              <UserRound size={18} />
              {dialog.account.username}
            </p>
            <Notice>
              {dialog.action === 'disable'
                ? '停用后立即退出所有设备，该账号无法登录。订阅和图片保留，之后可以重新启用。'
                : dialog.action === 'enable'
                  ? '启用后，对方可以继续使用原用户名和密码登录。'
                  : dialog.action === 'revoke_sessions'
                    ? '立即退出这个账号的所有设备。对方仍可使用原密码重新登录。'
                    : dialog.action === 'reset_password'
                      ? '生成 1 小时有效的重置链接和独立验证码。对方自行设置新密码，完成后退出所有设备。'
                      : '永久删除这个账号及其订阅、账单、图片和设置，无法撤销。'}
            </Notice>
            {isDelete && (
              <Field label={`输入「${dialog.account.username}」确认删除`}>
                <input name="confirmation" required autoComplete="off" disabled={busy} />
              </Field>
            )}
          </>
        )}
        <Field label="你的当前密码">
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            maxLength={128}
            disabled={busy}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {isDelete ? (
          <div className="submit-bar">
            <button type="button" className="button" onClick={close} disabled={busy}>
              取消
            </button>
            <button type="submit" className="button danger" disabled={busy}>
              {busy ? '正在删除…' : '永久删除账号'}
            </button>
          </div>
        ) : (
          <SubmitBar busy={busy} label={title} onCancel={close} />
        )}
      </form>
    </Modal>
  );
}

function SecretLinkDialog({ value, onClose }: { value: SecretLink; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setError('');
    } catch {
      setError('复制失败，请长按或选中上面的内容手动复制。');
    }
  }
  return (
    <Modal open onClose={onClose} title={value.reset ? '密码重置链接已生成' : '邀请已创建'}>
      <div className="form-stack secret-link-dialog">
        <p className="managed-target">
          <UserRound size={18} />
          {value.username}
        </p>
        <Notice>链接与验证码请分开发给对方。关闭后无法再次查看，需要时可以重新生成。</Notice>
        <Field label={value.reset ? '重置链接' : '邀请链接'}>
          <textarea
            value={value.link}
            readOnly
            rows={3}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
        <button type="button" className="button" onClick={() => void copy(value.link, '链接')}>
          {copied === '链接' ? <Check size={16} /> : <Copy size={16} />}复制链接
        </button>
        <Field label="独立验证码">
          <input
            className="invitation-code"
            value={value.code}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
        <button type="button" className="button" onClick={() => void copy(value.code, '验证码')}>
          {copied === '验证码' ? <Check size={16} /> : <Copy size={16} />}复制验证码
        </button>
        <p className="muted small">有效期至 {date(value.expiresAt)}，仅可使用一次。</p>
        {copied && (
          <span role="status" className="success-message small">
            {copied}已复制。
          </span>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}

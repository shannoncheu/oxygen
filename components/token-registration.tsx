'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, KeyRound, LoaderCircle, UserRoundPlus } from 'lucide-react';
import { Brand } from './brand';
import { Field } from './shared';

type TokenKind = 'invitation' | 'password_reset';
type TokenInfo = { kind: TokenKind; username: string; expiresAt: string };

export function TokenRegistration({ kind }: { kind: TokenKind }) {
  const [token, setToken] = useState('');
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const requestSequence = useRef(0);
  const pendingSubmission = useRef<AbortController | null>(null);
  const invitation = kind === 'invitation';

  useEffect(() => {
    let inspection: AbortController | null = null;
    function readFragment() {
      const sequence = ++requestSequence.current;
      inspection?.abort();
      pendingSubmission.current?.abort();
      const value = window.location.hash.slice(1);
      setToken(value);
      setInfo(null);
      setError('');
      setSuccess(false);
      setBusy(false);
      setLoading(Boolean(value) && value.length <= 256);
      if (!value || value.length > 256) return;
      const controller = new AbortController();
      inspection = controller;
      const current = () => !controller.signal.aborted && requestSequence.current === sequence;
      async function inspect() {
        try {
          const response = await fetch('/api/invitations/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
            body: JSON.stringify({ token: value }),
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '链接已失效，请联系管理员。');
          if (result.kind !== kind)
            throw new Error('链接类型不匹配，请重新打开管理员发给你的完整链接。');
          if (current()) setInfo(result);
        } catch (reason) {
          if (current())
            setError(reason instanceof Error ? reason.message : '暂时无法验证链接，请稍后重试。');
        } finally {
          if (current()) setLoading(false);
        }
      }
      void inspect();
    }
    readFragment();
    window.addEventListener('hashchange', readFragment);
    return () => {
      window.removeEventListener('hashchange', readFragment);
      requestSequence.current++;
      inspection?.abort();
      pendingSubmission.current?.abort();
    };
  }, [kind]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !info) return;
    const form = new FormData(event.currentTarget);
    setError('');
    if (form.get('password') !== form.get('confirmation')) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    const sequence = requestSequence.current;
    const controller = new AbortController();
    pendingSubmission.current = controller;
    const current = () => !controller.signal.aborted && requestSequence.current === sequence;
    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
        body: JSON.stringify({ token, code: form.get('code'), password: form.get('password') }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
      if (!current()) return;
      setSuccess(true);
      setToken('');
      window.history.replaceState(null, '', window.location.pathname);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : '操作失败，请重试。');
    } finally {
      if (current()) setBusy(false);
      if (pendingSubmission.current === controller) pendingSubmission.current = null;
    }
  }

  return (
    <main className="token-page">
      <Brand href="/login" />
      <section className="panel token-panel" aria-busy={loading || busy}>
        <span className="token-symbol" aria-hidden="true">
          {success ? (
            <Check size={27} />
          ) : invitation ? (
            <UserRoundPlus size={27} />
          ) : (
            <KeyRound size={27} />
          )}
        </span>
        {loading ? (
          <div className="token-status" role="status">
            <LoaderCircle className="spin" size={21} />
            正在验证链接…
          </div>
        ) : success ? (
          <div className="form-stack">
            <h1>{invitation ? '账号已创建' : '密码已更新'}</h1>
            <p className="muted">现在可以使用 {info?.username} 和新密码登录。</p>
            <a className="button primary" href="/login">
              前往登录
              <ArrowRight size={17} />
            </a>
          </div>
        ) : info ? (
          <>
            <h1>{invitation ? '加入 Oxygen' : '设置新密码'}</h1>
            <p className="muted token-intro">
              {invitation
                ? '设置你的登录密码，开始记录自己的订阅。'
                : '完成后，其他设备上的登录将退出。'}
            </p>
            <form key={token} className="form-stack" onSubmit={submit}>
              <Field label="用户名">
                <input value={info.username} readOnly autoComplete="username" />
              </Field>
              <Field
                label={invitation ? '注册验证码' : '重置验证码'}
                hint="填写管理员单独发给你的 8 位验证码。"
              >
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{8}"
                  minLength={8}
                  maxLength={8}
                  required
                  disabled={busy}
                  placeholder="8 位数字"
                />
              </Field>
              <Field label="新密码（至少 12 个字符）">
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="确认新密码">
                <input
                  type="password"
                  name="confirmation"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </Field>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? '正在提交…' : invitation ? '创建账号' : '更新密码'}
                {!busy && <ArrowRight size={17} />}
              </button>
              <p className="muted small token-expiry">
                链接有效期至 {new Date(info.expiresAt).toLocaleString('zh-CN')}，仅可使用一次。
              </p>
            </form>
          </>
        ) : (
          <div className="form-stack">
            <h1>{token ? '链接暂不可用' : invitation ? '需要邀请链接' : '需要密码重置链接'}</h1>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : (
              <p className="muted">请联系管理员获取专属链接和验证码。</p>
            )}
            <a className="button" href="/login">
              返回登录
            </a>
          </div>
        )}
      </section>
      {!success && info && (
        <a className="text-button token-login" href="/login">
          已有账号？返回登录
        </a>
      )}
    </main>
  );
}

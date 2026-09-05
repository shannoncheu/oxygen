'use client';
import { useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Users,
  LockKeyhole,
  ShieldCheck,
  LoaderCircle,
} from 'lucide-react';
import { Brand } from '@/components/brand';
export default function Login() {
  const [show, setShow] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
        body: JSON.stringify({
          username: f.get('username'),
          password: f.get('password'),
          remember: f.get('remember') === 'on',
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '登录失败，请重试');
      location.href = '/';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand href="/login" />
        <div className="story-copy">
          <span className="eyebrow">A LITTLE MORE IN CONTROL</span>
          <h1>
            每一份订阅，
            <br />
            都心中有数。
          </h1>
          <p>
            理清续费日期，照顾共享成员。
            <br />
            把生活中的小开支，放在一个安心的地方。
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="art-card art-back">
              <span>FAMILY PLAN</span>
              <Users size={32} />
              <strong>一起分享，轻松管理</strong>
              <div className="art-dots">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="art-card art-front">
              <span>YOUR SUBSCRIPTIONS</span>
              <div className="art-lines">
                <i />
                <i />
                <i />
              </div>
              <strong>下一次续费，提前知道。</strong>
            </div>
          </div>
        </div>
        <p className="login-note">
          <ShieldCheck size={17} /> 数据留在你的服务器，掌握在你手中。
        </p>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <span className="login-lock">
            <LockKeyhole size={24} />
          </span>
          <h2>欢迎回来</h2>
          <p className="muted">登录 Oxygen</p>
          <label>
            账号
            <input
              name="username"
              autoComplete="username"
              placeholder="管理员账号"
              required
              maxLength={80}
            />
          </label>
          <label>
            密码
            <span className="password-field">
              <input
                type={show ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="输入密码"
                required
                maxLength={128}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? '隐藏密码' : '显示密码'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
          </label>
          <label className="check-label">
            <input type="checkbox" name="remember" />
            保持登录 30 天
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                登录
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="login-help">
            未开放注册。
            <br />
            首次使用或忘记密码？请在服务器运行管理员命令。
          </p>
        </form>
        <p className="login-footer">少一点忘记，多一点从容。</p>
      </section>
    </main>
  );
}

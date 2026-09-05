'use client';

import { useState } from 'react';
import { PencilLine } from 'lucide-react';
import { Field, Modal, SubmitBar } from './shared';

export function UsernameSettings({
  username,
  onChanged,
}: {
  username: string;
  onChanged: (username: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/account/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
        body: JSON.stringify({
          username: form.get('username'),
          currentPassword: form.get('currentPassword'),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '用户名修改失败，请重试。');
      onChanged(result.account.username);
      setOpen(false);
      setSuccess('用户名已更新，下次登录请使用新用户名。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '用户名修改失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="username-settings">
      <button
        type="button"
        className="button full-width"
        onClick={() => {
          setError('');
          setSuccess('');
          setOpen(true);
        }}
      >
        <PencilLine size={16} />
        修改用户名
      </button>
      {success && (
        <p className="success-message small" role="status">
          {success}
        </p>
      )}
      {open && (
        <Modal open onClose={() => !busy && setOpen(false)} title="修改用户名">
          <form className="form-stack" onSubmit={submit}>
            <Field
              label="新用户名"
              hint="3–64 个字符，可用文字、数字和 . _ @ -。保存后其他设备将退出，订阅数据保持不变。"
            >
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={64}
                defaultValue={username}
                disabled={busy}
              />
            </Field>
            <Field label="当前密码">
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <SubmitBar busy={busy} label="保存用户名" onCancel={() => !busy && setOpen(false)} />
          </form>
        </Modal>
      )}
    </div>
  );
}

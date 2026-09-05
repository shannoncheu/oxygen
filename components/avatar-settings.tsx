'use client';
import { useState } from 'react';
import { Check, RotateCcw, Shuffle, Upload } from 'lucide-react';
import type { Settings } from '@/lib/model';

export type AvatarPatch = { avatarUrl: string; avatarSeed: string };

export function AvatarSettings({
  username,
  settings,
  onSave,
}: {
  username: string;
  settings: Settings;
  onSave: (patch: AvatarPatch) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function update(patch: AvatarPatch) {
    await onSave(patch);
    setSuccess('头像已保存');
  }
  async function changeAvatar(file?: File, generated?: AvatarPatch) {
    if (!file && !generated) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (file) {
        if (file.size > 2 * 1024 * 1024 || file.size === 0)
          throw new Error('请选择 2 MB 以内的图片。');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw new Error('支持 PNG、JPEG 和 WebP 图片。');
        const form = new FormData();
        form.set('file', file);
        const response = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'X-Requested-With': 'subscribo' },
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '头像上传失败，请重试。');
        await update({ avatarUrl: result.url, avatarSeed: settings.avatarSeed || '' });
      } else if (generated) await update(generated);
    } catch (error) {
      setError(error instanceof Error ? error.message : '头像保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-settings form-stack">
      <p className="muted small">为 {username} 更换头像。支持 PNG、JPEG 或 WebP，最大 2 MB。</p>
      <label className="button import-button" aria-disabled={busy}>
        <Upload size={16} />
        {busy ? '正在保存…' : '上传头像'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="上传账户头像"
          disabled={busy}
          onChange={(event) => {
            void changeAvatar(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      <div className="avatar-actions">
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() =>
            void changeAvatar(undefined, { avatarUrl: '', avatarSeed: crypto.randomUUID() })
          }
        >
          <Shuffle size={16} />
          换个头像
        </button>
        <button
          className="text-button"
          type="button"
          disabled={busy || (!settings.avatarUrl && !settings.avatarSeed)}
          onClick={() => void changeAvatar(undefined, { avatarUrl: '', avatarSeed: '' })}
        >
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          <Check size={16} />
          {success}
        </p>
      )}
    </div>
  );
}

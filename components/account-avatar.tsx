'use client';
import { useState } from 'react';
import { Avatar } from '@/components/shared';

export function AccountAvatar({
  username,
  size = 36,
  avatarUrl = '',
  avatarSeed = '',
}: {
  username: string;
  size?: number;
  avatarUrl?: string;
  avatarSeed?: string;
}) {
  const [failedUrl, setFailedUrl] = useState('');
  const name = `${username} 的头像`;
  if (avatarUrl && avatarUrl !== failedUrl)
    return (
      <img
        className="avatar"
        src={avatarUrl}
        alt={name}
        title={name}
        width={size}
        height={size}
        onError={() => setFailedUrl(avatarUrl)}
      />
    );
  return <Avatar seed={avatarSeed || `oxygen-account:${username}`} name={name} size={size} />;
}

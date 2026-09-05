import { Avatar } from '@/components/shared';

export function AccountAvatar({ username, size = 36 }: { username: string; size?: number }) {
  return <Avatar seed={`oxygen-account:${username}`} name={`${username} 的头像`} size={size} />;
}

import type { Metadata } from 'next';
import { TokenRegistration } from '@/components/token-registration';

export const metadata: Metadata = {
  title: '重置密码 · Oxygen',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <TokenRegistration kind="password_reset" />;
}

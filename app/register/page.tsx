import type { Metadata } from 'next';
import { TokenRegistration } from '@/components/token-registration';

export const metadata: Metadata = { title: '加入 Oxygen', robots: { index: false, follow: false } };

export default function RegisterPage() {
  return <TokenRegistration kind="invitation" />;
}

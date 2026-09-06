import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server/auth';
import LoginForm from '@/components/login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentAccount()) redirect('/');
  return <LoginForm />;
}

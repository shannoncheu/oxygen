import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server/auth';
import Dashboard from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const account = await currentAccount();
  if (!account) redirect('/login');
  return <Dashboard username={account.username} role={account.role} />;
}

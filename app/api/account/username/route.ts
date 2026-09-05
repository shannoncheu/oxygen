import { route, json, bodyJSON } from '@/lib/server/api';
import { requireAccount, requireUnsafeRequest } from '@/lib/server/auth';
import { changeUsername } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAccount(request);
  const { username, currentPassword } = await bodyJSON(request, 4096);
  return json({ account: await changeUsername(account, username, currentPassword) });
});

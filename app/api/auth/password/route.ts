import { route, json, bodyJSON } from '@/lib/server/api';
import { requireUnsafeRequest, requireAccount, changePassword } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAccount(request);
  const { currentPassword, newPassword, revokeOthers } = await bodyJSON(request, 4096);
  await changePassword(account, currentPassword, newPassword, revokeOthers);
  return json({ ok: true });
});

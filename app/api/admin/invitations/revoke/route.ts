import { route, json, bodyJSON } from '@/lib/server/api';
import { requireAdministrator, requireUnsafeRequest } from '@/lib/server/auth';
import { revokeInvitation } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAdministrator(request);
  const { id, currentPassword } = await bodyJSON(request, 4096);
  await revokeInvitation(account, id, currentPassword);
  return json({ ok: true });
});

import { route, json, bodyJSON } from '@/lib/server/api';
import { requireUnsafeRequest } from '@/lib/server/auth';
import { acceptInvitation } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  return json(await acceptInvitation(await bodyJSON(request, 4096)));
});

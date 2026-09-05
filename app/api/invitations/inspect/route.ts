import { route, json, bodyJSON } from '@/lib/server/api';
import { requireUnsafeRequest } from '@/lib/server/auth';
import { inspectInvitation } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const { token } = await bodyJSON(request, 4096);
  return json(await inspectInvitation(token));
});

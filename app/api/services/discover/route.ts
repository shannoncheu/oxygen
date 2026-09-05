import { bodyJSON, json, route } from '@/lib/server/api';
import { requireAccount, requireUnsafeRequest } from '@/lib/server/auth';
import { discoverService } from '@/lib/server/remote-logo';

export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAccount(request);
  const body = await bodyJSON(request, 4096);
  return json(await discoverService(body.query, account.id));
});

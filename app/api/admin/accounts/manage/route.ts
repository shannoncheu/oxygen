import { route, json, bodyJSON } from '@/lib/server/api';
import { requireAdministrator, requireUnsafeRequest } from '@/lib/server/auth';
import { manageAccount } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAdministrator(request);
  return json(await manageAccount(account, await bodyJSON(request, 4096)));
});

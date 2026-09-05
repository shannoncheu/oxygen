import { route, json } from '@/lib/server/api';
import { requireAdministrator } from '@/lib/server/auth';
import { listAccounts } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const GET = route(async (request) =>
  json(await listAccounts(await requireAdministrator(request))),
);

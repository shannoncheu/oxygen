import { route, json } from '@/lib/server/api';
import { requireAccount } from '@/lib/server/auth';
import { publicAccount } from '@/lib/server/accounts';
export const runtime = 'nodejs';
export const GET = route(async (request) =>
  json({ account: publicAccount(await requireAccount(request)) }),
);

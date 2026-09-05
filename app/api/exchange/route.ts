import { json, route } from '@/lib/server/api';
import { requireAccount } from '@/lib/server/auth';
import { query } from '@/lib/server/db';
import { getExchangeRates } from '@/lib/server/exchange';
import { validateExchangeSettings } from '@/lib/exchange';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = route(async (request) => {
  const account = await requireAccount(request);
  const { rows } = await query('SELECT settings FROM accounts WHERE id=$1', [account.id]);
  const settings = validateExchangeSettings(rows[0]?.settings?.exchange);
  // GET fetches reference data only. The authenticated action saves a chosen snapshot.
  return json(await getExchangeRates(settings.snapshot));
});

import { route, json, business, bodyJSON, APIError } from '@/lib/server/api';
import { requireUnsafeRequest, requireAccount } from '@/lib/server/auth';
import { applyAction } from '@/lib/domain';
import { todayInTimezone } from '@/lib/billing';
import type { Action } from '@/lib/model';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  await requireAccount(request);
  const action = await bodyJSON<Action>(request);
  if (!action || typeof action.type !== 'string') throw new APIError(400, '操作格式无效。');
  return json(
    await business(
      request,
      (data) => applyAction(data, action, todayInTimezone(data.settings.timezone)),
      action.revision,
    ),
  );
});

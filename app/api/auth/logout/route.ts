import { route, json } from '@/lib/server/api';
import {
  requireUnsafeRequest,
  requireAccount,
  logout,
  clearSessionCookie,
} from '@/lib/server/auth';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  await logout(await requireAccount(request));
  const response = json({ ok: true });
  clearSessionCookie(response);
  return response;
});

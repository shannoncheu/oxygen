import { route, json, bodyJSON } from '@/lib/server/api';
import { requireUnsafeRequest, authenticate, setSessionCookie } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const { username, password, remember } = await bodyJSON(request, 4096);
  const session = await authenticate(username, password, remember);
  const response = json({ username: session.username });
  setSessionCookie(response, session.token, session.maxAge);
  return response;
});

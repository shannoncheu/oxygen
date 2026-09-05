import { route, privateHeaders } from '@/lib/server/api';
import { requireAccount } from '@/lib/server/auth';
import { readUpload } from '@/lib/server/uploads';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async (req) => {
    const account = await requireAccount(req);
    const { id } = await context.params;
    return new Response(new Uint8Array(await readUpload(account.id, id)), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  })(request);
}

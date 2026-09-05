import { createAvatar } from '@dicebear/core';
import * as thumbs from '@dicebear/thumbs';
import { route, privateHeaders, APIError } from '@/lib/server/api';
import { requireAccount } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ seed: string }> }) {
  return route(async (req) => {
    await requireAccount(req);
    const { seed } = await context.params;
    if (!seed || seed.length > 160) throw new APIError(400, '头像种子无效。');
    const avatar = createAvatar(thumbs, {
      seed,
      size: 96,
      radius: 50,
      backgroundColor: ['f4d7c8', 'd7e9d9', 'd9def2', 'f3e4bd', 'eadcf2'],
    });
    return new Response(avatar.toString(), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'image/svg+xml',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  })(request);
}

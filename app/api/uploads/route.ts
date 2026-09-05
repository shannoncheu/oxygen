import { route, json, bodyBytes, APIError } from '@/lib/server/api';
import { requireAccount, requireUnsafeRequest } from '@/lib/server/auth';
import { normalizeImage, saveUpload, MAX_IMAGE_BYTES } from '@/lib/server/uploads';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  requireUnsafeRequest(request);
  const account = await requireAccount(request);
  const bytes = await bodyBytes(request, MAX_IMAGE_BYTES + 65536);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') || '' },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    throw new APIError(400, '上传格式无效。');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new APIError(400, '请选择图片。');
  const saved = await saveUpload(
    account.id,
    await normalizeImage(Buffer.from(await file.arrayBuffer())),
  );
  return json({ id: saved.id, url: saved.url });
});

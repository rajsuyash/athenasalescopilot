import { forwardUpload } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const form = await req.formData();
  const upstream = await forwardUpload(env.knowledgeUrl, '/v1/knowledge/upload', form);
  // Stream the upstream body back unchanged.
  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  return new Response(upstream.body, { status: upstream.status, headers });
}

// 50 MB cap matches the knowledge service.
export const config = {
  api: { bodyParser: false },
};

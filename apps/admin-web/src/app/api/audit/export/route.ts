import { serverEnv } from '@/lib/env';
import { getBackendBearer } from '@/lib/api';

export async function GET(req: Request): Promise<Response> {
  const env = serverEnv();
  const bearer = await getBackendBearer();
  if (!bearer) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const url = new URL(req.url);
  const upstream = await fetch(`${env.apiUrl}/v1/audit/export?${url.searchParams.toString()}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  // Pass through content-type + content-disposition so the browser downloads.
  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition'] as const) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

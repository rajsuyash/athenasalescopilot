import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';

export async function GET(req: Request): Promise<Response> {
  const env = serverEnv();
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const url = new URL(req.url);
  const upstream = await fetch(`${env.apiUrl}/v1/audit/export?${url.searchParams.toString()}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  // Pass through content-type + content-disposition so the browser downloads.
  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition'] as const) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

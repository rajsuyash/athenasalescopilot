/**
 * BMC PDF import proxy. Streams the multipart body straight through to
 * knowledge-service so we don't buffer 50 MB PDFs in the admin-web layer.
 */
import { NextResponse } from 'next/server';
import { getBackendBearer } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function POST(req: Request): Promise<Response> {
  const bearer = await getBackendBearer();
  if (!bearer) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const env = serverEnv();
  const url = `${env.knowledgeUrl}/v1/playbooks/bmc/import`;
  const contentType = req.headers.get('content-type') ?? 'multipart/form-data';

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': contentType,
    },
    body: req.body,
    // @ts-expect-error — undici-only field; required when streaming a body.
    duplex: 'half',
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

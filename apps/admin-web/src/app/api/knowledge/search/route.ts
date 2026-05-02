import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function GET(req: Request): Promise<Response> {
  const env = serverEnv();
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const topK = url.searchParams.get('topK');
  if (!q) {
    return NextResponse.json({ error: 'MISSING_QUERY' }, { status: 400 });
  }
  const params = new URLSearchParams({ query: q });
  if (topK) params.set('topK', topK);
  try {
    const r = await callBackend({
      baseUrl: env.knowledgeUrl,
      path: `/v1/knowledge/search?${params.toString()}`,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

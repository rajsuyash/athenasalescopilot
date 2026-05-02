import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { id } = await ctx.params;
  try {
    await callBackend({
      baseUrl: env.knowledgeUrl,
      path: `/v1/knowledge/documents/${encodeURIComponent(id)}`,
      method: 'DELETE',
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

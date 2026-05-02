import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

interface Ctx {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { id, versionId } = await ctx.params;
  try {
    const r = await callBackend({
      baseUrl: env.apiUrl,
      path: `/v1/scripts/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/publish`,
      method: 'POST',
      body: {},
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

const ALLOWED = new Set(['adoption', 'objections', 'quality', 'coverage', 'latency']);

interface Ctx {
  params: Promise<{ kind: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { kind } = await ctx.params;
  if (!ALLOWED.has(kind)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  try {
    const r = await callBackend({
      baseUrl: env.analyticsUrl,
      path: `/v1/analytics/${kind}`,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

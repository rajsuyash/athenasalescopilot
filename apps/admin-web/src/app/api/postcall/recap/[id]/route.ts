import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { id } = await ctx.params;
  try {
    const r = await callBackend({
      baseUrl: env.postcallUrl,
      path: `/v1/postcall/meetings/${encodeURIComponent(id)}/recap`,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      // Pass through 404 NO_SUMMARY so the UI can render an empty state.
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    const r = await callBackend({
      baseUrl: env.postcallUrl,
      path: `/v1/postcall/meetings/${encodeURIComponent(id)}/recap`,
      method: 'POST',
      body,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

const GET_ALLOWED = new Set(['subscription', 'usage']);
const POST_ALLOWED = new Set(['checkout', 'portal', 'mock-upgrade']);

interface Ctx {
  params: Promise<{ action: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { action } = await ctx.params;
  if (!GET_ALLOWED.has(action)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  try {
    const r = await callBackend({
      baseUrl: env.billingUrl,
      path: `/v1/billing/${action}`,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const env = serverEnv();
  const { action } = await ctx.params;
  if (!POST_ALLOWED.has(action)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  // Map "mock-upgrade" → "mock/upgrade" on the backend.
  const path = action === 'mock-upgrade' ? '/v1/billing/mock/upgrade' : `/v1/billing/${action}`;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await callBackend({
      baseUrl: env.billingUrl,
      path,
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

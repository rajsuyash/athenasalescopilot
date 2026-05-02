import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function GET(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend({
      baseUrl: env.apiUrl,
      path: '/v1/workspaces/me/retention',
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const env = serverEnv();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await callBackend({
      baseUrl: env.apiUrl,
      path: '/v1/workspaces/me/retention',
      method: 'PATCH',
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

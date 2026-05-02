import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function GET(req: Request): Promise<Response> {
  const env = serverEnv();
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  try {
    const r = await callBackend({
      baseUrl: env.apiUrl,
      path: `/v1/audit/facets${qs ? `?${qs}` : ''}`,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

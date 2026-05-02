import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function GET(): Promise<Response> {
  const env = serverEnv();
  try {
    const me = await callBackend({ baseUrl: env.apiUrl, path: '/v1/auth/me' });
    return NextResponse.json(me);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

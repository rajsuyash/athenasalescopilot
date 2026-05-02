import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function GET(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend({
      baseUrl: env.knowledgeUrl,
      path: '/v1/knowledge/documents',
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

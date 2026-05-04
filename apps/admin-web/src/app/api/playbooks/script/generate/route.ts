/**
 * Script generator trigger proxy. Takes no body — server reads the
 * workspace's saved BMC and generates a script from it. Returns the
 * created collection id so the UI can deep-link to /scripts/<id>.
 */
import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function POST(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend({
      baseUrl: env.knowledgeUrl,
      path: '/v1/playbooks/script/generate-from-bmc',
      method: 'POST',
      body: {},
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.code, message: err.message, details: err.details },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'INTERNAL', message: String(err) }, { status: 500 });
  }
}

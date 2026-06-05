/**
 * Objection-matrix proxy (wizard Step 3).
 *   POST → generate + index the BMC-specific objection→solution matrix, returns
 *          the grounded entries to display.
 *   GET  → read the current matrix for display / resume.
 * Both forward the Clerk bearer to knowledge-service via callBackend.
 */
import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function POST(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend({
      baseUrl: env.knowledgeUrl,
      path: '/v1/playbooks/objection-matrix/generate',
      method: 'POST',
      body: {},
    });
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend({
      baseUrl: env.knowledgeUrl,
      path: '/v1/playbooks/objection-matrix',
    });
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.code, message: err.message, details: err.details },
      { status: err.status },
    );
  }
  return NextResponse.json({ error: 'INTERNAL', message: String(err) }, { status: 500 });
}

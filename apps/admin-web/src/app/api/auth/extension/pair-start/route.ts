/**
 * Mint a Chrome extension pairing code on behalf of the signed-in admin-web
 * user. Backend (services/api) returns the raw code ONCE — we forward it
 * straight back to the page for one-shot display, never persist it client-
 * side. Closes the Google-OAuth gap: Clerk users have no email+password to
 * type into the extension popup.
 */
import { NextResponse } from 'next/server';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';

export async function POST(): Promise<Response> {
  const env = serverEnv();
  try {
    const r = await callBackend<{ code: string; expiresAt: string }>({
      baseUrl: env.apiUrl,
      path: '/v1/auth/extension/pair-start',
      method: 'POST',
      body: {},
    });
    return NextResponse.json(r, { status: 201 });
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

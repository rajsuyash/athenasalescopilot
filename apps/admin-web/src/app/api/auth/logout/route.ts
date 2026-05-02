import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { clearSession, getSession } from '@/lib/session';

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const session = await getSession();
  if (session?.refreshToken) {
    try {
      await fetch(`${env.apiUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    } catch {
      // best effort
    }
  }
  await clearSession();
  return NextResponse.redirect(new URL('/signin', req.url), 303);
}

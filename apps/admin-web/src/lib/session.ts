/**
 * httpOnly session cookie helpers. The cookie holds the access + refresh
 * tokens issued by the api service. Never written to localStorage and never
 * exposed to client-side JS — every authenticated call goes through a Next.js
 * route handler that reads the cookie server-side and forwards a Bearer token.
 */
import { cookies } from 'next/headers';

const COOKIE_NAME = 'athena_session';
const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d (refresh token TTL); access auto-rotates

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
  expiresAt: string;
}

export async function getSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionData;
    if (!parsed.accessToken || !parsed.workspaceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSession(data: SessionData): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: JSON.stringify(data),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set({ name: COOKIE_NAME, value: '', maxAge: 0, path: '/' });
}

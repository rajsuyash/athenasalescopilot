/**
 * Session helper — Clerk owns identity. We expose a thin getSession() that
 * returns Clerk's session token plus the userId. Existing pages that called
 * getSession() to gate access keep working with no signature changes.
 *
 * setSession / clearSession are removed — Clerk's middleware sets and
 * clears the cookie on /signin, /signup, and /sign-out flows automatically.
 */
import { auth } from '@clerk/nextjs/server';

export interface SessionData {
  /** Short-lived JWT signed by Clerk. Pass as Bearer to backend services
   *  that have the @clerk/backend verifier wired up. */
  accessToken: string;
  /** Stable Clerk user id (e.g. user_2abc...). */
  userId: string;
}

export async function getSession(): Promise<SessionData | null> {
  const a = await auth();
  if (!a.userId) return null;
  // Clerk JWT — backend services verify against Clerk's JWKS.
  const token = await a.getToken();
  if (!token) return null;
  return { accessToken: token, userId: a.userId };
}

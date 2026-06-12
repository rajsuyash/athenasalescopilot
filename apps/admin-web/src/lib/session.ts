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
  /**
   * Short-lived JWT signed by Clerk (RS256). ONLY the api service verifies
   * these (via its preVerify hook) — every other backend service rejects them
   * with FAST_JWT_INVALID_ALGORITHM. For backend calls use
   * `getBackendBearer()` from lib/api.ts, which exchanges this for the HMAC
   * token all services accept. Use this field only for Clerk-facing needs.
   */
  accessToken: string;
  /** Stable Clerk user id (e.g. user_2abc...). */
  userId: string;
}

export async function getSession(): Promise<SessionData | null> {
  const a = await auth();
  if (!a.userId) return null;
  const token = await a.getToken();
  if (!token) return null;
  return { accessToken: token, userId: a.userId };
}

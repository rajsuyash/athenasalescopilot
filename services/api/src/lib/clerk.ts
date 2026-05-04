/**
 * Clerk JWT verifier (Block T).
 *
 * Verifies a Clerk session JWT using their official @clerk/backend SDK
 * (JWKS-backed RSA verification). Returns the Clerk user id on success.
 *
 * The auth plugin tries this verifier first; falls back to legacy HMAC
 * (used by chrome extension + realtime gateway during the Block T
 * migration window). Once everything is on Clerk, the HMAC path can
 * be deleted.
 */
import { createClerkClient, verifyToken } from '@clerk/backend';

interface ClerkConfig {
  secretKey: string;
  publishableKey?: string;
}

let cachedConfig: ClerkConfig | null = null;

export function configureClerk(cfg: ClerkConfig): void {
  cachedConfig = cfg;
}

export interface ClerkVerified {
  clerkUserId: string;
  email: string | null;
  /** Raw payload — useful for diagnostics; never trust without re-verification. */
  payload: Record<string, unknown>;
}

/** Verify a Clerk-issued JWT. Returns null when the token isn't a valid
 *  Clerk JWT (caller should fall back to HMAC verification). Throws only
 *  when Clerk is misconfigured (no secret key). */
export async function verifyClerkToken(token: string): Promise<ClerkVerified | null> {
  if (!cachedConfig?.secretKey) return null;
  // Cheap pre-check: Clerk session tokens are JWTs whose iss starts with
  // https://clerk. or contains "clerk." — saves a network call when the
  // token is clearly our legacy HMAC format.
  if (!isLikelyClerkJwt(token)) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: cachedConfig.secretKey,
    });
    if (!payload.sub) return null;
    const email = typeof payload.email === 'string' ? payload.email : null;
    return {
      clerkUserId: String(payload.sub),
      email,
      payload: payload as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function isLikelyClerkJwt(token: string): boolean {
  // JWT = three base64url segments. We peek the payload segment for an iss
  // claim that matches Clerk. Don't trust this — it's a routing hint only.
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const json = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      iss?: string;
    };
    return typeof json.iss === 'string' && /clerk\./i.test(json.iss);
  } catch {
    return false;
  }
}

/** Get the @clerk/backend client (e.g. for users.getUser, users.createUser).
 *  Throws if Clerk isn't configured — call sites should guard accordingly. */
export function clerkClient() {
  if (!cachedConfig?.secretKey) {
    throw new Error('Clerk not configured — set CLERK_SECRET_KEY env var');
  }
  return createClerkClient({ secretKey: cachedConfig.secretKey });
}

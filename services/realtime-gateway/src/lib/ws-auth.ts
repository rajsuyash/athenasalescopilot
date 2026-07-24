/**
 * WebSocket token verification for the gateway. Delegates classification to the
 * single source (@athena/auth) so it can finally distinguish expired-vs-invalid
 * — the old `verifyTokenString(): T | null` discarded that, which is why the WS
 * path could never signal TOKEN_EXPIRED (2026-06-04 incident, defect D6/D7).
 *
 * For server→server calls at end-of-call (postcall recap, meeting end) the
 * gateway MUST NOT forward the client's WS token: a 40-minute call outlives the
 * 15-minute access-token TTL, so the forwarded token 401'd (recap silently
 * broken in prod). Instead mint a fresh short-lived s2s token from the verified
 * claims — see `mintServiceToken`.
 *
 * Query-string token transport (`?token=…`) is NOT supported — URLs leak into
 * history, DevTools, and proxy logs. Supported transports:
 *   1. `Authorization: Bearer <token>` header (server-side callers).
 *   2. First-frame `{type:"auth", token}` control message (browser clients) —
 *      handled in modules/session/handler.ts.
 */
import '@fastify/jwt'; // side-effect: brings the app.jwt type augmentation into scope
import type { FastifyInstance } from 'fastify';
import { verifyTokenString as classifyToken, type AccessTokenClaims } from '@athena/auth';

export type { AccessTokenClaims };

export interface VerifiedToken {
  claims: AccessTokenClaims;
}

export type WsAuthResult =
  | { ok: true; verified: VerifiedToken }
  | { ok: false; code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' };

export function verifyTokenString(app: FastifyInstance, token: string): WsAuthResult {
  if (!token) return { ok: false, code: 'TOKEN_INVALID' };
  const r = classifyToken(app, token);
  if (!r.ok) return { ok: false, code: r.code };
  return { ok: true, verified: { claims: r.claims } };
}

/**
 * Mint a fresh, short-lived HMAC token for a server→server call, re-signing the
 * session's verified claims. All services share `JWT_ACCESS_SECRET`, so this
 * token verifies downstream; preserving `workspaceId` + `role` keeps RBAC
 * identical to the original client token (F10). Default TTL comfortably covers
 * end-of-call work without letting the token linger.
 */
export function mintServiceToken(
  app: FastifyInstance,
  claims: AccessTokenClaims,
  ttlSeconds = 300,
): string {
  return app.jwt.sign(
    {
      sub: claims.sub,
      workspaceId: claims.workspaceId,
      role: claims.role,
      membershipId: claims.membershipId,
    },
    { expiresIn: `${ttlSeconds}s` },
  );
}

export function verifyWsToken(app: FastifyInstance, authHeader: string | undefined): WsAuthResult {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, code: 'TOKEN_INVALID' };
  return verifyTokenString(app, authHeader.slice(7));
}

/**
 * WebSocket token verification for the gateway. Delegates classification to the
 * single source (@athena/auth) so it can finally distinguish expired-vs-invalid
 * — the old `verifyTokenString(): T | null` discarded that, which is why the WS
 * path could never signal TOKEN_EXPIRED (2026-06-04 incident, defect D6/D7).
 *
 * Adds the `raw` bearer string the gateway needs for server→server tenant
 * propagation (e.g. postcall recap), which the shared verifier doesn't carry.
 *
 * Query-string token transport (`?token=…`) is NOT supported — URLs leak into
 * history, DevTools, and proxy logs. Supported transports:
 *   1. `Authorization: Bearer <token>` header (server-side callers).
 *   2. First-frame `{type:"auth", token}` control message (browser clients) —
 *      handled in modules/session/handler.ts.
 */
import type { FastifyInstance } from 'fastify';
import { verifyTokenString as classifyToken, type AccessTokenClaims } from '@athena/auth';

export type { AccessTokenClaims };

export interface VerifiedToken {
  claims: AccessTokenClaims;
  /** Raw bearer string — propagated on server→server calls that must carry tenant. */
  raw: string;
}

export type WsAuthResult =
  | { ok: true; verified: VerifiedToken }
  | { ok: false; code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' };

export function verifyTokenString(app: FastifyInstance, token: string): WsAuthResult {
  if (!token) return { ok: false, code: 'TOKEN_INVALID' };
  const r = classifyToken(app, token);
  if (!r.ok) return { ok: false, code: r.code };
  return { ok: true, verified: { claims: r.claims, raw: token } };
}

export function verifyWsToken(app: FastifyInstance, authHeader: string | undefined): WsAuthResult {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, code: 'TOKEN_INVALID' };
  return verifyTokenString(app, authHeader.slice(7));
}

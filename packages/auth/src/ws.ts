import type { FastifyInstance } from 'fastify';
import { classifyJwtError, type AuthErrorCode } from './classify.js';
import type { AccessTokenClaims } from './claims.js';

/**
 * Result of verifying a raw token string on the WebSocket path. Unlike the old
 * `verifyTokenString(): T | null` (which discarded expired-vs-invalid before it
 * left the function — the gateway blind spot), this returns the classification
 * so the handler can emit a refreshable TOKEN_EXPIRED signal.
 */
export type WsVerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; code: Extract<AuthErrorCode, 'TOKEN_EXPIRED' | 'TOKEN_INVALID'> };

/**
 * Verify a bare JWT string (WS first-frame / handshake). app.jwt.verify is
 * synchronous; we classify any throw and require the workspaceId claim (F10).
 */
export function verifyTokenString(app: FastifyInstance, token: string): WsVerifyResult {
  try {
    const claims = app.jwt.verify(token) as AccessTokenClaims;
    if (!claims.workspaceId) return { ok: false, code: 'TOKEN_INVALID' };
    return { ok: true, claims };
  } catch (err) {
    const c = classifyJwtError(err);
    return { ok: false, code: c.code };
  }
}

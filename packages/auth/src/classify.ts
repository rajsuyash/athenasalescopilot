import { isExpiredJwtCode } from './codes.js';

/**
 * Auth error code returned to clients. TOKEN_EXPIRED is the *refreshable* signal
 * the client acts on (refresh + retry); TOKEN_INVALID means re-authenticate;
 * MISSING_WORKSPACE_CLAIM is a malformed-but-verified token (PRD F10).
 */
export type AuthErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'MISSING_WORKSPACE_CLAIM';

/**
 * Thrown by the shared auth plugin / WS verifier. Shape mirrors the
 * `Object.assign(new Error(), { statusCode, code, details })` errors the
 * services already produced, so existing global error handlers serialize it
 * unchanged.
 */
export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: AuthErrorCode;
  readonly details?: { jwtCode?: string; hint?: string };

  constructor(code: AuthErrorCode, message: string, details?: { jwtCode?: string; hint?: string }) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
    this.code = code;
    if (details) this.details = details;
  }
}

export interface ClassifiedJwtError {
  code: Exclude<AuthErrorCode, 'MISSING_WORKSPACE_CLAIM'>;
  status: 401;
  jwtCode: string | undefined;
  hint: string | undefined;
}

/**
 * The ONE place token-verification errors are classified expired-vs-invalid.
 * Pure (no fastify/IO), so it is exhaustively unit-tested and cannot diverge
 * per service. Callers turn the result into an AuthError (HTTP) or a WS frame.
 */
export function classifyJwtError(err: unknown): ClassifiedJwtError {
  const jwtCode = (err as { code?: string } | null)?.code;
  const hint = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined;
  if (isExpiredJwtCode(jwtCode)) {
    return { code: 'TOKEN_EXPIRED', status: 401, jwtCode, hint };
  }
  return { code: 'TOKEN_INVALID', status: 401, jwtCode, hint };
}

/** Convenience: classify then wrap as an AuthError ready to throw. */
export function toAuthError(err: unknown): AuthError {
  const c = classifyJwtError(err);
  const message = c.code === 'TOKEN_EXPIRED' ? 'Token has expired.' : 'Token is invalid.';
  const details: { jwtCode?: string; hint?: string } = {};
  if (c.jwtCode) details.jwtCode = c.jwtCode;
  if (c.hint) details.hint = c.hint;
  return new AuthError(c.code, message, Object.keys(details).length ? details : undefined);
}

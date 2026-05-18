import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import type { Role } from '@athena/shared-types';

export interface AccessTokenClaims {
  sub: string;
  workspaceId: string;
  role: Role;
  membershipId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenClaims;
    requireAuth(): Promise<AccessTokenClaims>;
    requirePermission(p: Permission): Promise<AccessTokenClaims>;
  }
}

export const authPlugin = fp<{ secret: string }>(async (app: FastifyInstance, opts) => {
  await app.register(fjwt, {
    secret: { private: opts.secret, public: opts.secret },
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });
  app.decorateRequest('auth', undefined);
  app.decorateRequest('requireAuth', async function (this: FastifyRequest) {
    try {
      const claims = (await this.jwtVerify()) as AccessTokenClaims;
      if (!claims.workspaceId) {
        throw Object.assign(new Error('MISSING_WORKSPACE_CLAIM'), {
          statusCode: 401,
          code: 'MISSING_WORKSPACE_CLAIM',
        });
      }
      this.auth = claims;
      return claims;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // @fastify/jwt expired-token code is FST_JWT_AUTHORIZATION_TOKEN_EXPIRED.
      // The original FAST_JWT_EXPIRED check was a typo (that's @fast-jwt's
      // code), so expired tokens were misclassified as TOKEN_INVALID and
      // the chrome ext's refresh logic couldn't distinguish "go refresh"
      // from "credentials genuinely bad — sign in again". Caught in /uat
      // live test 2026-05-18.
      if (
        code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
        code === 'FAST_JWT_EXPIRED'
      ) {
        throw Object.assign(new Error('TOKEN_EXPIRED'), { statusCode: 401, code: 'TOKEN_EXPIRED' });
      }
      throw Object.assign(new Error('TOKEN_INVALID'), { statusCode: 401, code: 'TOKEN_INVALID' });
    }
  });
  app.decorateRequest('requirePermission', async function (
    this: FastifyRequest,
    permission: Permission,
  ) {
    const claims = this.auth ?? (await this.requireAuth());
    if (!can(claims.role, permission)) {
      const required = minimumRoleFor(permission) ?? 'admin';
      throw Object.assign(new Error('INSUFFICIENT_ROLE'), {
        statusCode: 403,
        code: 'INSUFFICIENT_ROLE',
        details: { required },
      });
    }
    return claims;
  });
});

/**
 * WebSocket auth: verify a JWT taken from the `Authorization` header.
 *
 * Query-string token transport (`?token=…`, `?access_token=…`) was REMOVED
 * because URLs land in browser history, DevTools Network panels, and
 * reverse-proxy access logs — handing 15-min bearer tokens to anyone who can
 * read those. The supported transports are now:
 *
 *   1. `Authorization: Bearer <token>` HTTP header — used by server-side
 *      callers (CLI, integration tests) that control the WS upgrade headers.
 *   2. First-frame control message `{type:"auth", token}` — used by the
 *      browser WebSocket API which can't set custom headers. Handled in
 *      `modules/session/handler.ts` via `verifyTokenString()` (below).
 *
 * Returns null on failure; the caller closes the socket.
 */
export interface VerifiedToken {
  claims: AccessTokenClaims;
  /** Raw bearer string. Used for server→server calls that must propagate tenant. */
  raw: string;
}

export function verifyWsToken(
  app: FastifyInstance,
  authHeader: string | undefined,
): VerifiedToken | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyTokenString(app, authHeader.slice(7));
}

/**
 * Stand-alone token verification used by the first-frame `auth` handshake.
 * Same behavior as verifyWsToken minus the header parsing.
 */
export function verifyTokenString(app: FastifyInstance, token: string): VerifiedToken | null {
  if (!token) return null;
  try {
    const claims = app.jwt.verify(token) as AccessTokenClaims;
    if (!claims.workspaceId) return null;
    return { claims, raw: token };
  } catch {
    return null;
  }
}

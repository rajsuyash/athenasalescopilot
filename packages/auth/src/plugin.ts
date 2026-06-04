import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import { AuthError, toAuthError } from './classify.js';
import type { AccessTokenClaims } from './claims.js';

export interface AuthPluginOptions {
  /** HMAC secret for legacy access tokens. */
  secret: string;
  /** Sign TTL (only services that *issue* tokens need this, e.g. api). */
  accessTtl?: string;
  /**
   * Optional pre-verify hook, run BEFORE HMAC verify. The api uses it for Clerk
   * session JWTs. Contract:
   *   - return claims → use them, skip HMAC
   *   - return null   → fall through to HMAC verify
   *   - throw         → surfaces as-is
   * The hook MUST swallow its own provider errors and return null rather than
   * throw on a provider outage, so a Clerk hiccup can't kill legacy-token auth.
   */
  preVerify?: (req: FastifyRequest) => Promise<AccessTokenClaims | null>;
}

/**
 * The ONE auth plugin every service registers (replacing 8 hand-copied copies).
 * Verifies tokens, classifies expired-vs-invalid via the single classifier, and
 * enforces RBAC. There is no per-service auth code left to drift.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, opts) => {
  await app.register(fjwt, {
    secret: { private: opts.secret, public: opts.secret },
    sign: opts.accessTtl
      ? { algorithm: 'HS256', expiresIn: opts.accessTtl }
      : { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorateRequest('auth', undefined);

  app.decorateRequest('requireAuth', async function (this: FastifyRequest) {
    // 1. Optional provider pre-verify (Clerk on api).
    if (opts.preVerify) {
      const pre = await opts.preVerify(this);
      if (pre) {
        if (!pre.workspaceId) {
          throw new AuthError('MISSING_WORKSPACE_CLAIM', 'Missing workspace claim.');
        }
        this.auth = pre;
        return pre;
      }
    }
    // 2. Legacy HMAC verify (chrome extension + realtime gateway + s2s).
    try {
      const claims = (await this.jwtVerify()) as AccessTokenClaims;
      if (!claims.workspaceId) {
        throw new AuthError('MISSING_WORKSPACE_CLAIM', 'Missing workspace claim.');
      }
      this.auth = claims;
      return claims;
    } catch (err) {
      if (err instanceof AuthError) throw err; // our own (e.g. missing claim) — pass through
      throw toAuthError(err); // classify expired-vs-invalid in one place
    }
  });

  app.decorateRequest(
    'requirePermission',
    async function (this: FastifyRequest, permission: Permission) {
      const claims = this.auth ?? (await this.requireAuth());
      if (!can(claims.role, permission)) {
        const required = minimumRoleFor(permission) ?? 'admin';
        // Matches the existing services' INSUFFICIENT_ROLE error shape so global
        // error handlers serialize it unchanged.
        throw Object.assign(new Error('INSUFFICIENT_ROLE'), {
          statusCode: 403,
          code: 'INSUFFICIENT_ROLE',
          details: { required },
        });
      }
      return claims;
    },
  );
});

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenClaims;
    requireAuth(): Promise<AccessTokenClaims>;
    requirePermission(p: Permission): Promise<AccessTokenClaims>;
  }
}

import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import { Errors } from '../lib/errors.js';
import type { AccessTokenClaims } from '../lib/types.js';

interface AuthOpts {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
}

/**
 * Auth plugin: registers @fastify/jwt + helpers.
 * - `request.requireAuth()` — verifies JWT, returns claims, throws on fail.
 * - `request.requirePermission(p)` — verifies + checks RBAC.
 *
 * PRD F10: every authenticated request must carry a workspaceId claim.
 */
export const authPlugin = fp<AuthOpts>(async (app: FastifyInstance, opts) => {
  await app.register(fjwt, {
    secret: { private: opts.accessSecret, public: opts.accessSecret },
    sign: { algorithm: 'HS256', expiresIn: opts.accessTtl },
    verify: { algorithms: ['HS256'] },
  });

  app.decorateRequest('auth', undefined);

  app.decorateRequest('requireAuth', async function (this: FastifyRequest) {
    try {
      const claims = (await this.jwtVerify()) as AccessTokenClaims;
      if (!claims.workspaceId) throw Errors.missingWorkspaceClaim();
      this.auth = claims;
      return claims;
    } catch (err) {
      if ((err as { code?: string }).code === 'FAST_JWT_EXPIRED') throw Errors.tokenExpired();
      if (err instanceof Error && err.message.includes('MISSING_WORKSPACE_CLAIM')) throw err;
      throw Errors.tokenInvalid();
    }
  });

  app.decorateRequest(
    'requirePermission',
    async function (this: FastifyRequest, permission: Permission) {
      const claims = this.auth ?? (await this.requireAuth());
      if (!can(claims.role, permission)) {
        const required = minimumRoleFor(permission) ?? 'admin';
        throw Errors.insufficientRole(required);
      }
      return claims;
    },
  );
});

declare module 'fastify' {
  interface FastifyRequest {
    requireAuth(): Promise<AccessTokenClaims>;
    requirePermission(p: Permission): Promise<AccessTokenClaims>;
  }
}

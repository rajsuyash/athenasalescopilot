import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import type { Role } from '@athena/shared-types';

interface AccessTokenClaims {
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
      // The original FAST_JWT_EXPIRED check was a typo carried over from
      // @fast-jwt — it never fired, so expired tokens were misclassified
      // as TOKEN_INVALID. Caught in /uat live test 2026-05-18.
      if (
        code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
        code === 'FAST_JWT_EXPIRED'
      ) {
        throw Object.assign(new Error('TOKEN_EXPIRED'), { statusCode: 401, code: 'TOKEN_EXPIRED' });
      }
      if (code === 'MISSING_WORKSPACE_CLAIM') throw err;
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

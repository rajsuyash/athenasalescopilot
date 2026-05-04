import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import { prisma } from '@athena/db';
import { Errors } from '../lib/errors.js';
import type { AccessTokenClaims } from '../lib/types.js';
import { verifyClerkToken } from '../lib/clerk.js';

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
 * Block T: tries Clerk JWT verification first (admin-web flows). Falls
 * back to legacy HMAC (chrome extension + realtime gateway during the
 * migration window). When a Clerk token verifies, we look up the
 * matching Athena user via clerk_user_id, fetch their workspace
 * membership, and synthesize an AccessTokenClaims for downstream RBAC.
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
    // 1. Try Clerk first — admin-web sends Clerk session JWTs as Bearer.
    const bearer = (this.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (bearer) {
      const clerk = await verifyClerkToken(bearer);
      if (clerk) {
        const synthesized = await synthesizeFromClerk(clerk.clerkUserId, clerk.email);
        if (synthesized) {
          this.auth = synthesized;
          return synthesized;
        }
        // Token verified but no matching Athena user — they signed up via
        // Clerk but the webhook hasn't created the workspace yet (race).
        throw Errors.tokenInvalid();
      }
    }
    // 2. Fall back to legacy HMAC (chrome extension + realtime gateway).
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

  async function synthesizeFromClerk(
    clerkUserId: string,
    fallbackEmail: string | null,
  ): Promise<AccessTokenClaims | null> {
    const user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: {
        id: true,
        memberships: {
          where: { status: 'active' },
          select: { id: true, workspaceId: true, role: true },
          take: 1,
        },
      },
    });
    if (!user) return null;
    const membership = user.memberships[0];
    if (!membership) return null;
    void fallbackEmail;
    return {
      sub: user.id,
      workspaceId: membership.workspaceId,
      role: membership.role as AccessTokenClaims['role'],
      membershipId: membership.id,
    };
  }

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

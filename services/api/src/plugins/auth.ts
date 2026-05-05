import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@athena/policies';
import { can, minimumRoleFor } from '@athena/policies';
import { prisma } from '@athena/db';
import { Errors } from '../lib/errors.js';
import type { AccessTokenClaims } from '../lib/types.js';
import { verifyClerkToken, clerkClient } from '../lib/clerk.js';

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

  /**
   * Resolve a verified Clerk identity into an AccessTokenClaims pair our
   * downstream code understands. Self-heals three failure modes:
   *
   *   1. Webhook hasn't fired yet (race between Clerk signup → first
   *      authenticated request). The User row simply doesn't exist.
   *   2. Webhook delivery failed (transient / misconfigured secret). Same
   *      symptom as (1).
   *   3. The user pre-dated the Clerk migration — there's an Athena User
   *      with their email but no clerkUserId. Pair them up.
   *
   * Without this, the admin-web dashboard would hit /v1/auth/me, get 401,
   * redirect to /signin, Clerk sees the live session, redirects back to
   * /dashboard — infinite loop. The webhook is best-effort; the request
   * path is the source of truth.
   */
  async function synthesizeFromClerk(
    clerkUserId: string,
    fallbackEmail: string | null,
  ): Promise<AccessTokenClaims | null> {
    let user = await prisma.user.findUnique({
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

    if (!user) {
      // Provision: pair an existing email-matched user, or create a fresh
      // user + default workspace + owner membership.
      const provisioned = await provisionFromClerk(clerkUserId, fallbackEmail);
      if (!provisioned) return null;
      user = provisioned;
    }

    let membership = user.memberships[0];
    if (!membership) {
      // User row exists but has no active membership — create a default
      // workspace owned by them. Happens for legacy email-paired users.
      membership = await ensureDefaultWorkspace(user.id);
    }

    return {
      sub: user.id,
      workspaceId: membership.workspaceId,
      role: membership.role as AccessTokenClaims['role'],
      membershipId: membership.id,
    };
  }

  type ProvisionedUser = {
    id: string;
    memberships: Array<{ id: string; workspaceId: string; role: string }>;
  };

  async function provisionFromClerk(
    clerkUserId: string,
    fallbackEmail: string | null,
  ): Promise<ProvisionedUser | null> {
    // Resolve email + name. Prefer the value from the verified JWT; fall
    // back to a Clerk API lookup when the token didn't carry email (some
    // OAuth provider configurations omit it).
    let email = fallbackEmail;
    let name = '';
    if (!email) {
      try {
        const clerkUser = await clerkClient().users.getUser(clerkUserId);
        email =
          clerkUser.emailAddresses.find(
            (e) => e.id === clerkUser.primaryEmailAddressId,
          )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null;
        name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim();
      } catch (err) {
        app.log.warn({ err, clerkUserId }, 'clerk user lookup failed during provision');
        return null;
      }
    }
    if (!email) return null;
    if (!name) name = email.split('@')[0] ?? 'New user';

    // Path A — pair an existing email-matched user (legacy migration).
    const byEmail = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        memberships: {
          where: { status: 'active' },
          select: { id: true, workspaceId: true, role: true },
          take: 1,
        },
      },
    });
    if (byEmail) {
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { clerkUserId },
      });
      return byEmail;
    }

    // Path B — brand new. Create User + default Workspace + owner Membership
    // in a single transaction so a partial provision can never leave the
    // user in a half-created state.
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: email as string, name, clerkUserId },
      });
      const slug = `ws-${user.id.slice(0, 8)}`;
      const workspace = await tx.workspace.create({
        data: { name: `${name}'s workspace`, slug },
      });
      const membership = await tx.userWorkspaceMembership.create({
        data: { userId: user.id, workspaceId: workspace.id, role: 'owner' },
      });
      return {
        id: user.id,
        memberships: [{ id: membership.id, workspaceId: workspace.id, role: membership.role }],
      };
    });
    app.log.info({ userId: result.id, clerkUserId }, 'provisioned new athena user from clerk');
    return result;
  }

  async function ensureDefaultWorkspace(
    userId: string,
  ): Promise<{ id: string; workspaceId: string; role: string }> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    });
    const result = await prisma.$transaction(async (tx) => {
      const slug = `ws-${userId.slice(0, 8)}`;
      const workspace = await tx.workspace.create({
        data: { name: `${user.name}'s workspace`, slug },
      });
      const membership = await tx.userWorkspaceMembership.create({
        data: { userId, workspaceId: workspace.id, role: 'owner' },
      });
      return { id: membership.id, workspaceId: workspace.id, role: membership.role };
    });
    app.log.info({ userId, workspaceId: result.workspaceId }, 'auto-created default workspace');
    return result;
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

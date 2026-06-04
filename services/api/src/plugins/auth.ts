import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { authPlugin as sharedAuthPlugin } from '@athena/auth';
import type { AccessTokenClaims } from '@athena/auth';
import { prisma } from '@athena/db';
import { verifyClerkToken, clerkClient } from '../lib/clerk.js';

interface AuthOpts {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
}

/**
 * api auth plugin.
 *
 * Block T: admin-web sends Clerk session JWTs; the chrome extension + realtime
 * gateway send legacy HMAC tokens. We register the shared @athena/auth plugin
 * (the single source of expired-vs-invalid classification + RBAC) and feed it a
 * Clerk `preVerify` hook that runs BEFORE HMAC. This keeps Clerk working while
 * deleting the api's hand-rolled JWT verification — so the api can no longer
 * drift from the other services' token-error handling (2026-06-04 incident).
 *
 * The preVerify hook MUST swallow its own errors and return null (never throw)
 * so a Clerk outage falls through to HMAC rather than killing all auth.
 *
 * AuthError thrown by the shared plugin is serialized by the global error
 * handler (errorHandlerPlugin) via its `statusCode && code` branch — producing
 * the same `{error:'TOKEN_EXPIRED', message:'Token has expired.'}` shape the api
 * always returned, so clients that parse `body.error`/`body.message` are
 * unaffected.
 */
export const authPlugin = fp<AuthOpts>(async (app: FastifyInstance, opts) => {
  await app.register(sharedAuthPlugin, {
    secret: opts.accessSecret,
    accessTtl: opts.accessTtl,
    preVerify: (req) => clerkPreVerify(req),
  });
});

/**
 * Try to authenticate via a Clerk session JWT. Returns synthesized claims on
 * success, or null to fall through to HMAC. Never throws — any Clerk/provision
 * failure resolves to null so legacy-token auth keeps working during a Clerk
 * outage (and an unprovisionable Clerk token then fails HMAC → TOKEN_INVALID,
 * the same response as before).
 */
async function clerkPreVerify(req: FastifyRequest): Promise<AccessTokenClaims | null> {
  try {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!bearer) return null;
    const clerk = await verifyClerkToken(bearer);
    if (!clerk) return null;
    return await synthesizeFromClerk(req.log, clerk.clerkUserId, clerk.email);
  } catch (err) {
    req.log.warn({ err }, 'clerk preVerify failed — falling through to HMAC');
    return null;
  }
}

/**
 * Resolve a verified Clerk identity into AccessTokenClaims. Self-heals three
 * failure modes: webhook race, webhook delivery failure, and pre-Clerk-migration
 * email-only users. Without this, admin-web's /v1/auth/me would 401-loop.
 */
async function synthesizeFromClerk(
  log: FastifyBaseLogger,
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
    const provisioned = await provisionFromClerk(log, clerkUserId, fallbackEmail);
    if (!provisioned) return null;
    user = provisioned;
  }

  let membership = user.memberships[0];
  if (!membership) {
    membership = await ensureDefaultWorkspace(log, user.id);
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
  log: FastifyBaseLogger,
  clerkUserId: string,
  fallbackEmail: string | null,
): Promise<ProvisionedUser | null> {
  let email = fallbackEmail;
  let name = '';
  if (!email) {
    try {
      const clerkUser = await clerkClient().users.getUser(clerkUserId);
      email =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        null;
      name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim();
    } catch (err) {
      log.warn({ err, clerkUserId }, 'clerk user lookup failed during provision');
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
    await prisma.user.update({ where: { id: byEmail.id }, data: { clerkUserId } });
    return byEmail;
  }

  // Path B — brand new. User + default Workspace + owner Membership in one tx.
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: email as string, name, clerkUserId },
    });
    const slug = `ws-${created.id.slice(0, 8)}`;
    const workspace = await tx.workspace.create({
      data: { name: `${name}'s workspace`, slug },
    });
    const membership = await tx.userWorkspaceMembership.create({
      data: { userId: created.id, workspaceId: workspace.id, role: 'owner' },
    });
    return {
      id: created.id,
      memberships: [{ id: membership.id, workspaceId: workspace.id, role: membership.role }],
    };
  });
  log.info({ userId: result.id, clerkUserId }, 'provisioned new athena user from clerk');
  return result;
}

async function ensureDefaultWorkspace(
  log: FastifyBaseLogger,
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
  log.info({ userId, workspaceId: result.workspaceId }, 'auto-created default workspace');
  return result;
}

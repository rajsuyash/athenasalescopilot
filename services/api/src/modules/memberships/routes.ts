import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { Role } from '@athena/shared-types';
import { assertSeatAvailable } from '../../lib/billing.js';
import { Errors } from '../../lib/errors.js';

const ROLES = ['rep', 'analyst', 'manager', 'compliance_viewer', 'admin', 'owner'] as const;

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  teamId: z.string().uuid().optional(),
});

const UpdateRoleBody = z.object({
  role: z.enum(ROLES),
});

const INVITE_TTL_DAYS = 7;

export async function membershipRoutes(app: FastifyInstance): Promise<void> {
  app.get('/memberships', async (req) => {
    const claims = await req.requirePermission('membership:read');
    const rows = await prisma.userWorkspaceMembership.findMany({
      where: { workspaceId: claims.workspaceId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((m: typeof rows[number]) => ({
      id: m.id,
      role: m.role as Role,
      status: m.status,
      teamId: m.teamId,
      team: m.team,
      user: m.user,
      createdAt: m.createdAt.toISOString(),
    }));
  });

  app.post('/memberships/invites', async (req, reply) => {
    const claims = await req.requirePermission('membership:invite');
    const body = InviteBody.parse(req.body);

    // Plan tier gate: hard-cap seat count via the billing account snapshot.
    await assertSeatAvailable(claims.workspaceId);

    // Reject if user is already an active member.
    const existingUser = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existingUser) {
      const existingMembership = await prisma.userWorkspaceMembership.findFirst({
        where: { workspaceId: claims.workspaceId, userId: existingUser.id, status: 'active' },
      });
      if (existingMembership) throw Errors.alreadyMember();
    }

    const tokenRaw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await prisma.invite.create({
      data: {
        workspaceId: claims.workspaceId,
        email: body.email.toLowerCase(),
        role: body.role,
        teamId: body.teamId ?? null,
        invitedBy: claims.sub,
        tokenHash,
        expiresAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'membership.invited',
        resourceType: 'invite',
        resourceId: invite.id,
        metadataJson: { email: body.email, role: body.role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    reply.status(201);
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role as Role,
      expiresAt: invite.expiresAt.toISOString(),
      // TODO: send email with magic link. v1 returns the token to the inviter
      // so the bootstrap flow works without an SMTP provider.
      inviteToken: tokenRaw,
    };
  });

  app.patch('/memberships/:id', async (req) => {
    const claims = await req.requirePermission('membership:update_role');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = UpdateRoleBody.parse(req.body);

    const target = await prisma.userWorkspaceMembership.findUnique({ where: { id: params.id } });
    if (!target || target.workspaceId !== claims.workspaceId) throw Errors.notFound();

    // PRD F8 AC: workspace must always have ≥1 owner.
    if (target.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await prisma.userWorkspaceMembership.count({
        where: { workspaceId: claims.workspaceId, role: 'owner', status: 'active' },
      });
      if (ownerCount <= 1) throw Errors.mustHaveOwner();
    }

    const updated = await prisma.userWorkspaceMembership.update({
      where: { id: target.id },
      data: { role: body.role },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'membership.role_changed',
        resourceType: 'membership',
        resourceId: target.id,
        metadataJson: { from: target.role, to: body.role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
    return { id: updated.id, role: updated.role as Role };
  });

  app.delete('/memberships/:id', async (req, reply) => {
    const claims = await req.requirePermission('membership:remove');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const target = await prisma.userWorkspaceMembership.findUnique({ where: { id: params.id } });
    if (!target || target.workspaceId !== claims.workspaceId) throw Errors.notFound();

    if (target.role === 'owner') {
      const ownerCount = await prisma.userWorkspaceMembership.count({
        where: { workspaceId: claims.workspaceId, role: 'owner', status: 'active' },
      });
      if (ownerCount <= 1) throw Errors.mustHaveOwner();
    }

    await prisma.$transaction([
      prisma.userWorkspaceMembership.update({
        where: { id: target.id },
        data: { status: 'removed' },
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId: target.userId,
          workspaceId: target.workspaceId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'membership.removed',
          resourceType: 'membership',
          resourceId: target.id,
          metadataJson: { userId: target.userId, role: target.role },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
        },
      }),
    ]);
    reply.status(204).send();
  });
}

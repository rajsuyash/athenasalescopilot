import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import { Errors } from '../../lib/errors.js';

const ParamsId = z.object({ id: z.string().uuid() });

const FeedbackBody = z.object({
  feedback: z.enum(['useful', 'not_useful', 'dismissed']),
  action: z.enum(['copy', 'pin', 'dismiss', 'expand']).optional(),
});

export async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/suggestions/:id/feedback — rep records useful / not_useful / dismissed.
   * Tenant-scoped: only the rep who hosted the meeting (or anyone with
   * `suggestion:feedback_own`) can submit. Updates accepted_signal on the
   * suggestion row + writes a `suggestion_feedback` record + audit log.
   */
  app.post('/suggestions/:id/feedback', async (req) => {
    const claims = await req.requirePermission('suggestion:feedback_own');
    const params = ParamsId.parse(req.params);
    const body = FeedbackBody.parse(req.body);

    const suggestion = await prisma.suggestion.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      include: { meeting: { select: { hostUserId: true } } },
    });
    if (!suggestion) throw Errors.notFound();
    // Per PRD F6, only the rep that owns the meeting can leave feedback on its
    // suggestions. Managers + analysts use the flag flow instead.
    if (suggestion.meeting.hostUserId !== claims.sub) throw Errors.notFound();

    const acceptedSignal =
      body.feedback === 'useful' ? 'useful'
      : body.feedback === 'not_useful' ? 'not_useful'
      : null;

    const [, fb] = await prisma.$transaction([
      prisma.suggestion.update({
        where: { id: suggestion.id },
        data: {
          acceptedSignal,
          dismissedAt: body.feedback === 'dismissed' ? new Date() : suggestion.dismissedAt,
        },
      }),
      prisma.suggestionFeedback.create({
        data: {
          suggestionId: suggestion.id,
          userId: claims.sub,
          feedback: body.feedback,
          action: body.action ?? null,
        },
      }),
      prisma.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'suggestion.feedback',
          resourceType: 'suggestion',
          resourceId: suggestion.id,
          metadataJson: { feedback: body.feedback, action: body.action ?? null },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
        },
      }),
    ]);

    return {
      id: fb.id,
      suggestionId: suggestion.id,
      feedback: body.feedback,
      action: body.action ?? null,
    };
  });

  /**
   * POST /v1/suggestions/:id/flag — manager flags a suggestion for review.
   * PRD F13. Requires `suggestion:flag` (manager + admin + owner).
   */
  const FlagBody = z.object({
    reason: z.enum(['risky', 'wrong', 'example', 'revisit']),
    notes: z.string().max(2000).optional(),
  });

  app.post('/suggestions/:id/flag', async (req, reply) => {
    const claims = await req.requirePermission('suggestion:flag');
    const params = ParamsId.parse(req.params);
    const body = FlagBody.parse(req.body);

    const suggestion = await prisma.suggestion.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      include: {
        meeting: { select: { id: true, title: true, hostUserId: true } },
      },
    });
    if (!suggestion) throw Errors.notFound();

    const flag = await prisma.suggestionFlag.create({
      data: {
        workspaceId: claims.workspaceId,
        suggestionId: suggestion.id,
        flaggedBy: claims.sub,
        reason: body.reason,
        notes: body.notes ?? null,
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'suggestion.flagged',
        resourceType: 'suggestion',
        resourceId: suggestion.id,
        metadataJson: { reason: body.reason, flagId: flag.id },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    // Notify the meeting host (the rep who delivered the suggestion). Skip
    // when a manager flags their own meeting.
    if (suggestion.meeting.hostUserId !== claims.sub) {
      await prisma.notification.create({
        data: {
          workspaceId: claims.workspaceId,
          userId: suggestion.meeting.hostUserId,
          kind: 'suggestion.flagged',
          title: `Suggestion flagged · ${body.reason}`,
          body:
            body.notes?.slice(0, 200) ??
            `A manager flagged a suggestion in "${suggestion.meeting.title ?? 'your meeting'}".`,
          linkPath: `/meetings/${suggestion.meeting.id}`,
          payload: {
            suggestionId: suggestion.id,
            meetingId: suggestion.meeting.id,
            flagId: flag.id,
            reason: body.reason,
          },
        },
      });
    }

    reply.status(201);
    return {
      id: flag.id,
      suggestionId: suggestion.id,
      reason: flag.reason,
      notes: flag.notes,
      createdAt: flag.createdAt.toISOString(),
    };
  });

  /**
   * POST /v1/suggestions/:id/flags/:flagId/resolve — clear a flag.
   */
  app.post('/suggestions/:id/flags/:flagId/resolve', async (req) => {
    const claims = await req.requirePermission('suggestion:flag');
    const p = z.object({ id: z.string().uuid(), flagId: z.string().uuid() }).parse(req.params);
    const flag = await prisma.suggestionFlag.findFirst({
      where: { id: p.flagId, workspaceId: claims.workspaceId, suggestionId: p.id },
    });
    if (!flag) throw Errors.notFound();
    const updated = await prisma.suggestionFlag.update({
      where: { id: flag.id },
      data: { resolvedAt: new Date() },
    });
    return { id: updated.id, resolvedAt: updated.resolvedAt?.toISOString() ?? null };
  });

  /**
   * POST /v1/suggestions/:id/comments — threaded comment.
   * Allowed: meeting host (rep) OR anyone with `suggestion:flag` (manager+).
   */
  const CommentBody = z.object({ body: z.string().min(1).max(4000) });

  app.post('/suggestions/:id/comments', async (req, reply) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const body = CommentBody.parse(req.body);

    const suggestion = await prisma.suggestion.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      include: {
        meeting: { select: { id: true, title: true, hostUserId: true } },
      },
    });
    if (!suggestion) throw Errors.notFound();

    const isHost = suggestion.meeting.hostUserId === claims.sub;
    const canFlag = ['manager', 'admin', 'owner'].includes(claims.role);
    if (!isHost && !canFlag) throw Errors.insufficientRole('manager');

    const comment = await prisma.suggestionComment.create({
      data: {
        workspaceId: claims.workspaceId,
        suggestionId: suggestion.id,
        authorId: claims.sub,
        body: body.body,
      },
    });

    // Ping the rest of the thread: every flag author + every prior commenter,
    // excluding the comment author themselves. PRD F13.
    const [priorComments, flags] = await Promise.all([
      prisma.suggestionComment.findMany({
        where: { suggestionId: suggestion.id, workspaceId: claims.workspaceId },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
      prisma.suggestionFlag.findMany({
        where: { suggestionId: suggestion.id, workspaceId: claims.workspaceId },
        select: { flaggedBy: true },
        distinct: ['flaggedBy'],
      }),
    ]);
    const recipients = new Set<string>();
    for (const c of priorComments) recipients.add(c.authorId);
    for (const f of flags) recipients.add(f.flaggedBy);
    // Always ensure the meeting host hears about new replies, even if they
    // never commented or flagged.
    if (suggestion.meeting.hostUserId) recipients.add(suggestion.meeting.hostUserId);
    recipients.delete(claims.sub);

    if (recipients.size > 0) {
      const author = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { name: true, email: true },
      });
      const authorLabel = author?.name ?? author?.email ?? 'A teammate';
      await prisma.notification.createMany({
        data: [...recipients].map((userId) => ({
          workspaceId: claims.workspaceId,
          userId,
          kind: 'suggestion.commented',
          title: `New comment from ${authorLabel}`,
          body: body.body.slice(0, 200),
          linkPath: `/meetings/${suggestion.meeting.id}`,
          payload: {
            suggestionId: suggestion.id,
            meetingId: suggestion.meeting.id,
            commentId: comment.id,
          },
        })),
      });
    }

    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'suggestion.commented',
        resourceType: 'suggestion',
        resourceId: suggestion.id,
        metadataJson: { commentId: comment.id, recipients: recipients.size },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    reply.status(201);
    return {
      id: comment.id,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  });

  /**
   * GET /v1/suggestions/:id/coaching — flags + comments thread for one suggestion.
   * Anyone in the workspace can read.
   */
  app.get('/suggestions/:id/coaching', async (req) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const s = await prisma.suggestion.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      select: { id: true },
    });
    if (!s) throw Errors.notFound();
    const [flags, comments] = await Promise.all([
      prisma.suggestionFlag.findMany({
        where: { suggestionId: s.id, workspaceId: claims.workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.suggestionComment.findMany({
        where: { suggestionId: s.id, workspaceId: claims.workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      flags: flags.map((f) => ({
        id: f.id,
        reason: f.reason,
        notes: f.notes,
        flaggedBy: f.flaggedBy,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      })),
      comments: comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  });
}

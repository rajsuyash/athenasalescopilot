import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import { gateMeetingStart } from '../../lib/billing.js';
import { ApiError, Errors } from '../../lib/errors.js';

const CreateBody = z.object({
  title: z.string().max(200).optional(),
  externalPlatform: z.enum(['google_meet']).default('google_meet'),
  externalMeetingId: z.string().min(1).max(120).optional(),
  consentMode: z.enum(['rep_only', 'all_party']).default('rep_only'),
});

const TranscriptBody = z.object({
  segments: z
    .array(
      z.object({
        speakerType: z.enum(['rep', 'customer', 'unknown']),
        speakerLabel: z.string().max(40),
        text: z.string().min(1),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
        confidence: z.number().min(0).max(1),
        sourceType: z.enum(['stt_audio', 'meet_caption']).default('stt_audio'),
        language: z.string().default('en-US'),
      }),
    )
    .min(1)
    .max(200),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['ready', 'live', 'completed', 'failed', 'degraded']).optional(),
  externalMeetingId: z.string().min(1).max(120).optional(),
});

const ParamsId = z.object({ id: z.string().uuid() });

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/meetings — start a meeting. PRD F1.
   * For personal-use, externalMeetingId is optional and we generate one.
   */
  app.post('/meetings', async (req, reply) => {
    const claims = await req.requirePermission('meeting:start_own');
    const body = CreateBody.parse(req.body);

    // Plan-tier gate: block when payment is overdue or meeting-hour cap is hit.
    const gate = await gateMeetingStart(claims.workspaceId);
    if (!gate.allowed) {
      const code = gate.reason === 'PAYMENT_OVERDUE' ? 'PAYMENT_OVERDUE' : 'METERING_LIMIT';
      const msg =
        code === 'PAYMENT_OVERDUE'
          ? 'Workspace payment is overdue — settle billing to start new meetings.'
          : `Plan meeting-hour limit reached (${gate.meetingHoursUsed} / ${gate.meetingHourLimit}).`;
      throw new ApiError(402, code, msg, {
        planTier: gate.planTier,
        meetingHoursUsed: gate.meetingHoursUsed,
        meetingHourLimit: gate.meetingHourLimit,
      });
    }

    const retention = await prisma.retentionPolicy.findFirst({
      where: { workspaceId: claims.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    const externalMeetingId =
      body.externalMeetingId ||
      `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const meeting = await prisma.meeting.create({
      data: {
        workspaceId: claims.workspaceId,
        hostUserId: claims.sub,
        externalPlatform: body.externalPlatform,
        externalMeetingId,
        title: body.title ?? null,
        status: 'live',
        consentMode: body.consentMode,
        retentionPolicyId: retention?.id ?? null,
        startedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'meeting.started',
        resourceType: 'meeting',
        resourceId: meeting.id,
        metadataJson: { title: body.title, platform: body.externalPlatform },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    reply.status(201);
    if (gate.nearLimit && gate.meetingHourLimit > 0) {
      reply.header(
        'x-athena-billing-warning',
        `near_limit:${gate.meetingHoursUsed}/${gate.meetingHourLimit}h`,
      );
    }
    return {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      startedAt: meeting.startedAt?.toISOString() ?? null,
      ...(gate.nearLimit ? { warning: { kind: 'near_limit', ...gate } } : {}),
    };
  });

  /**
   * POST /v1/meetings/:id/end — mark a meeting completed.
   */
  app.post('/meetings/:id/end', async (req) => {
    const claims = await req.requirePermission('meeting:start_own');
    const params = ParamsId.parse(req.params);
    const meeting = await prisma.meeting.findUnique({ where: { id: params.id } });
    if (!meeting || meeting.workspaceId !== claims.workspaceId) throw Errors.notFound();

    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'completed', endedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'meeting.ended',
        resourceType: 'meeting',
        resourceId: meeting.id,
        metadataJson: {},
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      endedAt: updated.endedAt?.toISOString() ?? null,
    };
  });

  /**
   * POST /v1/meetings/:id/transcript — append a batch of finalized segments.
   * Tenant-scoped: rejects mismatched workspace.
   */
  app.post('/meetings/:id/transcript', async (req) => {
    const claims = await req.requirePermission('meeting:start_own');
    const params = ParamsId.parse(req.params);
    const body = TranscriptBody.parse(req.body);

    const meeting = await prisma.meeting.findUnique({ where: { id: params.id } });
    if (!meeting || meeting.workspaceId !== claims.workspaceId) throw Errors.notFound();
    if (meeting.hostUserId !== claims.sub) throw Errors.notFound();

    const created = await prisma.transcriptSegment.createMany({
      data: body.segments.map((s) => ({
        workspaceId: claims.workspaceId,
        meetingId: meeting.id,
        speakerType: s.speakerType,
        speakerLabel: s.speakerLabel,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
        confidence: s.confidence,
        sourceType: s.sourceType,
        language: s.language,
      })),
    });
    return { count: created.count };
  });

  /**
   * GET /v1/meetings — list workspace meetings (own + team).
   */
  app.get('/meetings', async (req) => {
    const claims = await req.requireAuth();
    const q = ListQuery.parse(req.query);
    const where = {
      workspaceId: claims.workspaceId,
      hostUserId: claims.sub,
      ...(q.status ? { status: q.status } : {}),
      ...(q.externalMeetingId ? { externalMeetingId: q.externalMeetingId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          title: true,
          status: true,
          startedAt: true,
          endedAt: true,
          externalPlatform: true,
        },
      }),
      prisma.meeting.count({ where }),
    ]);
    return {
      total,
      meetings: rows.map((m) => ({
        ...m,
        startedAt: m.startedAt?.toISOString() ?? null,
        endedAt: m.endedAt?.toISOString() ?? null,
      })),
    };
  });

  /**
   * GET /v1/meetings/:id — single meeting + counts.
   */
  app.get('/meetings/:id', async (req) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const m = await prisma.meeting.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { transcriptSegments: true, suggestions: true } },
        summary: true,
      },
    });
    if (!m || m.workspaceId !== claims.workspaceId) throw Errors.notFound();
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      counts: m._count,
      hasSummary: !!m.summary,
    };
  });

  /**
   * GET /v1/meetings/:id/transcript — paginated transcript segments.
   */
  app.get('/meetings/:id/transcript', async (req) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const m = await prisma.meeting.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      select: { id: true },
    });
    if (!m) throw Errors.notFound();
    const segments = await prisma.transcriptSegment.findMany({
      where: { meetingId: m.id, workspaceId: claims.workspaceId },
      orderBy: { startMs: 'asc' },
      take: 1000,
      select: {
        id: true,
        speakerType: true,
        speakerLabel: true,
        text: true,
        startMs: true,
        endMs: true,
        confidence: true,
        sourceType: true,
        language: true,
      },
    });
    return { meetingId: m.id, segments };
  });

  /**
   * GET /v1/meetings/:id/suggestions — every suggestion fired during the meeting.
   */
  app.get('/meetings/:id/suggestions', async (req) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const m = await prisma.meeting.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      select: { id: true },
    });
    if (!m) throw Errors.notFound();
    const rows = await prisma.suggestion.findMany({
      where: { meetingId: m.id, workspaceId: claims.workspaceId },
      orderBy: { generatedAt: 'asc' },
      take: 500,
      include: { turn: { select: { startMs: true, endMs: true } } },
    });
    return {
      meetingId: m.id,
      suggestions: rows.map((s) => ({
        id: s.id,
        suggestionType: s.suggestionType,
        answerText: s.answerText,
        followupText: s.followupText,
        confidenceScore: s.confidenceScore,
        priorityScore: s.priorityScore,
        sourceChunkIds: s.sourceChunkIds,
        rationale: s.rationale,
        generatedAt: s.generatedAt.toISOString(),
        turnStartMs: s.turn.startMs,
        turnEndMs: s.turn.endMs,
        acceptedSignal: s.acceptedSignal,
        dismissedAt: s.dismissedAt?.toISOString() ?? null,
      })),
    };
  });
}

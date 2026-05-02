import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { LlmClient } from '@athena/sdk-llm';
import { persistRecap, runRecap, type Framework } from './service.js';

const ParamsId = z.object({ meetingId: z.string().uuid() });
const RunBody = z.object({
  framework: z.enum(['MEDDIC', 'BANT', 'SPICED']).optional(),
  /** Force regeneration even if a summary already exists. */
  force: z.boolean().optional(),
});

interface RecapDeps {
  llm: LlmClient | null;
  defaultFramework: Framework;
  recapDeadlineMs: number;
}

export function recapRoutes(deps: RecapDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * POST /v1/postcall/meetings/:meetingId/recap
     * Run Stage D and persist the MeetingSummary row.
     */
    app.post('/postcall/meetings/:meetingId/recap', async (req) => {
      const claims = await req.requireAuth();
      const params = ParamsId.parse(req.params);
      const body = RunBody.parse(req.body ?? {});

      const existing = await prisma.meetingSummary.findUnique({
        where: { meetingId: params.meetingId },
      });
      if (existing && !body.force) {
        // Confirm tenant ownership before returning.
        const meeting = await prisma.meeting.findFirst({
          where: { id: params.meetingId, workspaceId: claims.workspaceId },
          select: { id: true },
        });
        if (!meeting) {
          throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404, code: 'NOT_FOUND' });
        }
        return { id: existing.id, cached: true };
      }

      const result = await runRecap(
        {
          workspaceId: claims.workspaceId,
          meetingId: params.meetingId,
          framework: body.framework ?? deps.defaultFramework,
          deadlineMs: deps.recapDeadlineMs,
        },
        { llm: deps.llm },
      );
      const persisted = await persistRecap(params.meetingId, claims.workspaceId, result);
      return { id: persisted.id, cached: false, source: result.source, lowSignal: result.lowSignal };
    });

    /**
     * GET /v1/postcall/meetings/:meetingId/recap
     */
    app.get('/postcall/meetings/:meetingId/recap', async (req) => {
      const claims = await req.requireAuth();
      const params = ParamsId.parse(req.params);
      const meeting = await prisma.meeting.findFirst({
        where: { id: params.meetingId, workspaceId: claims.workspaceId },
        include: { summary: true, host: { select: { name: true, email: true } } },
      });
      if (!meeting) {
        throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404, code: 'NOT_FOUND' });
      }
      if (!meeting.summary) {
        throw Object.assign(new Error('NO_SUMMARY'), {
          statusCode: 404,
          code: 'NO_SUMMARY',
          details: { meetingId: meeting.id },
        });
      }
      return {
        meetingId: meeting.id,
        title: meeting.title,
        host: meeting.host,
        summary: meeting.summary.summary,
        objections: meeting.summary.objectionsJson,
        nextSteps: meeting.summary.nextStepsJson,
        followupEmail: meeting.summary.followupEmail,
        crmSuggestions: meeting.summary.crmSuggestionsJson,
        adherence: meeting.summary.adherenceJson,
        lowSignal: meeting.summary.lowSignal,
        createdAt: meeting.summary.createdAt.toISOString(),
      };
    });
  };
}

/**
 * Caption-fallback ingress. The Chrome extension's content script captures
 * Meet's visible captions and ships them here. We synthesize an SttSegment
 * per line and inject it into the live session's `onFinal` pipeline so the
 * orchestrator runs the same coach + persistence logic as it does for STT.
 *
 * Tenant invariant: the gateway already verified the workspace via JWT;
 * the active-session map only resolves meetings hosted in that workspace.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import type { SttSegment } from '@athena/sdk-stt';
import { coachAndPersist } from '../../lib/coach.js';
import { getActiveSession } from './handler.js';

interface CaptionsDeps {
  llm: LlmClient | null;
  embeddings: EmbeddingClient;
  minDisplayConfidence: number;
  urgencyThreshold: number;
}

const Body = z.object({
  externalMeetingId: z.string().min(1).max(120),
  captions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        speakerLabel: z.string().nullable().optional(),
        capturedAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export function captionsRoutes(deps: CaptionsDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * POST /v1/sessions/captions — fallback ingress for the Chrome extension.
     * Caller must hold a valid workspace JWT. We resolve the live meeting
     * by externalMeetingId + workspace, then route each caption through the
     * active session's onFinal handler (or persist + skip coach if no session).
     */
    app.post('/sessions/captions', async (req, reply) => {
      const claims = await req.requireAuth();
      const body = Body.parse(req.body);

      // Scope to (workspaceId, hostUserId, externalMeetingId, live). Adding
      // hostUserId to the where-clause (rather than filtering after the
      // findFirst) prevents a cross-host collision: if two reps in the same
      // workspace ran a Meet with the same code, the previous code's
      // newest-wins rule could deliver one rep's captions into the other
      // rep's session before the post-fetch host check kicked in.
      const meeting = await prisma.meeting.findFirst({
        where: {
          workspaceId: claims.workspaceId,
          hostUserId: claims.sub,
          externalMeetingId: body.externalMeetingId,
          status: 'live',
        },
        orderBy: { startedAt: 'desc' },
        select: { id: true, hostUserId: true, startedAt: true },
      });
      if (!meeting) {
        reply.status(404);
        return { error: 'NO_LIVE_MEETING', message: 'no live meeting for that external id' };
      }

      const active = getActiveSession(meeting.id);
      req.log.info({ meetingId: meeting.id, hasActive: active !== undefined, captionCount: body.captions.length }, '[captions] received');
      let injected = 0;
      // startMs/endMs are INT4 — we can't write epoch-ms (13 digits). Use
      // offset-from-meeting-start so values stay within int32 even on calls
      // that run for hours.
      const startedMs = meeting.startedAt ? meeting.startedAt.getTime() : Date.now();
      let nowMs = Math.max(0, Date.now() - startedMs);
      for (const c of body.captions) {
        const startMs = nowMs;
        const endMs = startMs + Math.min(8000, Math.max(500, c.text.length * 60));
        nowMs = endMs;

        const seg: SttSegment = {
          segmentId: crypto.randomUUID(),
          text: c.text,
          startMs,
          endMs,
          confidence: 0.6,
          isFinal: true,
          speakerLabel: c.speakerLabel ?? 'Caption',
          language: 'en-US',
        };

        if (active) {
          // Drives the same handler that STT finals do: persist, classify
          // the speaker via the SpeakerMap, run coachAndPersist, send the
          // suggestion over the WS.
          try {
            await active.onFinal(seg);
            injected += 1;
          } catch {
            /* swallow; captions are best-effort */
          }
        } else {
          // No live WS session — still drive the full coach pipeline so the
          // suggestion gets persisted (and shows up on /meetings/<id>). We
          // can't push the suggestion over a WS, but the rep can refresh.
          try {
            await prisma.transcriptSegment.create({
              data: {
                workspaceId: claims.workspaceId,
                meetingId: meeting.id,
                speakerType: 'customer',
                speakerLabel: seg.speakerLabel,
                text: seg.text,
                startMs: seg.startMs,
                endMs: seg.endMs,
                confidence: seg.confidence,
                sourceType: 'meet_caption',
                language: seg.language,
              },
            });
            const turn = await prisma.turn.create({
              data: {
                meetingId: meeting.id,
                speakerType: 'customer',
                startMs: seg.startMs,
                endMs: seg.endMs,
              },
            });
            const t0 = Date.now();
            const out = await coachAndPersist(
              {
                workspaceId: claims.workspaceId,
                meetingId: meeting.id,
                turnId: turn.id,
                customerText: seg.text,
                contextTurns: [],
              },
              {
                llm: deps.llm,
                embeddings: deps.embeddings,
                minDisplayConfidence: deps.minDisplayConfidence,
                urgencyThreshold: deps.urgencyThreshold,
              },
            );
            req.log.info({
              meetingId: meeting.id,
              latencyMs: Date.now() - t0,
              type: out.type,
              persisted: out.suggestionId,
              text: (out.answerText ?? out.followupText ?? '').slice(0, 100),
              rationale: out.rationale,
            }, '[captions] coach result');
            injected += 1;
          } catch (err) {
            req.log.warn({ err }, 'caption coach pipeline failed');
          }
        }
      }

      return {
        meetingId: meeting.id,
        injected,
        liveSession: active !== undefined,
      };
    });
  };
}

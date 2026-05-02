import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import type { SttClient, SttSegment, SttStream } from '@athena/sdk-stt';
import { coachAndPersist } from '../../lib/coach.js';
import { verifyWsToken } from '../../lib/auth.js';
import { emitLatency } from '../../lib/latency.js';
import { endMeeting, runRecap } from '../../lib/postcall.js';

/**
 * Wire format (newline-delimited JSON for control, binary for audio):
 *
 *   client → server:
 *     ws.send(JSON.stringify({ type: "hello", meetingId, sampleRate?, language?, vocabulary?, repLabel? }))
 *     ws.send(<binary PCM s16le>)
 *     ws.send(JSON.stringify({ type: "set_rep", label: "Speaker 1" }))
 *     ws.send(JSON.stringify({ type: "bye" }))
 *
 *   server → client:
 *     { type: "ready", sessionId }
 *     { type: "transcript.partial", segment }
 *     { type: "transcript.final", segment, speaker: "rep" | "customer" | "unknown" }
 *     { type: "suggestion.generated", suggestion }
 *     { type: "error", code, message }
 *     { type: "closed", reason }
 */

const HelloSchema = z.object({
  type: z.literal('hello'),
  meetingId: z.string().uuid(),
  sampleRate: z.number().int().positive().optional(),
  language: z.string().optional(),
  vocabulary: z.array(z.string().min(1)).optional(),
  repLabel: z.string().optional(),
  // Dev-only: classify every diarized turn as `customer` so the coach fires
  // during solo testing where only the rep is on the call.
  forceCustomer: z.boolean().optional(),
});

const SetRepSchema = z.object({
  type: z.literal('set_rep'),
  label: z.string(),
});

const ByeSchema = z.object({ type: z.literal('bye') });

interface SessionDeps {
  stt: SttClient;
  embeddings: EmbeddingClient;
  llm: LlmClient | null;
  minDisplayConfidence: number;
  urgencyThreshold: number;
  idleTimeoutMs: number;
  maxPendingSegments: number;
  postcallUrl: string;
  apiUrl: string;
  autoRecap: boolean;
  autoEndMeeting: boolean;
}

class SpeakerMap {
  private repLabel: string | null;
  private forceCustomer: boolean;
  constructor(forced: string | null, forceCustomer = false) {
    this.repLabel = forced;
    this.forceCustomer = forceCustomer;
  }
  classify(label: string): 'rep' | 'customer' {
    if (this.forceCustomer) return 'customer';
    if (this.repLabel === null) {
      this.repLabel = label;
      return 'rep';
    }
    return label === this.repLabel ? 'rep' : 'customer';
  }
  set(label: string): void {
    this.repLabel = label;
  }
}

interface ActiveSession {
  workspaceId: string;
  onFinal: (seg: SttSegment) => Promise<void>;
}

/** Global map keyed by `meetingId` so external HTTP routes can inject finals
 * into a live WebSocket session (caption fallback, manual injection, etc). */
const activeSessions = new Map<string, ActiveSession>();

export function getActiveSession(meetingId: string): ActiveSession | undefined {
  return activeSessions.get(meetingId);
}

export function clearActiveSession(meetingId: string): void {
  activeSessions.delete(meetingId);
}

export function registerSessionHandler(app: FastifyInstance, deps: SessionDeps): void {
  app.get(
    '/v1/sessions',
    { websocket: true },
    async (socket: WebSocket, req: FastifyRequest) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const verified = verifyWsToken(app, req.headers.authorization, url);
      if (!verified) {
        sendJson(socket, { type: 'error', code: 'TOKEN_INVALID', message: 'invalid token' });
        socket.close(4001, 'unauthorized');
        return;
      }
      const claims = verified.claims;
      const rawToken = verified.raw;

      let meetingId: string | null = null;
      let sttStream: SttStream | null = null;
      let speakerMap: SpeakerMap | null = null;
      const rolling: Array<{ speaker: 'rep' | 'customer'; text: string }> = [];
      const sessionId = crypto.randomUUID();
      let lastFrameAt = Date.now();
      let inflightCoach = false;
      let pending: { customerText: string; turnId: string } | null = null;
      const log = req.log.child({ sessionId, workspaceId: claims.workspaceId });

      const idle = setInterval(() => {
        if (Date.now() - lastFrameAt > deps.idleTimeoutMs) {
          log.warn({ idleMs: Date.now() - lastFrameAt }, 'idle timeout');
          shutdown('idle');
        }
      }, 5_000);

      let shuttingDown = false;
      const shutdown = (reason: string): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(idle);
        if (sttStream) {
          void sttStream.close().catch(() => {});
          sttStream = null;
        }
        // Run end-of-call work (end meeting + recap) before closing the socket,
        // so the client can still receive `recap.ready` while the WS is open.
        const meetingForRecap = meetingId;
        const fireRecap = async (): Promise<void> => {
          if (!meetingForRecap) return;
          if (deps.autoEndMeeting) {
            try {
              await endMeeting(deps.apiUrl, rawToken, meetingForRecap);
            } catch (err) {
              log.warn({ err }, 'autoEndMeeting failed');
            }
          }
          if (!deps.autoRecap) return;
          try {
            const recap = await runRecap(deps.postcallUrl, rawToken, meetingForRecap);
            sendJson(socket, { type: 'recap.ready', recap });
          } catch (err) {
            log.warn({ err }, 'autoRecap failed');
            sendJson(socket, {
              type: 'error',
              code: 'RECAP_FAILED',
              message: err instanceof Error ? err.message : 'unknown',
            });
          }
        };
        void fireRecap().finally(() => {
          try {
            sendJson(socket, { type: 'closed', reason });
          } catch {
            /* ignore */
          }
          if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
            socket.close(1000, reason);
          }
        });
      };

      const drainPending = async (): Promise<void> => {
        if (inflightCoach || !pending || !meetingId) return;
        const { customerText, turnId } = pending;
        pending = null;
        inflightCoach = true;
        try {
          const r = await coachAndPersist(
            {
              workspaceId: claims.workspaceId,
              meetingId,
              turnId,
              customerText,
              contextTurns: rolling.slice(-6),
            },
            deps,
          );
          sendJson(socket, { type: 'suggestion.generated', suggestion: r });
        } catch (err) {
          log.error({ err }, 'coach failed');
          sendJson(socket, {
            type: 'error',
            code: 'COACH_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          });
        } finally {
          inflightCoach = false;
          if (pending) void drainPending();
        }
      };

      const onFinal = async (seg: SttSegment): Promise<void> => {
        if (!meetingId || !speakerMap) return;
        const speaker = speakerMap.classify(seg.speakerLabel);
        rolling.push({ speaker, text: seg.text });
        if (rolling.length > deps.maxPendingSegments) {
          rolling.splice(0, rolling.length - deps.maxPendingSegments);
        }

        // Latency from STT segment end → arrival on the gateway. Approximate
        // wall-clock since we don't have the speech-receipt timestamp.
        const arrivalDelay = Math.max(0, Date.now() - lastFrameAt);
        emitLatency({
          workspaceId: claims.workspaceId,
          meetingId,
          stage: 'transcript_final',
          latencyMs: arrivalDelay,
        });

        // Persist transcript segment (PRD F10: workspace-scoped).
        await prisma.transcriptSegment.create({
          data: {
            workspaceId: claims.workspaceId,
            meetingId,
            speakerType: speaker,
            speakerLabel: seg.speakerLabel,
            text: seg.text,
            startMs: seg.startMs,
            endMs: seg.endMs,
            confidence: seg.confidence,
            sourceType: 'stt_audio',
            language: seg.language,
          },
        });

        sendJson(socket, { type: 'transcript.final', segment: seg, speaker });

        if (speaker !== 'customer') return;

        // Create a turn row so the suggestion row can FK to it.
        const turn = await prisma.turn.create({
          data: {
            meetingId,
            speakerType: 'customer',
            startMs: seg.startMs,
            endMs: seg.endMs,
          },
        });
        pending = { customerText: seg.text, turnId: turn.id };
        void drainPending();
      };

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (!sttStream) {
            sendJson(socket, { type: 'error', code: 'NOT_READY', message: 'send hello first' });
            return;
          }
          lastFrameAt = Date.now();
          sttStream.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          return;
        }

        // Control frame.
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString('utf8'));
        } catch {
          sendJson(socket, { type: 'error', code: 'BAD_JSON', message: 'invalid control frame' });
          return;
        }
        const tag = (parsed as { type?: unknown })?.type;
        if (tag === 'hello') void onHello(parsed);
        else if (tag === 'set_rep') void onSetRep(parsed);
        else if (tag === 'bye') shutdown('client_bye');
        else
          sendJson(socket, {
            type: 'error',
            code: 'BAD_TYPE',
            message: `unknown control type: ${String(tag)}`,
          });
      });

      socket.on('close', () => {
        log.info('socket closed');
        clearInterval(idle);
        if (sttStream) void sttStream.close().catch(() => {});
        if (meetingId) activeSessions.delete(meetingId);
      });

      socket.on('error', (err: Error) => {
        log.error({ err }, 'socket error');
      });

      const onHello = async (raw: unknown): Promise<void> => {
        const parsed = HelloSchema.safeParse(raw);
        if (!parsed.success) {
          sendJson(socket, {
            type: 'error',
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
          shutdown('bad_hello');
          return;
        }
        if (sttStream) {
          sendJson(socket, { type: 'error', code: 'ALREADY_STARTED', message: 'session already running' });
          return;
        }
        // Tenant authorization on the meeting.
        const meeting = await prisma.meeting.findFirst({
          where: { id: parsed.data.meetingId, workspaceId: claims.workspaceId },
        });
        if (!meeting) {
          sendJson(socket, { type: 'error', code: 'NOT_FOUND', message: 'meeting not found' });
          shutdown('not_found');
          return;
        }
        meetingId = meeting.id;
        speakerMap = new SpeakerMap(parsed.data.repLabel ?? null, parsed.data.forceCustomer === true);

        try {
          sttStream = await deps.stt.open(
            {
              workspaceId: claims.workspaceId,
              meetingId: meeting.id,
              ...(parsed.data.language ? { language: parsed.data.language } : {}),
              sampleRate: parsed.data.sampleRate ?? 16000,
              channels: 1,
              ...(parsed.data.vocabulary ? { vocabulary: parsed.data.vocabulary } : {}),
            },
            {
              onFinal: (s) => void onFinal(s),
              onPartial: (s) => sendJson(socket, { type: 'transcript.partial', segment: s }),
              onError: (err) =>
                sendJson(socket, { type: 'error', code: 'STT_ERROR', message: err.message }),
              onClose: () => log.info('stt closed'),
            },
          );
        } catch (err) {
          log.error({ err }, 'stt open failed');
          sendJson(socket, {
            type: 'error',
            code: 'STT_OPEN_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          });
          shutdown('stt_open_failed');
          return;
        }

        // Register in the global active-session map so the caption-fallback
        // route can inject finals through the same onFinal pipeline.
        if (meetingId) {
          activeSessions.set(meetingId, {
            workspaceId: claims.workspaceId,
            onFinal,
          });
        }

        sendJson(socket, { type: 'ready', sessionId, meetingId });
      };

      const onSetRep = async (raw: unknown): Promise<void> => {
        const parsed = SetRepSchema.safeParse(raw);
        if (!parsed.success || !speakerMap) return;
        speakerMap.set(parsed.data.label);
        sendJson(socket, { type: 'set_rep.ok', label: parsed.data.label });
      };

      // Suppress unused warning in the auto-route path; ByeSchema keeps shape locked.
      void ByeSchema;

      sendJson(socket, { type: 'hello.required', sessionId });
    },
  );
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

interface CoachAndPersistDepsView extends SessionDeps {}
void (null as unknown as CoachAndPersistDepsView);

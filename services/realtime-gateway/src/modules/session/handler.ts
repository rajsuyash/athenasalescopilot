import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import type { SttClient, SttSegment, SttStream } from '@athena/sdk-stt';
import {
  coachAndPersist,
  detectStage,
  proactiveCoach,
  PROACTIVE_STAGES,
  type ProactiveTrigger,
  type EpisodeState,
} from '../../lib/coach.js';
import {
  verifyWsToken,
  verifyTokenString,
  mintServiceToken,
  type AccessTokenClaims,
} from '../../lib/ws-auth.js';

// WS close codes for auth failures. ADDITIVE + backward-safe: 4001 keeps its
// original "auth failed" meaning (deployed clients reconnect+refresh on any
// non-1000 close), and 4011 is the narrower "token expired — refresh and
// reconnect" signal. An old client treats 4011 as a generic close and still
// refreshes (just without the 4001 fast-path), so emitting it never bricks the
// field. Mirrors WS_CLOSE_* in apps/chrome-extension/src/shared/types.ts.
const WS_CLOSE_TOKEN_INVALID = 4001;
const WS_CLOSE_TOKEN_EXPIRED = 4011;
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
  // 1 = mono (legacy / mic-unavailable fallback). 2 = interleaved stereo with
  // tab audio on ch0 (customer) and mic on ch1 (rep) → deterministic speaker
  // attribution (F17). Defaults to 1 for older clients.
  channels: z.number().int().min(1).max(2).optional(),
  language: z.string().optional(),
  vocabulary: z.array(z.string().min(1)).optional(),
  repLabel: z.string().optional(),
  // Dev-only: classify every diarized turn as `customer` so the coach fires
  // during solo testing where only the rep is on the call. STRIPPED in
  // production via `IS_PROD` below — accepting it from a real client would
  // mislabel rep speech as customer and inflate LLM/coach billing.
  forceCustomer: z.boolean().optional(),
});

const AuthFrameSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1).max(4096),
});

const SetRepSchema = z.object({
  type: z.literal('set_rep'),
  label: z.string(),
});

const ByeSchema = z.object({ type: z.literal('bye') });

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Per-user concurrent-session cap. Without this, an authenticated client can
 * open arbitrarily many WS connections (each holding STT stream + ring
 * buffers) and exhaust gateway memory.
 */
const MAX_SESSIONS_PER_USER = 3;

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

/** Audio channel carrying the rep's mic in dual-channel capture (F17). Tab
 *  audio (the customer) is ch0; mic (the rep) is ch1. */
const REP_CHANNEL = 1;

export class SpeakerMap {
  private repLabel: string | null;
  private forceCustomer: boolean;
  constructor(forced: string | null, forceCustomer = false) {
    this.repLabel = forced;
    this.forceCustomer = forceCustomer;
  }
  classify(label: string, channelIndex?: number): 'rep' | 'customer' {
    if (this.forceCustomer) return 'customer';
    // Deterministic dual-channel attribution: mic (ch1) is the rep, tab audio
    // (ch0) is the customer. No diarization guessing, no first-speaker-wins
    // race that could swap roles for a whole call.
    if (typeof channelIndex === 'number') {
      return channelIndex === REP_CHANNEL ? 'rep' : 'customer';
    }
    // Mono fallback (single-channel capture / caption injection): assume the
    // first diarized speaker is the rep.
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
  userId: string;
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

/** Count of currently-active sessions for a (workspaceId, userId) pair. */
function userConcurrency(workspaceId: string, userId: string): number {
  let n = 0;
  for (const s of activeSessions.values()) {
    if (s.workspaceId === workspaceId && s.userId === userId) n += 1;
  }
  return n;
}

export function registerSessionHandler(app: FastifyInstance, deps: SessionDeps): void {
  app.get('/v1/sessions', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    // Two-step auth: try Authorization header first (CLI / server-side
    // callers). Browser callers can't set headers on WebSocket upgrades, so
    // they're handed off to the first-frame `auth` handshake below.
    const headerVerified = verifyWsToken(app, req.headers.authorization);

    let claims: AccessTokenClaims | null = headerVerified.ok
      ? headerVerified.verified.claims
      : null;

    // Auth-frame handshake: prompt the client and wait for the first
    // control message. Anything else (binary audio, hello, set_rep) before
    // the auth frame closes the socket. Bounded by AUTH_FRAME_TIMEOUT_MS so
    // unauthenticated sockets don't sit forever.
    const AUTH_FRAME_TIMEOUT_MS = 5_000;
    let authResolved = false;
    let authTimer: ReturnType<typeof setTimeout> | null = null;

    const closeUnauth = (
      reason: string,
      code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' = 'TOKEN_INVALID',
    ): void => {
      sendJson(socket, { type: 'error', code, message: reason });
      const closeCode = code === 'TOKEN_EXPIRED' ? WS_CLOSE_TOKEN_EXPIRED : WS_CLOSE_TOKEN_INVALID;
      try {
        socket.close(closeCode, code === 'TOKEN_EXPIRED' ? 'token_expired' : 'unauthorized');
      } catch {
        /* ignore */
      }
    };

    if (!claims) {
      sendJson(socket, { type: 'auth.required' });
      authTimer = setTimeout(() => {
        if (!authResolved) closeUnauth('auth timeout');
      }, AUTH_FRAME_TIMEOUT_MS);
    } else {
      authResolved = true;
    }

    let meetingId: string | null = null;
    let sttStream: SttStream | null = null;
    let speakerMap: SpeakerMap | null = null;
    const rolling: Array<{ speaker: 'rep' | 'customer'; text: string }> = [];
    const sessionId = crypto.randomUUID();
    let lastFrameAt = Date.now();
    let inflightCoach = false;
    let pending: { customerText: string; turnId: string; turnReady: Promise<void> } | null = null;
    // log is rebound after auth-frame completes so workspaceId is logged.
    let log = req.log.child(
      claims ? { sessionId, workspaceId: claims.workspaceId } : { sessionId },
    );

    // ─── Proactive script-driven coaching state ───────────────────────────
    // Set when the client's `hello` lands. The proactive ticker fires opening
    // prompts ~3s after capture starts, and silence prompts when the rep
    // hasn't spoken in 12s during opening/qualification/discovery stages.
    let captureStartedAt = 0;
    let lastRepFinalAt = 0;
    let lastCustomerFinalAt = 0;
    let lastSuggestionAt = 0;
    let openingFired = false;
    let currentStage = 'opener';
    // F18: the objection episode currently open for this meeting (or null).
    // coachAndPersist reads it, advances the reframe loop, and returns the
    // next state; we thread it back on the following customer turn.
    let openEpisode: EpisodeState | null = null;
    let proactiveTick: ReturnType<typeof setInterval> | null = null;
    // Last ~8 proactive suggestions emitted; passed back into the coach so
    // it doesn't repeat itself when the rep stays silent.
    const recentSuggestions: string[] = [];

    const PROACTIVE_THROTTLE_MS = 8_000;
    const REP_SILENCE_MS = 12_000;
    const OPENING_DELAY_MS = 3_000;

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
      if (proactiveTick) {
        clearInterval(proactiveTick);
        proactiveTick = null;
      }
      if (sttStream) {
        void sttStream.close().catch(() => {});
        sttStream = null;
      }
      // Run end-of-call work (end meeting + recap) before closing the socket,
      // so the client can still receive `recap.ready` while the WS is open.
      const meetingForRecap = meetingId;
      const recapClaims = claims;
      const fireRecap = async (): Promise<void> => {
        if (!meetingForRecap || !recapClaims) return;
        // Mint a fresh s2s token — the WS token that authed this session may
        // have expired during a long call, which 401'd end + recap in prod.
        const s2sToken = mintServiceToken(app, recapClaims);
        if (deps.autoEndMeeting) {
          try {
            await endMeeting(deps.apiUrl, s2sToken, meetingForRecap);
          } catch (err) {
            log.warn({ err }, 'autoEndMeeting failed');
          }
        }
        if (!deps.autoRecap) return;
        try {
          const recap = await runRecap(deps.postcallUrl, s2sToken, meetingForRecap);
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
      if (inflightCoach || !pending || !meetingId || !claims) return;
      const { customerText, turnId, turnReady } = pending;
      pending = null;
      inflightCoach = true;
      // Phase 2.2: tracks the last streaming text we sent so we only
      // emit deltas (not the full accumulated text) on each frame. The
      // overlay appends each delta to the in-flight card.
      let lastStreamedAnswer = '';
      let lastStreamedFollowup = '';
      try {
        const r = await coachAndPersist(
          {
            workspaceId: claims.workspaceId,
            meetingId,
            turnId,
            customerText,
            // Reactive coach needs enough history to locate the objection in
            // the reframe loop AND to see already-answered questions
            // (coach.ts re-slices to REACTIVE_CONTEXT_TURNS).
            contextTurns: rolling.slice(-12),
            openEpisode,
            recentSuggestions: recentSuggestions.slice(0, 8),
            turnReady,
            onPartialText: (_delta, accumulated) => {
              // Anthropic streams raw JSON tokens. We extract just the
              // user-visible answer_text / followup_text portions and
              // forward incremental deltas to the rep's overlay so the
              // glass card fills in as the model writes.
              const partial = extractStreamingAnswer(accumulated);
              if (
                partial.answer !== lastStreamedAnswer ||
                partial.followup !== lastStreamedFollowup
              ) {
                lastStreamedAnswer = partial.answer ?? '';
                lastStreamedFollowup = partial.followup ?? '';
                sendJson(socket, {
                  type: 'suggestion.streaming',
                  answerText: lastStreamedAnswer || null,
                  followupText: lastStreamedFollowup || null,
                });
              }
            },
          },
          deps,
        );
        // Carry the objection-loop state into the next customer turn.
        openEpisode = r.openEpisode;
        if (r.display) {
          lastSuggestionAt = Date.now();
          // Remember what was shown so the coach never repeats it and never
          // re-asks a question the prospect already answered.
          const shown = r.followupText ?? r.answerText;
          if (shown) {
            recentSuggestions.unshift(shown);
            if (recentSuggestions.length > 12) recentSuggestions.length = 12;
          }
          sendJson(socket, { type: 'suggestion.generated', suggestion: r });
        } else {
          // Suppressed (silence gate / dedup / low confidence). The extension
          // renders anything with text, so strip the spoken fields — this both
          // hides the card and clears any in-flight streaming placeholder.
          sendJson(socket, {
            type: 'suggestion.generated',
            suggestion: { ...r, answerText: null, followupText: null },
          });
        }
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

    /**
     * Tiny JSON-aware extractor that pulls answer_text / followup_text
     * out of an incomplete Anthropic JSON stream. We can't use
     * JSON.parse on partial input; instead we regex for the open string
     * literal of each field and capture everything up to (but not
     * including) the closing unescaped quote.
     *
     * The character class `(?:\\.|[^"\\])*` handles `\"` and other
     * backslash-escapes inside the value, so a partial output like
     * `"answer_text":"They said \"yes\" but` produces the live answer
     * `They said "yes" but` correctly.
     */
    // eslint-disable-next-line no-inner-declarations
    function extractStreamingAnswer(accumulated: string): {
      answer: string | null;
      followup: string | null;
    } {
      return {
        answer: extractJsonStringField(accumulated, 'answer_text'),
        followup: extractJsonStringField(accumulated, 'followup_text'),
      };
    }
    // eslint-disable-next-line no-inner-declarations
    function extractJsonStringField(text: string, field: string): string | null {
      const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`);
      const m = re.exec(text);
      if (!m || m[1] === undefined) return null;
      // Unescape common JSON escapes for live display.
      return m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    const fireProactive = async (trigger: ProactiveTrigger): Promise<void> => {
      if (!meetingId || inflightCoach || !claims) return;
      if (!PROACTIVE_STAGES.includes(currentStage)) return;
      inflightCoach = true;
      try {
        const r = await proactiveCoach(
          {
            workspaceId: claims.workspaceId,
            meetingId,
            stage: currentStage,
            trigger,
            // Proactive nudges also need to see what was recently covered so
            // the script line fits the conversation, not the script's order.
            contextTurns: rolling.slice(-8),
            recentSuggestions: recentSuggestions.slice(0, 8),
          },
          deps,
        );
        // The extension renders any suggestion with text — respect the
        // display gate server-side.
        if (r && r.display) {
          lastSuggestionAt = Date.now();
          if (r.followupText) {
            recentSuggestions.unshift(r.followupText);
            if (recentSuggestions.length > 12) recentSuggestions.length = 12;
          }
          sendJson(socket, { type: 'suggestion.generated', suggestion: r });
        }
      } catch (err) {
        log.error({ err, trigger, stage: currentStage }, 'proactive coach failed');
      } finally {
        inflightCoach = false;
      }
    };

    const onFinal = async (seg: SttSegment): Promise<void> => {
      if (!meetingId || !speakerMap || !claims) return;
      const speaker = speakerMap.classify(seg.speakerLabel, seg.channelIndex);
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

      // Persist transcript segment (PRD F10: workspace-scoped). Fire-and-forget
      // — an awaited insert here put a DB round trip in front of the client
      // seeing the transcript line AND in front of every coach call. Nothing
      // downstream in this handler reads the row; the recap reads segments
      // minutes later, long after this insert lands.
      void prisma.transcriptSegment
        .create({
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
        })
        .catch((err) => log.warn({ err }, 'segment persist failed'));

      sendJson(socket, { type: 'transcript.final', segment: seg, speaker });

      // Track stage transitions on every turn so the proactive ticker fires
      // the right stage's prompt. The reactive customer-turn path below is
      // unchanged (objection-handling continues to ground in chunks).
      const detected = detectStage(seg.text);
      const stageChanged = detected !== currentStage;
      if (stageChanged) {
        const prev = currentStage;
        currentStage = detected;
        log.debug({ from: prev, to: detected, speaker }, 'stage transition');
        // Fire a script nudge only when the REP moves the call into a new
        // stage with a real keyword signal. Two spam sources removed
        // (2026-07-24 field report): customer keywords triggering script
        // nudges mid-answer, and bounces back to 'discovery' — the detector's
        // no-keyword default — firing a nudge on nearly every neutral turn.
        if (
          speaker === 'rep' &&
          detected !== 'discovery' &&
          PROACTIVE_STAGES.includes(detected) &&
          Date.now() - lastSuggestionAt >= PROACTIVE_THROTTLE_MS
        ) {
          void fireProactive('stage_transition');
        }
      }

      if (speaker === 'rep') {
        lastRepFinalAt = Date.now();
        return;
      }
      lastCustomerFinalAt = Date.now();

      // Customer turn → reactive coach path (objection handling, grounded).
      // Pre-generate the turn id and insert WITHOUT blocking the coach — this
      // round trip used to sit in front of every LLM call. The suggestion
      // insert has an FK on turns, so coachAndPersist awaits `turnReady`
      // right before persisting (the LLM call gives the insert ~a second of
      // head start; the await is effectively free).
      const turnId = crypto.randomUUID();
      const turnReady = prisma.turn
        .create({
          data: {
            id: turnId,
            meetingId,
            speakerType: 'customer',
            startMs: seg.startMs,
            endMs: seg.endMs,
          },
        })
        .then(() => undefined)
        .catch((err) => {
          log.warn({ err }, 'turn persist failed');
        });
      pending = { customerText: seg.text, turnId, turnReady };
      void drainPending();
    };

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      // Pre-auth gate: nothing flows until the first-frame auth handshake
      // completes. Binary frames and non-auth control frames are rejected.
      if (!claims) {
        if (isBinary) {
          closeUnauth('binary before auth');
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString('utf8'));
        } catch {
          closeUnauth('bad json before auth');
          return;
        }
        const parsed = AuthFrameSchema.safeParse(raw);
        if (!parsed.success) {
          closeUnauth('expected auth frame');
          return;
        }
        const v = verifyTokenString(app, parsed.data.token);
        if (!v.ok) {
          closeUnauth(v.code === 'TOKEN_EXPIRED' ? 'token expired' : 'invalid token', v.code);
          return;
        }
        claims = v.verified.claims;
        authResolved = true;
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
        // Per-user concurrency cap. Without this the activeSessions map
        // grows unbounded under abuse.
        if (userConcurrency(claims.workspaceId, claims.sub) >= MAX_SESSIONS_PER_USER) {
          sendJson(socket, {
            type: 'error',
            code: 'TOO_MANY_SESSIONS',
            message: `max ${MAX_SESSIONS_PER_USER} concurrent sessions per user`,
          });
          try {
            socket.close(4029, 'too_many_sessions');
          } catch {
            /* ignore */
          }
          return;
        }
        log = req.log.child({ sessionId, workspaceId: claims.workspaceId });
        sendJson(socket, { type: 'auth.ok' });
        sendJson(socket, { type: 'hello.required', sessionId });
        return;
      }

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
      else if (tag === 'auth') {
        // Already authed — ignore re-auth attempts.
        sendJson(socket, { type: 'auth.ok' });
      } else
        sendJson(socket, {
          type: 'error',
          code: 'BAD_TYPE',
          message: `unknown control type: ${String(tag)}`,
        });
    });

    socket.on('close', () => {
      log.info('socket closed');
      clearInterval(idle);
      if (proactiveTick) {
        clearInterval(proactiveTick);
        proactiveTick = null;
      }
      if (sttStream) void sttStream.close().catch(() => {});
      if (meetingId) activeSessions.delete(meetingId);
    });

    socket.on('error', (err: Error) => {
      log.error({ err }, 'socket error');
    });

    const onHello = async (raw: unknown): Promise<void> => {
      if (!claims) {
        // Defense in depth — onHello is only dispatched after auth, but guard
        // against a future refactor that could drop the auth gate.
        shutdown('not_authed');
        return;
      }
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
        sendJson(socket, {
          type: 'error',
          code: 'ALREADY_STARTED',
          message: 'session already running',
        });
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
      // Hard-strip `forceCustomer` in production. It's a dev-only convenience
      // (Block I — solo testing). A real Web-Store user toggling it on a
      // call would inflate LLM/coach billing and pollute the transcript.
      const forceCustomer = !IS_PROD && parsed.data.forceCustomer === true;
      if (parsed.data.forceCustomer === true && IS_PROD) {
        log.warn('forceCustomer stripped in production');
      }
      speakerMap = new SpeakerMap(parsed.data.repLabel ?? null, forceCustomer);

      // F17: 2 = interleaved stereo (tab=customer ch0, mic=rep ch1) → enable
      // Deepgram multichannel for deterministic attribution. 1 = mono fallback.
      const channels = parsed.data.channels ?? 1;

      try {
        sttStream = await deps.stt.open(
          {
            workspaceId: claims.workspaceId,
            meetingId: meeting.id,
            ...(parsed.data.language ? { language: parsed.data.language } : {}),
            sampleRate: parsed.data.sampleRate ?? 16000,
            channels,
            ...(channels === 2 ? { multichannel: true } : {}),
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
          userId: claims.sub,
          onFinal,
        });
      }

      // Initialize proactive coaching state. Capture starts now (after the
      // handshake), and the ticker drives opening prompts + rep-silence
      // nudges based on the current stage tracker.
      captureStartedAt = Date.now();
      lastRepFinalAt = captureStartedAt;
      lastCustomerFinalAt = captureStartedAt;
      proactiveTick = setInterval(() => {
        if (!meetingId || inflightCoach) return;
        const now = Date.now();
        if (now - lastSuggestionAt < PROACTIVE_THROTTLE_MS) return;

        if (!openingFired && now - captureStartedAt >= OPENING_DELAY_MS) {
          openingFired = true;
          currentStage = 'opener';
          void fireProactive('capture_start');
          return;
        }

        // "Silence" nudge only on a TRUE lull — both sides quiet. The old
        // rep-only check fired while the CUSTOMER was mid-answer (rep quiet
        // because they're listening), spamming script nudges unrelated to what
        // the prospect was saying (2026-07-24 field report). Also space
        // repeated lull nudges by the full silence window, not the 8s throttle.
        if (
          PROACTIVE_STAGES.includes(currentStage) &&
          currentStage !== 'closing' &&
          now - lastRepFinalAt >= REP_SILENCE_MS &&
          now - lastCustomerFinalAt >= REP_SILENCE_MS &&
          now - lastSuggestionAt >= REP_SILENCE_MS
        ) {
          void fireProactive('rep_silence');
        }
      }, 2_000);

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

    // For header-authenticated callers (CLI / tests), we can announce
    // hello.required immediately. Browser clients receive `auth.required`
    // first; `hello.required` is sent from inside the auth-frame branch
    // after their token verifies.
    if (claims) {
      sendJson(socket, { type: 'hello.required', sessionId });
    }
  });
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

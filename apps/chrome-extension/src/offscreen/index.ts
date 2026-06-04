/**
 * Offscreen audio worker — owns the Meet tab MediaStream + the WebSocket to
 * the realtime gateway. Service workers can't hold long-running MediaStreams
 * or AudioContexts, so this offscreen document is the only place in MV3 the
 * audio capture path can live.
 *
 * Wire format mirrors `apps/cli/src/commands/listen-gw.ts`:
 *   1. Open WS at `${gatewayUrl}/v1/sessions` (NO token in URL — see below)
 *   2. Wait for server `{type:"auth.required"}`
 *   3. Send `{type:"auth", token}` (first JSON frame)
 *   4. Wait for server `{type:"hello.required"}`
 *   5. Send `{type:"hello", meetingId, sampleRate:16000, language:"en-US"}`
 *   6. Wait for server `{type:"ready"}`
 *   7. Stream binary PCM s16le 16 kHz mono in ~20 ms chunks
 *   8. Receive `transcript.final` / `suggestion.generated` events; forward
 *      them to the service worker so the popup can render counters.
 *
 * Why first-frame auth? Bearer tokens passed via `?token=` query string land
 * in browser history, DevTools Network, and any reverse-proxy log along the
 * path. The browser WebSocket API doesn't permit custom upgrade headers, so
 * the only safe transport on this client is a control frame sent immediately
 * after the WS opens.
 *
 * Resilience: WS drops (network blip, gateway restart, expired token) trigger
 * an exponential-backoff reconnect. We refresh the access token via the SW
 * before each reattempt and replay the auth + hello handshake on the new socket.
 */
import { log } from '../shared/log.js';

interface StartMsg {
  type: 'offscreen.start';
  streamId: string;
  gatewayUrl: string;
  accessToken: string;
  meetingId: string; // internal UUID — must match the server's HelloSchema.meetingId
  forceCustomer?: boolean; // solo-test mode
}
interface StopMsg {
  type: 'offscreen.stop';
}
type OffscreenInbound = StartMsg | StopMsg;

interface UpdateMsg {
  type: 'offscreen.update';
  shipped?: number;
  finalsHeard?: number;
  suggestionsHeard?: number;
  lastError?: string | null;
  sessionId?: string | null;
  closed?: boolean;
  reconnectAttempt?: number | null;
}

interface ActiveCapture {
  ws: WebSocket;
  ctx: AudioContext;
  stream: MediaStream;
  micStream: MediaStream | null;
  node: AudioWorkletNode | null;
  shipped: number;
  finalsHeard: number;
  suggestionsHeard: number;
  /** True after the gateway has accepted our auth + hello and is streaming-ready. */
  ready: boolean;
  /** True after auth has been accepted (even if hello hasn't been sent yet). */
  authed: boolean;
  /** Most recent hello-frame inputs so a reconnect can replay them. */
  meetingId: string;
  gatewayUrl: string;
  accessToken: string;
  forceCustomer: boolean;
  /** Reconnect attempt counter; null when no reconnect is in flight. */
  reconnectAttempt: number | null;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

let active: ActiveCapture | null = null;

function reportUpdate(patch: Partial<UpdateMsg>): void {
  const msg: UpdateMsg = { type: 'offscreen.update', ...patch };
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function start(req: StartMsg): Promise<void> {
  log.debug('[athena-offscreen] start', { meetingId: req.meetingId });
  if (active) await stop('restart');

  // 1. Acquire MediaStream from the streamId minted by the SW.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: req.streamId,
        },
      },
      video: false,
    } as unknown as MediaStreamConstraints);
  } catch (err) {
    log.error('[athena-offscreen] getUserMedia failed');
    reportUpdate({ lastError: `getUserMedia failed: ${(err as Error).message}` });
    return;
  }

  // 2. Also capture the rep's microphone.
  let micStream: MediaStream | null = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    log.warn('[athena-offscreen] mic capture failed (continuing tab-only)');
  }

  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      log.warn('[athena-offscreen] AudioContext resume failed');
    }
  }
  const tabSrc = ctx.createMediaStreamSource(stream);
  tabSrc.connect(ctx.destination);

  try {
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('offscreen/pcm-worklet.js'));
  } catch (err) {
    log.error('[athena-offscreen] worklet load failed');
    reportUpdate({ lastError: `worklet: ${(err as Error).message}` });
    return;
  }
  const node = new AudioWorkletNode(ctx, 'pcm-encoder');
  const mixer = ctx.createGain();
  mixer.gain.value = 1.0;
  tabSrc.connect(mixer);
  if (micStream) {
    const micSrc = ctx.createMediaStreamSource(micStream);
    micSrc.connect(mixer);
  }
  mixer.connect(node);

  active = {
    ws: null as unknown as WebSocket,
    ctx,
    stream,
    micStream,
    node,
    shipped: 0,
    finalsHeard: 0,
    suggestionsHeard: 0,
    ready: false,
    authed: false,
    meetingId: req.meetingId,
    gatewayUrl: req.gatewayUrl,
    accessToken: req.accessToken,
    forceCustomer: req.forceCustomer === true,
    reconnectAttempt: null,
  };

  node.port.onmessage = (
    ev: MessageEvent<ArrayBuffer | { kind: string; peak?: number; inputRate?: number }>,
  ) => {
    if (!active) return;
    if (!(ev.data instanceof ArrayBuffer)) return;
    if (!active.ready || active.ws.readyState !== WebSocket.OPEN) return;
    active.ws.send(ev.data);
    active.shipped += 1;
    if (active.shipped % 50 === 0) {
      reportUpdate({ shipped: active.shipped });
    }
  };

  openSocket();
}

/**
 * Open (or re-open) the WS for the currently-active capture. Wires up all
 * event handlers freshly each time so reconnects start from a clean state.
 */
function openSocket(): void {
  if (!active) return;
  const cur = active;
  // No `?token=` — server sends `auth.required` and we reply with the token
  // as a control frame. Keeps credentials out of browser history + proxy logs.
  const wsUrl = cur.gatewayUrl.replace(/^http/, 'ws') + `/v1/sessions`;
  log.debug('[athena-offscreen] opening ws (no querystring auth)');
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  cur.ws = ws;
  cur.ready = false;
  cur.authed = false;

  ws.addEventListener('open', () => {
    if (cur.reconnectAttempt !== null) {
      cur.reconnectAttempt = null;
      reportUpdate({ reconnectAttempt: null });
    }
  });
  ws.addEventListener('message', async (ev) => {
    let text: string;
    if (typeof ev.data === 'string') text = ev.data;
    else if (ev.data instanceof Blob) text = await ev.data.text();
    else if (ev.data instanceof ArrayBuffer) text = new TextDecoder().decode(ev.data);
    else return;

    let payload: {
      type?: string;
      sessionId?: string;
      message?: string;
      code?: string;
      suggestion?: {
        type?: string;
        answerText?: string | null;
        followupText?: string | null;
        confidenceScore?: number;
        priorityScore?: number;
        rationale?: string;
        suggestionId?: string | null;
        sources?: Array<{ id: string; documentName?: string | null; score?: number }>;
      };
      // Streaming partials from the gateway (`suggestion.streaming` frame).
      // Display-only — final committed suggestion still arrives separately
      // as `suggestion.generated` with the full schema.
      answerText?: string | null;
      followupText?: string | null;
      segment?: { text?: string; speakerLabel?: string };
      // The gateway tags every transcript.final with the diarized speaker
      // classification — rep / customer / unknown. We forward only
      // customer-side turns into the live status panel (see SW handler).
      speaker?: 'rep' | 'customer' | 'unknown';
    };
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }
    if (!active) return;
    switch (payload.type) {
      case 'auth.required':
        // First-frame auth handshake — see file header comment.
        ws.send(JSON.stringify({ type: 'auth', token: cur.accessToken }));
        break;
      case 'auth.ok':
        cur.authed = true;
        // Server may still ask for the hello explicitly; we wait for it.
        break;
      case 'hello.required':
        ws.send(
          JSON.stringify({
            type: 'hello',
            meetingId: cur.meetingId,
            sampleRate: 16000,
            language: 'en-US',
            ...(cur.forceCustomer ? { forceCustomer: true } : {}),
          }),
        );
        break;
      case 'ready':
        active.ready = true;
        reportUpdate({ sessionId: payload.sessionId ?? null, lastError: null });
        break;
      case 'transcript.final':
        active.finalsHeard += 1;
        reportUpdate({ finalsHeard: active.finalsHeard });
        // Forward customer-side finalizations to the SW so it can broadcast
        // them into the side-panel's "Live coach" status block. The rep
        // wants to see WHAT the coach is reacting to — without this, the
        // panel only shows the coach's output, not its input.
        // Filter: only customer turns (skip rep + unknown to keep the
        // panel signal-dense). Drop empty/whitespace-only finalizations.
        if (payload.speaker === 'customer') {
          const txt = (payload.segment?.text ?? '').trim();
          if (txt) {
            void chrome.runtime
              .sendMessage({
                type: 'transcript.customer.forward',
                text: txt,
                at: Date.now(),
              })
              .catch(() => undefined);
          }
        }
        break;
      case 'suggestion.generated':
        active.suggestionsHeard += 1;
        reportUpdate({ suggestionsHeard: active.suggestionsHeard });
        if (payload.suggestion) {
          void chrome.runtime
            .sendMessage({ type: 'suggestion.forward', suggestion: payload.suggestion })
            .catch(() => undefined);
        }
        break;
      case 'suggestion.streaming':
        // Phase 2.2: forward token-stream deltas straight to the SW so it
        // can broadcast them to the in-Meet content script. We don't
        // increment `suggestionsHeard` here — that's reserved for the
        // final committed suggestion. Streaming frames are display-only.
        void chrome.runtime
          .sendMessage({
            type: 'suggestion.streaming.forward',
            answerText: payload.answerText ?? null,
            followupText: payload.followupText ?? null,
          })
          .catch(() => undefined);
        break;
      case 'error':
        // Don't echo full server payload — could include user-controllable
        // strings. Send a static label + opaque code.
        reportUpdate({ lastError: `gateway_error_${payload.code ?? 'unknown'}` });
        break;
      case 'closed':
        reportUpdate({ closed: true });
        break;
    }
  });
  ws.addEventListener('error', () => {
    log.warn('[athena-offscreen] ws error');
  });
  ws.addEventListener('close', (ev) => {
    log.warn('[athena-offscreen] ws close', { code: ev.code });
    if (!active) return;
    if (ev.code === 1000) {
      reportUpdate({ closed: true, lastError: null });
      return;
    }
    // Auth-failure closes: 4001 = token invalid, 4011 = token expired (the
    // gateway's refreshable signal, PR-F). Both skip backoff so we refresh +
    // reconnect immediately. Any other close code backs off normally.
    const isAuthFail = ev.code === 4001 || ev.code === 4011;
    void scheduleReconnect(`ws_closed_${ev.code}`, isAuthFail);
  });
}

async function scheduleReconnect(reason: string, fastPath = false): Promise<void> {
  if (!active) return;
  const attempt = (active.reconnectAttempt ?? 0) + 1;
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    log.warn('[athena-offscreen] reconnect exhausted');
    reportUpdate({ closed: true, lastError: `disconnected: ${reason}`, reconnectAttempt: null });
    return;
  }
  active.reconnectAttempt = attempt;
  reportUpdate({ reconnectAttempt: attempt, lastError: `reconnecting (attempt ${attempt})` });
  const delay = fastPath ? 0 : (BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 16_000);
  if (delay > 0) await new Promise((res) => setTimeout(res, delay));
  if (!active) return;
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'capture.refreshToken' })) as
      | { ok: true; accessToken: string }
      | { ok: false; error?: string };
    if (r?.ok && r.accessToken) {
      active.accessToken = r.accessToken;
    } else if (r && !r.ok && r.error === 'signed_out') {
      // The refresh token was REJECTED (401/403) → the session is genuinely
      // over. Stop and tell the user to sign in again.
      log.warn('[athena-offscreen] refreshToken: signed out');
      reportUpdate({
        closed: true,
        lastError: `auth expired — sign in again`,
        reconnectAttempt: null,
      });
      await stop('auth_expired');
      return;
    } else {
      // Transient refresh failure (5xx/429/network) — do NOT sign the user out
      // on a blip. Keep the session and reconnect with the existing token; if it
      // keeps failing, the bounded backoff loop eventually gives up on its own.
      log.warn('[athena-offscreen] refreshToken: transient failure, retrying');
    }
  } catch {
    log.warn('[athena-offscreen] refreshToken errored');
  }
  if (!active) return;
  openSocket();
}

async function stop(reason: string): Promise<void> {
  const cur = active;
  active = null;
  if (!cur) return;
  try {
    cur.node?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    cur.stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    cur.micStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    await cur.ctx.close();
  } catch {
    /* ignore */
  }
  try {
    if (cur.ws.readyState === WebSocket.OPEN) {
      cur.ws.send(JSON.stringify({ type: 'bye' }));
    }
    cur.ws.close(1000, reason);
  } catch {
    /* ignore */
  }
  reportUpdate({ closed: true, reconnectAttempt: null });
}

log.debug('[athena-offscreen] script loaded');

chrome.runtime.onMessage.addListener((msg: OffscreenInbound, sender, sendResponse) => {
  // Reject anything not from our SW. A malicious sibling extension that
  // knows our id could otherwise inject a forged offscreen.start with an
  // attacker-controlled token + streamId.
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'untrusted_sender' });
    return false;
  }
  if (sender.tab) {
    sendResponse({ ok: false, error: 'untrusted_sender' });
    return false;
  }
  (async () => {
    if (msg?.type === 'offscreen.start') {
      await start(msg);
      sendResponse({ ok: true });
    } else if (msg?.type === 'offscreen.stop') {
      await stop('user');
      sendResponse({ ok: true });
    }
  })();
  return true;
});

// Tell the service worker we're alive and the listener is wired.
chrome.runtime.sendMessage({ type: 'offscreen.ready' }).catch(() => undefined);

/**
 * Offscreen audio worker — owns the Meet tab MediaStream + the WebSocket to
 * the realtime gateway. Service workers can't hold long-running MediaStreams
 * or AudioContexts, so this offscreen document is the only place in MV3 the
 * audio capture path can live.
 *
 * Wire format mirrors `apps/cli/src/commands/listen-gw.ts` byte-for-byte:
 *   1. Open WS at `${gatewayUrl}/v1/sessions?token=<accessToken>`
 *   2. Wait for server `{type:"hello.required"}`
 *   3. Send `{type:"hello", meetingId, sampleRate:16000, language:"en-US"}`
 *   4. Wait for server `{type:"ready"}`
 *   5. Stream binary PCM s16le 16 kHz mono in ~20 ms chunks
 *   6. Receive `transcript.final` / `suggestion.generated` events; forward
 *      them to the service worker so the popup can render counters.
 *
 * Resilience: WS drops (network blip, gateway restart, expired token) trigger
 * an exponential-backoff reconnect. We refresh the access token via the SW
 * before each reattempt and replay the hello handshake on the new socket.
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
  ready: boolean;
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
  log.debug('[athena-offscreen] start', { meetingId: req.meetingId, gateway: req.gatewayUrl });
  if (active) await stop('restart');

  // 1. Acquire MediaStream from the streamId minted by the SW.
  // Chrome's `tabCapture` uses legacy mandatory constraints — TypeScript's
  // standard MediaTrackConstraints type doesn't model them, hence the cast.
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
    log.debug('[athena-offscreen] mediaStream OK', stream.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted })));
  } catch (err) {
    log.error('[athena-offscreen] getUserMedia failed', err);
    reportUpdate({ lastError: `getUserMedia failed: ${(err as Error).message}` });
    return;
  }

  // 2. Also capture the rep's microphone — chrome.tabCapture only delivers
  // remote participant audio (the tab's output). Without mic, Deepgram never
  // hears the rep speak. Mic is best-effort: if denied, we still ship tab
  // audio alone.
  let micStream: MediaStream | null = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    log.debug('[athena-offscreen] mic OK', micStream.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted })));
  } catch (err) {
    log.warn('[athena-offscreen] mic capture failed (continuing tab-only)', (err as Error).message);
  }

  // 3. Pipe tab audio back to the speaker so Meet stays audible — tabCapture
  // mutes the source tab by default until the captured stream is reconnected.
  const ctx = new AudioContext({ sampleRate: 16000 });
  // Offscreen documents have no user gesture, so the context starts suspended
  // and worklets never get real samples (silence). Force-resume.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
      log.debug('[athena-offscreen] AudioContext resumed');
    } catch (err) {
      log.warn('[athena-offscreen] AudioContext resume failed', err);
    }
  }
  log.debug('[athena-offscreen] AudioContext sampleRate=' + ctx.sampleRate + ' state=' + ctx.state);
  const tabSrc = ctx.createMediaStreamSource(stream);
  tabSrc.connect(ctx.destination);

  // 4. Worklet for PCM s16le encoding @ 16 kHz mono.
  try {
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('offscreen/pcm-worklet.js'));
    log.debug('[athena-offscreen] worklet loaded');
  } catch (err) {
    log.error('[athena-offscreen] worklet load failed', err);
    reportUpdate({ lastError: `worklet: ${(err as Error).message}` });
    return;
  }
  const node = new AudioWorkletNode(ctx, 'pcm-encoder');
  // Mix tab + mic into a single mono stream feeding the encoder. Both go
  // through a Gain node so we can balance levels later if needed.
  const mixer = ctx.createGain();
  mixer.gain.value = 1.0;
  tabSrc.connect(mixer);
  if (micStream) {
    const micSrc = ctx.createMediaStreamSource(micStream);
    micSrc.connect(mixer);
  }
  mixer.connect(node);

  // 5. Set initial ActiveCapture (the WS field is replaced by openSocket).
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
    meetingId: req.meetingId,
    gatewayUrl: req.gatewayUrl,
    accessToken: req.accessToken,
    forceCustomer: req.forceCustomer === true,
    reconnectAttempt: null,
  };

  node.port.onmessage = (ev: MessageEvent<ArrayBuffer | { kind: string; peak?: number; inputRate?: number }>) => {
    if (!active) return;
    // Diag messages from the worklet describing input-side amplitude. NEVER
    // ship these over the WS — gateway treats non-binary frames as JSON
    // control frames and rejects unknown shapes as BAD_JSON.
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
  const wsUrl = cur.gatewayUrl.replace(/^http/, 'ws') + `/v1/sessions?token=${encodeURIComponent(cur.accessToken)}`;
  log.debug('[athena-offscreen] opening ws', wsUrl.replace(/token=[^&]+/, 'token=…'));
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  cur.ws = ws;
  cur.ready = false;

  ws.addEventListener('open', () => {
    log.debug('[athena-offscreen] ws open, readyState=' + ws.readyState);
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
    else {
      log.warn('[athena-offscreen] ws msg unknown type', typeof ev.data, ev.data);
      return;
    }
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
      segment?: { text?: string; speakerLabel?: string };
    };
    try {
      payload = JSON.parse(text);
    } catch {
      log.warn('[athena-offscreen] ws msg non-json', text.slice(0, 200));
      return;
    }
    log.debug('[athena-offscreen] ws msg', payload.type, payload.code ?? '', payload.message ?? '');
    if (!active) return;
    switch (payload.type) {
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
        log.debug('[athena-offscreen] ready — streaming PCM');
        reportUpdate({ sessionId: payload.sessionId ?? null, lastError: null });
        break;
      case 'transcript.final':
        active.finalsHeard += 1;
        reportUpdate({ finalsHeard: active.finalsHeard });
        break;
      case 'suggestion.generated':
        active.suggestionsHeard += 1;
        reportUpdate({ suggestionsHeard: active.suggestionsHeard });
        // Forward EVERY suggestion to the SW so the in-Meet history panel
        // can show it. Previously we filtered out suggestions with empty
        // answerText AND followupText, which silently dropped suppressed
        // and rationale-only entries from the panel even though the
        // counter reflected them. The content-script overlay (toast) and
        // the panel both decide separately whether to render.
        if (payload.suggestion) {
          void chrome.runtime.sendMessage({
            type: 'suggestion.forward',
            suggestion: payload.suggestion,
          }).catch(() => undefined);
        }
        break;
      case 'error':
        reportUpdate({ lastError: `gateway: ${(payload as { message?: string }).message ?? 'error'}` });
        break;
      case 'closed':
        reportUpdate({ closed: true });
        break;
    }
  });
  ws.addEventListener('error', (ev) => {
    log.warn('[athena-offscreen] ws error', ev);
  });
  ws.addEventListener('close', (ev) => {
    log.warn('[athena-offscreen] ws close', { code: ev.code, reason: ev.reason });
    // Clean shutdown (1000) — terminal. Anything else is a candidate for
    // exponential-backoff reconnect (network blip, gateway restart, expired
    // token). Stop trying after MAX_RECONNECT_ATTEMPTS.
    if (!active) return;
    if (ev.code === 1000) {
      reportUpdate({ closed: true, lastError: null });
      return;
    }
    // 4001 = gateway rejected the access token at handshake. Skip the backoff
    // delay so we refresh + retry immediately rather than waiting up to 16s.
    const isAuthFail = ev.code === 4001;
    void scheduleReconnect(`ws_closed_${ev.code} ${ev.reason || ''}`.trim(), isAuthFail);
  });
}

async function scheduleReconnect(reason: string, fastPath = false): Promise<void> {
  if (!active) return;
  const attempt = (active.reconnectAttempt ?? 0) + 1;
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    log.warn('[athena-offscreen] reconnect exhausted', { reason });
    reportUpdate({ closed: true, lastError: `disconnected: ${reason}`, reconnectAttempt: null });
    return;
  }
  active.reconnectAttempt = attempt;
  reportUpdate({ reconnectAttempt: attempt, lastError: `reconnecting (attempt ${attempt})` });
  const delay = fastPath
    ? 0
    : BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 16_000;
  log.debug(`[athena-offscreen] reconnect in ${delay}ms (attempt ${attempt}, fast=${fastPath})`);
  if (delay > 0) await new Promise((res) => setTimeout(res, delay));
  if (!active) return;
  // Refresh the access token via the SW. Token may have expired during the
  // outage; using the stale one would just trigger another close.
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'capture.refreshToken' })) as
      | { ok: true; accessToken: string }
      | { ok: false; error?: string };
    if (r?.ok && r.accessToken) {
      active.accessToken = r.accessToken;
    } else {
      log.warn('[athena-offscreen] refreshToken failed', r);
      reportUpdate({ closed: true, lastError: `auth expired — sign in again`, reconnectAttempt: null });
      await stop('auth_expired');
      return;
    }
  } catch (err) {
    log.warn('[athena-offscreen] refreshToken errored', err);
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

chrome.runtime.onMessage.addListener((msg: OffscreenInbound, _sender, sendResponse) => {
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

// Tell the service worker we're alive and the listener is wired. The SW
// queues `offscreen.start` until this ping arrives so we don't race the
// document's script-evaluation window.
chrome.runtime.sendMessage({ type: 'offscreen.ready' }).catch(() => undefined);

/**
 * Service worker — single source of truth for "is a Meet session active",
 * persists user settings, and forwards captured Meet captions to the api
 * service when the user opts in.
 */
import {
  DEFAULT_SETTINGS,
  MEET_RE,
  type ActiveMeeting,
  type CaptionStats,
  type CaptureStatus,
  type ExtensionSettings,
  type InboxNotification,
  type PersistedState,
  type RuntimeMessage,
} from '../shared/types.js';
import { log } from '../shared/log.js';

async function readState(): Promise<PersistedState> {
  const got = (await chrome.storage.local.get('state')) as {
    state?: Partial<PersistedState>;
  };
  return {
    active: got.state?.active ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(got.state?.settings ?? {}) },
    captionStats: got.state?.captionStats ?? null,
    inbox: got.state?.inbox ?? [],
    inboxSeen: got.state?.inboxSeen ?? [],
    capture: got.state?.capture ?? null,
  };
}

async function writeState(patch: Partial<PersistedState>): Promise<void> {
  const cur = await readState();
  const next: PersistedState = { ...cur, ...patch };
  await chrome.storage.local.set({ state: next });
}

async function setActive(active: ActiveMeeting | null): Promise<void> {
  await writeState({ active, captionStats: null });
  await refreshActionBadge();
  // Auto-create the matching api meeting so caption shipments find a target.
  // Without this, every new Meet requires the user to either open the macOS
  // overlay or manually POST a meeting — neither of which is acceptable for
  // a chrome-only flow.
  if (active) void ensureApiMeeting(active);
}

async function ensureApiMeeting(active: ActiveMeeting): Promise<void> {
  const settings = await getSettings();
  if (!settings.accessToken) return;
  try {
    const r = await signedFetch(`${settings.apiUrl}/v1/meetings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: active.title ?? `Meet — ${active.meetingId}`,
        externalMeetingId: active.meetingId,
      }),
    });
    if (r.ok) {
      const body = (await r.json().catch(() => ({}))) as { id?: string };
      if (body.id) await stashInternalMeetingId(active.meetingId, body.id);
    } else if (r.status === 409 || r.status === 400) {
      // Likely a duplicate-live conflict. Look up the existing live meeting
      // so capture.start can still resolve an internal UUID.
      void resolveInternalMeetingId(active.meetingId);
    }
  } catch {
    // best-effort
  }
}

async function stashInternalMeetingId(externalId: string, internalId: string): Promise<void> {
  const cur = await getActive();
  if (!cur || cur.meetingId !== externalId) return;
  await writeState({ active: { ...cur, internalMeetingId: internalId } });
}

async function resolveInternalMeetingId(externalId: string): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.accessToken) return null;
  try {
    const r = await signedFetch(
      `${settings.apiUrl}/v1/meetings?externalMeetingId=${encodeURIComponent(externalId)}&status=live&limit=1`,
    );
    if (!r.ok) return null;
    const body = (await r.json().catch(() => ({}))) as {
      meetings?: Array<{ id?: string }>;
    };
    const id = body.meetings?.[0]?.id ?? null;
    if (id) await stashInternalMeetingId(externalId, id);
    return id;
  } catch {
    return null;
  }
}

async function refreshActionBadge(): Promise<void> {
  const { active, inbox } = await readState();
  if (active) {
    await chrome.action.setBadgeText({ text: 'M' });
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else if (inbox.length > 0) {
    await chrome.action.setBadgeText({ text: String(Math.min(inbox.length, 99)) });
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function getActive(): Promise<ActiveMeeting | null> {
  return (await readState()).active;
}

async function getSettings(): Promise<ExtensionSettings> {
  return (await readState()).settings;
}

// ─── Auth: refresh + signed fetch ─────────────────────────────────────────
//
// The extension stores both an access token (~15 min) and a refresh token
// (~30 days). signedFetch transparently retries 401s against the api once
// using the refresh token, so the user never has to re-enter creds during
// a normal week. Mirrors apps/cli/src/lib/api.ts:refreshIfNeeded.

interface LoginResponseBody {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

let inFlightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Coalesce concurrent refresh attempts — one in-flight call serves all
  // callers blocked on a 401.
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    const settings = await getSettings();
    if (!settings.refreshToken) return null;
    try {
      const r = await fetch(`${settings.apiUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: settings.refreshToken }),
      });
      if (!r.ok) return null;
      const body = (await r.json()) as LoginResponseBody;
      const next = await getSettings();
      await writeState({
        settings: {
          ...next,
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          expiresAt: body.expiresAt,
        },
      });
      return body.accessToken;
    } catch {
      return null;
    } finally {
      // small delay so a flurry of 401s in the same tick share the same fetch
      setTimeout(() => {
        inFlightRefresh = null;
      }, 50);
    }
  })();
  return inFlightRefresh;
}

/**
 * fetch() wrapper that injects the current access token and, on 401,
 * silently refreshes + retries once. Use everywhere instead of raw fetch
 * for endpoints that require auth.
 *
 * Each call is bounded by an AbortController so a hung backend never wedges
 * the SW alarm callback (e.g. inbox poll firing every 30s).
 */
const SIGNED_FETCH_TIMEOUT_MS = 15_000;

async function signedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const settings = await getSettings();
  const headers = new Headers(init.headers);
  if (settings.accessToken) {
    headers.set('authorization', `Bearer ${settings.accessToken}`);
  }
  const doFetch = async (auth: Headers): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SIGNED_FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, headers: auth, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  let res = await doFetch(headers);
  if (res.status !== 401) return res;
  const fresh = await refreshAccessToken();
  if (!fresh) return res;
  headers.set('authorization', `Bearer ${fresh}`);
  return doFetch(headers);
}

function parseMeetUrl(url: string | undefined): { meetingId: string; meetingUrl: string } | null {
  if (!url) return null;
  const m = MEET_RE.exec(url);
  if (!m || !m[1]) return null;
  return { meetingId: m[1], meetingUrl: `https://meet.google.com/${m[1]}` };
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  const parsed = parseMeetUrl(changeInfo.url ?? tab.url);
  if (!parsed) return;
  const next: ActiveMeeting = {
    meetingId: parsed.meetingId,
    meetingUrl: parsed.meetingUrl,
    title: tab.title ?? null,
    tabId,
    detectedAt: new Date().toISOString(),
    internalMeetingId: null,
  };
  const current = await getActive();
  // Don't clobber another already-attached Meet — first one wins (PRD F1 AC3).
  if (current && current.meetingId !== next.meetingId) return;
  await setActive(next);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const active = await getActive();
  if (active && active.tabId === tabId) {
    await stopCapture('tab_closed').catch(() => undefined);
    await setActive(null);
  }
});

// ─── Caption shipping ──────────────────────────────────────────────────────
//
// One-second batched POST to the api when shipCaptions is enabled and we can
// resolve the Meet's external id to an internal meeting (host'd by the
// authenticated user, scoped to the workspace via JWT).

interface CaptionBuffer {
  meetingId: string; // Meet external id
  pending: Array<{ text: string; speakerLabel: string | null; capturedAt: string }>;
  shipped: number;
  lastError: string | null;
}

const buffers = new Map<string, CaptionBuffer>();
let flushTimer: number | null = null;

function ensureFlushTimer(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(() => void flushBuffers(), 1500) as unknown as number;
}

async function flushBuffers(): Promise<void> {
  if (buffers.size === 0) return;
  const settings = await getSettings();
  if (!settings.shipCaptions || !settings.accessToken) return;

  for (const [externalId, buf] of buffers) {
    if (buf.pending.length === 0) continue;
    const captions = buf.pending.splice(0, buf.pending.length);
    try {
      const res = await signedFetch(`${settings.gatewayUrl}/v1/sessions/captions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ externalMeetingId: externalId, captions }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        buf.lastError = `http ${res.status}: ${text.slice(0, 80)}`;
        // Re-queue so we retry next tick.
        buf.pending.unshift(...captions);
      } else {
        const body = (await res.json()) as { injected?: number; liveSession?: boolean };
        buf.shipped += body.injected ?? captions.length;
        buf.lastError = body.liveSession ? null : 'no_live_session';
      }
    } catch (err) {
      buf.lastError = err instanceof Error ? err.message : 'fetch_failed';
      buf.pending.unshift(...captions);
    }
    await persistStats(buf);
  }
}

async function persistStats(buf: CaptionBuffer): Promise<void> {
  const stats: CaptionStats = {
    meetingId: buf.meetingId,
    internalMeetingId: null,
    shipped: buf.shipped,
    buffered: buf.pending.length,
    lastError: buf.lastError,
  };
  await writeState({ captionStats: stats });
}

async function ingestCaption(msg: Extract<RuntimeMessage, { type: 'meet.caption' }>): Promise<void> {
  const settings = await getSettings();
  if (!settings.shipCaptions || !settings.accessToken) return;

  let buf = buffers.get(msg.meetingId);
  if (!buf) {
    buf = { meetingId: msg.meetingId, pending: [], shipped: 0, lastError: null };
    buffers.set(msg.meetingId, buf);
  }
  buf.pending.push({
    text: msg.text,
    speakerLabel: msg.speakerLabel,
    capturedAt: msg.capturedAt,
  });
  ensureFlushTimer();
}

// ─── Inbox polling ─────────────────────────────────────────────────────────
//
// Service workers may be terminated; chrome.alarms wakes us back up. Poll
// every 30s when an access token is present, mirror the unread feed to
// chrome.storage so the popup can render it, and surface any new entries via
// chrome.notifications (deduped against inboxSeen).

const INBOX_ALARM = 'athena.inbox.poll';

interface ApiInboxResponse {
  unread?: number;
  notifications?: Array<{
    id?: unknown;
    kind?: unknown;
    title?: unknown;
    body?: unknown;
    linkPath?: unknown;
    createdAt?: unknown;
  }>;
}

function normalizeInbox(raw: ApiInboxResponse): InboxNotification[] {
  const rows = raw.notifications ?? [];
  const out: InboxNotification[] = [];
  for (const r of rows) {
    if (
      typeof r.id !== 'string' ||
      typeof r.kind !== 'string' ||
      typeof r.title !== 'string' ||
      typeof r.body !== 'string' ||
      typeof r.createdAt !== 'string'
    ) {
      continue;
    }
    out.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      linkPath: typeof r.linkPath === 'string' ? r.linkPath : null,
      createdAt: r.createdAt,
    });
  }
  return out;
}

async function pollInbox(): Promise<void> {
  const settings = await getSettings();
  if (!settings.accessToken) return;
  let res: Response;
  try {
    res = await signedFetch(`${settings.apiUrl}/v1/notifications?unreadOnly=true&limit=20`);
  } catch {
    return;
  }
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as ApiInboxResponse | null;
  if (!body) return;
  const fresh = normalizeInbox(body);
  const state = await readState();
  const seen = new Set(state.inboxSeen);
  const newOnes = fresh.filter((n) => !seen.has(n.id));
  for (const n of newOnes) {
    chrome.notifications.create(`athena:${n.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: n.title,
      message: n.body,
      priority: 1,
    });
    seen.add(n.id);
  }
  // Bound the seen list — keep it scoped to currently-unread plus a small pad.
  const trimmed = Array.from(seen).slice(-200);
  await writeState({ inbox: fresh, inboxSeen: trimmed });
  await refreshActionBadge();
}

async function ensureInboxPolling(): Promise<void> {
  await chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 0.5, when: Date.now() + 1000 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INBOX_ALARM) {
    void (async () => {
      // Pre-refresh so the next polled call doesn't pay the 401 penalty.
      const s = await getSettings();
      if (s.expiresAt && Date.parse(s.expiresAt) - Date.now() < 60_000) {
        await refreshAccessToken();
      }
      void pollInbox();
      // Also retry any buffered captions whose flush timer died with the
      // service worker. Cheap; no-op when buffers are empty.
      void flushBuffers();
    })();
  }
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith('athena:')) return;
  const id = notifId.slice('athena:'.length);
  const settings = await getSettings();
  // Best-effort mark-as-read so the badge clears next poll.
  if (settings.accessToken) {
    void signedFetch(`${settings.apiUrl}/v1/notifications/${id}/read`, {
      method: 'POST',
    }).catch(() => {});
  }
  chrome.notifications.clear(notifId);
});

chrome.runtime.onInstalled.addListener(() => void ensureInboxPolling());
chrome.runtime.onStartup.addListener(() => void ensureInboxPolling());

// ─── Tab-audio capture lifecycle ──────────────────────────────────────────
//
// MV3 service workers can't hold MediaStreams or AudioContexts. We delegate
// audio handling to an offscreen document (src/offscreen/index.ts) and own
// only the lifecycle here: ensure offscreen exists, mint a tabCapture
// streamId for the active Meet tab, hand the streamId + WS auth to the
// offscreen doc, and surface its progress updates into chrome.storage so the
// popup can render them.

const OFFSCREEN_PATH = 'offscreen/index.html';

async function hasOffscreen(): Promise<boolean> {
  // chrome.offscreen.hasDocument is not exposed; getContexts is the canonical
  // way as of Chrome 116+.
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const ctxs = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [url],
  });
  return ctxs.length > 0;
}

let offscreenReadyPromise: Promise<void> | null = null;

function waitForOffscreenReady(timeoutMs = 4000): Promise<void> {
  if (offscreenReadyPromise) return offscreenReadyPromise;
  offscreenReadyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      offscreenReadyPromise = null;
      reject(new Error('offscreen ready timeout'));
    }, timeoutMs);
    function handler(raw: unknown): undefined {
      const m = raw as { type?: string };
      if (m?.type !== 'offscreen.ready') return undefined;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(handler);
      resolve();
      return undefined;
    }
    chrome.runtime.onMessage.addListener(handler);
  });
  return offscreenReadyPromise;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  // Pre-arm the ready listener BEFORE create — the offscreen doc will
  // evaluate its script and ping us; we won't miss it.
  const ready = waitForOffscreenReady();
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
    justification: 'Capture Google Meet tab audio for live transcription.',
  });
  await ready;
}

async function tearDownOffscreen(): Promise<void> {
  offscreenReadyPromise = null;
  if (await hasOffscreen()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      /* ignore — already closed */
    }
  }
}

async function startCapture(): Promise<{ ok: boolean; error?: string }> {
  const active = await getActive();
  if (!active) return { ok: false, error: 'no Meet detected' };
  const settings = await getSettings();
  if (!settings.accessToken) return { ok: false, error: 'sign in first' };

  // Need the internal UUID — gateway hello frame requires it.
  let internalId = active.internalMeetingId;
  if (!internalId) internalId = await resolveInternalMeetingId(active.meetingId);
  if (!internalId) {
    // Last resort: try creating now (covers fresh-tab cases where meet.detected
    // fired before the user signed in).
    await ensureApiMeeting(active);
    const refreshed = await getActive();
    internalId = refreshed?.internalMeetingId ?? null;
  }
  if (!internalId) return { ok: false, error: 'could not resolve meeting' };

  // Pre-refresh access token — the offscreen doc opens a long-lived WS and
  // can't transparently refresh on a 401 mid-capture.
  if (settings.expiresAt && Date.parse(settings.expiresAt) - Date.now() < 60_000) {
    await refreshAccessToken();
  }
  const fresh = await getSettings();
  const accessToken = fresh.accessToken;
  if (!accessToken) return { ok: false, error: 'sign in first' };

  await ensureOffscreen();

  let streamId: string;
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: active.tabId },
        (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(new Error(chrome.runtime.lastError?.message ?? 'no streamId'));
            return;
          }
          resolve(id);
        },
      );
    });
  } catch (err) {
    await tearDownOffscreen();
    const errMsg = (err as Error).message;
    await writeState({
      capture: {
        meetingId: active.meetingId,
        startedAt: new Date().toISOString(),
        shipped: 0,
        finalsHeard: 0,
        suggestionsHeard: 0,
        lastError: `tabCapture: ${errMsg}`,
        sessionId: null,
        closed: true,
        reconnectAttempt: null,
      },
    });
    return { ok: false, error: errMsg };
  }

  const initial: CaptureStatus = {
    meetingId: active.meetingId,
    startedAt: new Date().toISOString(),
    shipped: 0,
    finalsHeard: 0,
    suggestionsHeard: 0,
    lastError: null,
    sessionId: null,
    closed: false,
    reconnectAttempt: null,
  };
  await writeState({ capture: initial });

  await chrome.runtime.sendMessage({
    type: 'offscreen.start',
    streamId,
    gatewayUrl: fresh.gatewayUrl,
    accessToken,
    meetingId: internalId,
    forceCustomer: fresh.forceCustomer === true,
  });
  return { ok: true };
}

async function stopCapture(reason: string): Promise<{ ok: boolean }> {
  if (await hasOffscreen()) {
    try {
      await chrome.runtime.sendMessage({ type: 'offscreen.stop' });
    } catch {
      /* offscreen may already be torn down */
    }
  }
  await tearDownOffscreen();
  const cur = (await readState()).capture;
  if (cur) {
    await writeState({
      capture: { ...cur, closed: true, lastError: cur.lastError ?? `stopped: ${reason}` },
    });
  }
  return { ok: true };
}

interface OffscreenUpdateMsg {
  type: 'offscreen.update';
  shipped?: number;
  finalsHeard?: number;
  suggestionsHeard?: number;
  lastError?: string | null;
  sessionId?: string | null;
  closed?: boolean;
  reconnectAttempt?: number | null;
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as Partial<OffscreenUpdateMsg>;
  if (msg?.type !== 'offscreen.update') return;
  void (async () => {
    const state = await readState();
    if (!state.capture) return;
    const next: CaptureStatus = {
      ...state.capture,
      shipped: msg.shipped ?? state.capture.shipped,
      finalsHeard: msg.finalsHeard ?? state.capture.finalsHeard,
      suggestionsHeard: msg.suggestionsHeard ?? state.capture.suggestionsHeard,
      lastError: msg.lastError !== undefined ? msg.lastError : state.capture.lastError,
      sessionId: msg.sessionId !== undefined ? msg.sessionId : state.capture.sessionId,
      closed: msg.closed ?? state.capture.closed,
      reconnectAttempt: msg.reconnectAttempt !== undefined ? msg.reconnectAttempt : state.capture.reconnectAttempt,
    };
    await writeState({ capture: next });
    if (next.closed) await tearDownOffscreen();
  })();
});

interface SuggestionForwardMsg {
  type: 'suggestion.forward';
  suggestion: {
    type?: string;
    answerText?: string | null;
    followupText?: string | null;
    confidenceScore?: number;
    rationale?: string;
    sources?: Array<{ documentName?: string | null }>;
  };
}

// Real-time suggestion fan-out: when the gateway pushes `suggestion.generated`,
// the offscreen doc forwards the payload to us and we relay it to the active
// Meet tab's content script, which renders an in-call overlay so the rep
// doesn't need to refresh the dashboard mid-call.
chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as Partial<SuggestionForwardMsg>;
  if (msg?.type !== 'suggestion.forward' || !msg.suggestion) return;
  log.debug('[athena-bg] suggestion.forward received', { hasAnswer: !!msg.suggestion.answerText, hasFollowup: !!msg.suggestion.followupText });
  void (async () => {
    const active = await getActive();
    if (!active || active.tabId < 0) {
      log.debug('[athena-bg] overlay relay: no active tab');
      return;
    }
    // Try the top frame first; if no listener, broadcast to all frames.
    // Meet's UI lives in iframes, but our content script matches the top
    // frame; the fallback covers Meet variants that swap the top document.
    try {
      await chrome.tabs.sendMessage(
        active.tabId,
        { type: 'overlay.suggestion', suggestion: msg.suggestion },
        { frameId: 0 },
      );
    } catch {
      try {
        await chrome.tabs.sendMessage(active.tabId, {
          type: 'overlay.suggestion',
          suggestion: msg.suggestion,
        });
      } catch (errBcast) {
        log.warn('[athena-bg] overlay relay failed', (errBcast as Error).message);
      }
    }
  })();
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'meet.detected') {
      await setActive({
        meetingId: msg.meetingId,
        meetingUrl: msg.meetingUrl,
        title: msg.title,
        tabId: msg.tabId,
        detectedAt: msg.detectedAt,
        internalMeetingId: null,
      });
      sendResponse({ ok: true });
    } else if (msg.type === 'meet.left') {
      const active = await getActive();
      if (active && active.meetingId === msg.meetingId) {
        await stopCapture('meet_left').catch(() => undefined);
        await setActive(null);
      }
      buffers.delete(msg.meetingId);
      sendResponse({ ok: true });
    } else if (msg.type === 'meet.caption') {
      await ingestCaption(msg);
      sendResponse({ ok: true });
    } else if (msg.type === 'settings.save') {
      // Wipe stale lastError so the popup doesn't keep showing the old 401.
      await writeState({
        settings: { ...DEFAULT_SETTINGS, ...msg.settings },
        captionStats: null,
      });
      void ensureInboxPolling();
      void pollInbox();
      // Force an immediate re-flush of any buffered captions with the new
      // token. The setInterval timer may be dead from SW eviction.
      void flushBuffers();
      sendResponse({ ok: true });
    } else if (msg.type === 'popup.query') {
      const state = await readState();
      sendResponse({
        active: state.active,
        settings: state.settings,
        captionStats: state.captionStats,
        inbox: state.inbox,
        capture: state.capture,
      });
    } else if (msg.type === 'capture.start') {
      const r = await startCapture();
      sendResponse(r);
    } else if (msg.type === 'capture.stop') {
      const r = await stopCapture('user');
      sendResponse(r);
    } else if (msg.type === 'capture.refreshToken') {
      // Offscreen calls this right before reopening the WS during a reconnect.
      // We refresh proactively (cheap if not expired) and hand back the
      // fresh access token. If refresh fails, return ok:false so the
      // offscreen can stop trying.
      try {
        await refreshAccessToken();
        const s = await getSettings();
        if (!s.accessToken) {
          sendResponse({ ok: false, error: 'no_token' });
          return;
        }
        sendResponse({ ok: true, accessToken: s.accessToken });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
    } else if (msg.type === 'inbox.markRead') {
      const settings = await getSettings();
      if (settings.accessToken) {
        await signedFetch(`${settings.apiUrl}/v1/notifications/${msg.id}/read`, {
          method: 'POST',
        }).catch(() => {});
      }
      const state = await readState();
      await writeState({ inbox: state.inbox.filter((n) => n.id !== msg.id) });
      await refreshActionBadge();
      sendResponse({ ok: true });
    } else if (msg.type === 'auth.login') {
      try {
        const settings = await getSettings();
        const r = await fetch(`${settings.apiUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: msg.email,
            password: msg.password,
            ...(msg.workspaceSlug ? { workspaceSlug: msg.workspaceSlug } : {}),
          }),
        });
        const body = (await r.json().catch(() => ({}))) as
          | (LoginResponseBody & { error?: string; message?: string })
          | undefined;
        if (!r.ok || !body?.accessToken) {
          sendResponse({
            ok: false,
            error: body?.message ?? `sign-in failed (HTTP ${r.status})`,
          });
          return;
        }
        await writeState({
          settings: {
            ...settings,
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresAt: body.expiresAt,
            userEmail: msg.email,
          },
          captionStats: null,
        });
        void ensureInboxPolling();
        void pollInbox();
        void flushBuffers();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'sign-in failed',
        });
      }
    } else if (msg.type === 'auth.logout') {
      await stopCapture('logout').catch(() => undefined);
      const settings = await getSettings();
      await writeState({
        settings: {
          ...settings,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          userEmail: null,
        },
        captionStats: null,
        capture: null,
      });
      sendResponse({ ok: true });
    } else if (msg.type === 'demo.injectCaptions') {
      // Demo path: ship 3 canned objections through the same gateway
      // endpoint a content-script caption capture would use. Lets the rep
      // verify the coach loop without depending on Meet's caption DOM.
      try {
        const settings = await getSettings();
        if (!settings.accessToken) {
          sendResponse({ ok: false, error: 'sign in first' });
          return;
        }
        const captions = [
          { text: 'Honestly, this is way too expensive for what we get.', speakerLabel: 'Customer' },
          { text: 'We already have a vendor that handles this for us.', speakerLabel: 'Customer' },
          { text: 'Just send me an email and I will think about it.', speakerLabel: 'Customer' },
        ];
        const r = await signedFetch(`${settings.gatewayUrl}/v1/sessions/captions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ externalMeetingId: msg.meetingId, captions }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          sendResponse({ ok: false, error: `HTTP ${r.status} ${txt.slice(0, 100)}` });
          return;
        }
        const body = (await r.json()) as { injected?: number; meetingId?: string };
        sendResponse({ ok: true, injected: body.injected ?? captions.length });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'inject failed',
        });
      }
    } else {
      sendResponse({ ok: true });
    }
  })();
  return true; // keep the channel open for async sendResponse
});

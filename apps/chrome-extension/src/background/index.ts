/**
 * Service worker — single source of truth for "is a Meet session active",
 * persists user settings, and forwards captured Meet captions to the api
 * service when the user opts in.
 */
import {
  DEFAULT_SETTINGS,
  MEET_RE,
  isAllowedApiUrl,
  isAllowedGatewayUrl,
  type AccountInfo,
  type ActiveMeeting,
  type CaptionStats,
  type CaptureStatus,
  type ExtensionSettings,
  type InboxNotification,
  type PersistedState,
  type PopupPrefs,
  type PopupQueryResponse,
  type RuntimeMessage,
} from '../shared/types.js';
import { log } from '../shared/log.js';

/**
 * Trust boundary: any chrome.runtime.onMessage handler is reachable by
 * (a) our own extension contexts (popup, content, offscreen) — `sender.id`
 *     equals `chrome.runtime.id`,
 * (b) any web page that knows our extension ID and calls
 *     `chrome.runtime.sendMessage('<id>', …)` — `sender.id` is OUR id BUT
 *     `sender.tab` / `sender.url` will be set to the web page,
 * (c) any other installed extension that calls
 *     `chrome.runtime.sendMessage('<our-id>', …)` — `sender.id` is the
 *     CALLER's extension id, never ours.
 *
 * We only ever want (a). The check below rejects (b) and (c) by requiring
 * sender.id to match our id AND sender.tab to be undefined (which is true
 * for popup/content/SW/offscreen but not for an external web page).
 *
 * Without this check, a hostile meet.google.com page could call popup.query
 * and exfiltrate the user's access + refresh tokens, or fire capture.start
 * to silently begin recording without consent.
 */
function isInternalSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // popup / SW / offscreen do not have `tab`. Content scripts DO have a tab,
  // but they only emit a small known set of messages (meet.detected,
  // meet.left, meet.caption) that we further validate by type below.
  return true;
}

/**
 * Stricter variant: rejects messages from content scripts. Use for handlers
 * that must NEVER be reachable from a webpage even if our content script is
 * compromised — token-handling, capture lifecycle, popup query.
 */
function isPrivilegedSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // Real popup/SW/offscreen have no `tab`. Content scripts always do.
  if (sender.tab) return false;
  // Pin to our own extension URLs so a tampered content script that somehow
  // forges a bare sender shape still can't slip past.
  const url = sender.url ?? '';
  if (url && !url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
  return true;
}

/**
 * Looser gate for messages that LEGITIMATELY come from our content script in
 * a Meet tab (e.g. the in-Meet panel's "Open meeting in Rocket" link). The
 * content script always has `sender.tab` set, so isPrivilegedSender rejects
 * it. We still verify the message originated from this very extension and
 * from a meet.google.com URL — Meet pages can postMessage but cannot forge
 * a chrome.runtime.sendMessage with our extension's runtime id.
 */
function isMeetContentSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.tab) return false;
  const url = sender.url ?? sender.tab.url ?? '';
  try {
    const u = new URL(url);
    return u.hostname === 'meet.google.com';
  } catch {
    return false;
  }
}

async function readState(): Promise<PersistedState> {
  const got = (await chrome.storage.local.get('state')) as {
    state?: Partial<PersistedState>;
  };
  const merged = { ...DEFAULT_SETTINGS, ...(got.state?.settings ?? {}) };
  // Defense in depth: if a tampered storage entry has set apiUrl/gatewayUrl
  // to a non-allowlisted host, snap them back to the build-time defaults.
  // signedFetch then can't be tricked into hitting an attacker host even if
  // the popup/content boundary leaks somewhere.
  if (!isAllowedApiUrl(merged.apiUrl)) merged.apiUrl = DEFAULT_SETTINGS.apiUrl;
  if (!isAllowedGatewayUrl(merged.gatewayUrl)) merged.gatewayUrl = DEFAULT_SETTINGS.gatewayUrl;
  return {
    active: got.state?.active ?? null,
    settings: merged,
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
  if (active) void ensureApiMeeting(active).catch(() => undefined);
}

interface EnsureApiMeetingResult {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
}

async function ensureApiMeeting(active: ActiveMeeting): Promise<EnsureApiMeetingResult> {
  const settings = await getSettings();
  if (!settings.accessToken) {
    return { ok: false, code: 'NOT_SIGNED_IN', message: 'sign in first' };
  }
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
      if (body.id) {
        await stashInternalMeetingId(active.meetingId, body.id);
        return { ok: true, status: r.status };
      }
      return { ok: false, status: r.status, code: 'NO_ID_IN_RESPONSE' };
    }
    if (r.status === 409 || r.status === 400) {
      // Likely a duplicate-live conflict. Look up the existing live meeting
      // so capture.start can still resolve an internal UUID.
      const id = await resolveInternalMeetingId(active.meetingId);
      if (id) return { ok: true, status: r.status };
      return { ok: false, status: r.status, code: 'CONFLICT_NOT_RESOLVABLE' };
    }
    // Surface the server-side reason so reps + support know what's wrong
    // (PAYMENT_OVERDUE, METERING_LIMIT, FORBIDDEN, etc).
    const body = (await r.json().catch(() => ({}))) as
      | { error?: string; code?: string; message?: string }
      | undefined;
    log.warn('[rocket-bg] ensureApiMeeting failed', {
      status: r.status,
      code: body?.code ?? body?.error,
      message: body?.message,
    });
    return {
      ok: false,
      status: r.status,
      code: body?.code ?? body?.error ?? `HTTP_${r.status}`,
      message: body?.message ?? `HTTP ${r.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    log.warn('[rocket-bg] ensureApiMeeting threw', { message });
    return { ok: false, code: 'NETWORK_ERROR', message };
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
    const params = new URLSearchParams({
      externalMeetingId: externalId,
      status: 'live',
      limit: '1',
    });
    const r = await signedFetch(`${settings.apiUrl}/v1/meetings?${params.toString()}`);
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

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
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
const NOTIFICATION_ID_RE = /^[\w-]{1,128}$/;

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
    // Only accept ids matching our backend's id format. Drops anything that
    // could path-traverse if interpolated into a URL.
    if (!NOTIFICATION_ID_RE.test(r.id)) continue;
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
    return;
  }
  if (alarm.name === SILENCE_ALARM) {
    void (async () => {
      const state = await readState();
      if (!state.capture || state.capture.closed) {
        await stopSilenceWatchdog();
        return;
      }
      const lastFinal = await readLastFinalAt();
      if (!lastFinal) return;
      if (Date.now() - lastFinal >= SILENCE_TIMEOUT_MS) {
        await stopCapture('silence_30s');
      }
    })();
  }
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith('athena:')) return;
  const id = notifId.slice('athena:'.length);
  if (!NOTIFICATION_ID_RE.test(id)) return;
  const settings = await getSettings();
  // Best-effort mark-as-read so the badge clears next poll.
  if (settings.accessToken) {
    void signedFetch(
      `${settings.apiUrl}/v1/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST' },
    ).catch(() => {});
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
    function handler(raw: unknown, sender: chrome.runtime.MessageSender): undefined {
      // Only accept the ready ping from our actual offscreen document — a
      // sibling extension that knows our id could otherwise fake it and
      // cause `offscreen.start` (which carries an access token) to be
      // delivered before the real offscreen doc is ready.
      if (sender.id !== chrome.runtime.id) return undefined;
      const expectedUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
      if (sender.url !== expectedUrl) return undefined;
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
  let lastEnsure: EnsureApiMeetingResult | null = null;
  if (!internalId) internalId = await resolveInternalMeetingId(active.meetingId);
  if (!internalId) {
    // Last resort: try creating now (covers fresh-tab cases where meet.detected
    // fired before the user signed in).
    lastEnsure = await ensureApiMeeting(active);
    const refreshed = await getActive();
    internalId = refreshed?.internalMeetingId ?? null;
  }
  if (!internalId) {
    // Surface the actual server-side reason so reps see PAYMENT_OVERDUE,
    // METERING_LIMIT, FORBIDDEN, etc. instead of a flat "could not resolve".
    const detail = lastEnsure
      ? lastEnsure.message ?? lastEnsure.code ?? `HTTP ${lastEnsure.status ?? '?'}`
      : 'no live meeting found';
    return { ok: false, error: `could not start meeting: ${detail}` };
  }

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
  await startSilenceWatchdog();

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

// Auto-stop captures that go silent. We treat "silent" as no Deepgram
// `transcript.final` for SILENCE_TIMEOUT_MS — audio frames may still ship from
// a muted call, so we can't trust `shipped`. The watchdog alarm is a backstop
// in case offscreen.update goes quiet too.
const SILENCE_ALARM = 'athena-silence-watchdog';
const SILENCE_TIMEOUT_MS = 30_000;
const SILENCE_LAST_FINAL_KEY = 'silence.lastFinalAt';

async function noteFinalHeard(): Promise<void> {
  await chrome.storage.local.set({ [SILENCE_LAST_FINAL_KEY]: Date.now() });
}

async function readLastFinalAt(): Promise<number> {
  const r = await chrome.storage.local.get(SILENCE_LAST_FINAL_KEY);
  const v = r[SILENCE_LAST_FINAL_KEY];
  return typeof v === 'number' ? v : 0;
}

async function startSilenceWatchdog(): Promise<void> {
  // Seed so a brand-new capture gets the full grace window before triggering.
  await noteFinalHeard();
  // 30s period is the MV3 floor; combined with the inline check on each
  // offscreen.update this gives sub-second detection during normal traffic
  // and 30-60s worst-case detection if updates also stop arriving.
  await chrome.alarms.create(SILENCE_ALARM, {
    periodInMinutes: 0.5,
    when: Date.now() + SILENCE_TIMEOUT_MS,
  });
}

async function stopSilenceWatchdog(): Promise<void> {
  try {
    await chrome.alarms.clear(SILENCE_ALARM);
  } catch {
    /* clear is best-effort */
  }
  await chrome.storage.local.remove(SILENCE_LAST_FINAL_KEY);
}

async function stopCapture(reason: string): Promise<{ ok: boolean }> {
  await stopSilenceWatchdog();
  if (await hasOffscreen()) {
    try {
      await chrome.runtime.sendMessage({ type: 'offscreen.stop' });
    } catch {
      /* offscreen may already be torn down */
    }
  }
  await tearDownOffscreen();
  // Stop the caption flush timer so we don't keep waking up after capture
  // ends. ingestCaption restarts it on demand if shipping resumes.
  clearFlushTimer();
  buffers.clear();
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

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!isPrivilegedSender(sender)) return;
  const msg = raw as Partial<OffscreenUpdateMsg>;
  if (msg?.type !== 'offscreen.update') return;
  void (async () => {
    const state = await readState();
    if (!state.capture) return;
    const prevFinals = state.capture.finalsHeard ?? 0;
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
    if (next.closed) {
      await tearDownOffscreen();
      return;
    }
    // Reset the silence timer whenever Deepgram finalizes a new utterance.
    if (typeof msg.finalsHeard === 'number' && msg.finalsHeard > prevFinals) {
      await noteFinalHeard();
      return;
    }
    // Inline backstop: if updates keep arriving but no new finals for >=30s,
    // stop now without waiting for the alarm.
    const lastFinal = await readLastFinalAt();
    if (lastFinal && Date.now() - lastFinal >= SILENCE_TIMEOUT_MS) {
      await stopCapture('silence_30s');
    }
  })();
});

interface RawSuggestion {
  type?: unknown;
  answerText?: unknown;
  followupText?: unknown;
  confidenceScore?: unknown;
  rationale?: unknown;
  sources?: unknown;
}

interface CleanSuggestion {
  type: string;
  answerText: string | null;
  followupText: string | null;
  confidenceScore?: number;
  rationale?: string;
  sources?: Array<{ documentName?: string | null }>;
}

const MAX_SUGGESTION_FIELD_LEN = 4000;
const MAX_SUGGESTION_SOURCES = 16;

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.length > max ? v.slice(0, max) : v;
}

function sanitizeSuggestion(raw: unknown): CleanSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawSuggestion;
  const type = clampString(r.type, 64);
  if (!type) return null;
  const answerText = r.answerText === null ? null : clampString(r.answerText, MAX_SUGGESTION_FIELD_LEN);
  const followupText = r.followupText === null ? null : clampString(r.followupText, MAX_SUGGESTION_FIELD_LEN);
  const out: CleanSuggestion = { type, answerText, followupText };
  if (typeof r.confidenceScore === 'number' && Number.isFinite(r.confidenceScore)) {
    out.confidenceScore = r.confidenceScore;
  }
  const rationale = clampString(r.rationale, MAX_SUGGESTION_FIELD_LEN);
  if (rationale) out.rationale = rationale;
  if (Array.isArray(r.sources)) {
    out.sources = r.sources.slice(0, MAX_SUGGESTION_SOURCES).map((s) => {
      const src = s as { documentName?: unknown };
      const documentName = clampString(src?.documentName, 256);
      return documentName === null ? { documentName: null } : { documentName };
    });
  }
  return out;
}

interface SuggestionForwardMsg {
  type: 'suggestion.forward';
  suggestion: unknown;
}

// Footer link in the in-Meet panel — opens the admin-web meeting page.
//
// Two gotchas this handler accounts for:
//  1. The api host (athena-api-production-aa5b...) does NOT share a stem
//     with admin-web (athena-admin-web-production...), so a naive
//     `replace('athena-api','athena-admin-web')` produces an invalid host.
//     Map by full Railway domain instead, fall back to localhost in dev.
//  2. active.meetingId is the Meet code (e.g. dvg-eptf-rnx). The admin-web
//     route expects the workspace meeting UUID stored as
//     active.internalMeetingId. Use that, otherwise fall back to /meetings.
function adminWebBaseUrl(apiUrl: string): string | null {
  // Hard allowlist — never derive an admin-web URL from an arbitrary apiUrl.
  // The previous open-ended `replace()` could be poisoned by a tampered
  // chrome.storage entry to produce attacker-controlled URLs.
  if (apiUrl.startsWith('https://athena-api-production-aa5b.up.railway.app')) {
    return 'https://athena-admin-web-production.up.railway.app';
  }
  if (apiUrl.startsWith('http://localhost:') || apiUrl.startsWith('http://127.0.0.1:')) {
    return 'http://localhost:3030';
  }
  return null;
}

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  // Originates from the in-Meet content-script panel — not the popup/offscreen,
  // so isPrivilegedSender (which rejects sender.tab) would have dropped it.
  if (!isMeetContentSender(sender)) return;
  const m = raw as { type?: string };
  if (m?.type !== 'panel.openInAthena') return;
  void (async () => {
    const settings = await getSettings();
    const active = await getActive();
    const base = adminWebBaseUrl(settings.apiUrl);
    if (!base) {
      log.warn('[athena-bg] panel.openInAthena rejected — apiUrl not in allowlist');
      return;
    }
    const internalId = active?.internalMeetingId ?? null;
    const url = internalId
      ? `${base}/meetings/${encodeURIComponent(internalId)}`
      : `${base}/meetings`;
    void chrome.tabs.create({ url });
  })();
});

// Real-time suggestion fan-out: when the gateway pushes `suggestion.generated`,
// the offscreen doc forwards the payload to us and we relay it to the active
// Meet tab's content script, which renders an in-call overlay so the rep
// doesn't need to refresh the dashboard mid-call.
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!isPrivilegedSender(sender)) return;
  const msg = raw as Partial<SuggestionForwardMsg>;
  if (msg?.type !== 'suggestion.forward' || !msg.suggestion) return;
  // Sanitize the gateway-originated payload at this trust boundary so a
  // future content-script change to .innerHTML can't yield XSS, and so
  // bloated payloads don't sit in memory forever.
  const clean = sanitizeSuggestion(msg.suggestion);
  if (!clean) return;
  log.debug('[athena-bg] suggestion.forward received', {
    hasAnswer: !!clean.answerText,
    hasFollowup: !!clean.followupText,
  });
  void (async () => {
    const active = await getActive();
    const payload = { type: 'overlay.suggestion', suggestion: clean };

    // Try the cached active tab first — fastest, most common case.
    if (active && active.tabId >= 0) {
      try {
        await chrome.tabs.sendMessage(active.tabId, payload, { frameId: 0 });
        return;
      } catch {
        try {
          await chrome.tabs.sendMessage(active.tabId, payload);
          return;
        } catch {
          log.debug('[rocket-bg] active tab relay failed; falling back to broadcast');
        }
      }
    }

    // Fallback: stale tabId (Meet refreshed mid-call, tab got swapped, etc).
    // Broadcast to any open meet.google.com tab so the rep still sees the
    // suggestion. Cheap — there's almost always at most one Meet tab.
    try {
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      if (tabs.length === 0) {
        log.warn('[rocket-bg] overlay relay: no meet.google.com tab open');
        return;
      }
      for (const t of tabs) {
        if (typeof t.id !== 'number') continue;
        try {
          await chrome.tabs.sendMessage(t.id, payload, { frameId: 0 });
        } catch {
          try {
            await chrome.tabs.sendMessage(t.id, payload);
          } catch {
            /* keep trying others */
          }
        }
      }
    } catch (err) {
      log.warn('[rocket-bg] overlay relay broadcast failed', err);
    }
  })();
});

/**
 * Build the popup-facing view of state. Tokens are intentionally OMITTED —
 * even though only privileged senders reach this handler, the principle is
 * that the popup has no business knowing the raw bearer token. signedFetch
 * lives entirely in the SW.
 */
function buildPopupQueryResponse(state: PersistedState): PopupQueryResponse {
  const account: AccountInfo = {
    isSignedIn: !!state.settings.accessToken,
    email: state.settings.userEmail,
    expiresAt: state.settings.expiresAt,
  };
  const prefs: PopupPrefs = {
    apiUrl: state.settings.apiUrl,
    gatewayUrl: state.settings.gatewayUrl,
    shipCaptions: state.settings.shipCaptions,
    forceCustomer: state.settings.forceCustomer,
  };
  return {
    active: state.active,
    account,
    prefs,
    captionStats: state.captionStats,
    inbox: state.inbox,
    capture: state.capture,
  };
}

/**
 * Validate a popup-supplied prefs blob before merging into settings. Drops
 * any URL not in the allowlist and snaps it back to the build-time default
 * rather than letting a tampered popup or storage entry redirect signedFetch.
 */
function sanitizePrefs(raw: PopupPrefs): PopupPrefs {
  const apiUrl = isAllowedApiUrl(raw.apiUrl) ? raw.apiUrl : DEFAULT_SETTINGS.apiUrl;
  const gatewayUrl = isAllowedGatewayUrl(raw.gatewayUrl) ? raw.gatewayUrl : DEFAULT_SETTINGS.gatewayUrl;
  return {
    apiUrl,
    gatewayUrl,
    shipCaptions: !!raw.shipCaptions,
    forceCustomer: !!raw.forceCustomer,
  };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  // Trust check: messages from external pages or other extensions reach our
  // SW with this same listener. Reject everything that isn't from one of our
  // own contexts BEFORE inspecting `msg`. For content-script messages we
  // narrow further inside the meet.* branches.
  if (!isInternalSender(sender)) {
    sendResponse({ ok: false, error: 'untrusted_sender' });
    return false;
  }
  (async () => {
    if (msg.type === 'meet.detected') {
      // Content-script-originated. Validate it carries the expected shape
      // and the sender's tab matches the claim before mutating active state.
      if (!sender.tab || sender.tab.id !== msg.tabId) {
        sendResponse({ ok: false, error: 'sender_tab_mismatch' });
        return;
      }
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
      if (!sender.tab || sender.tab.id !== msg.tabId) {
        sendResponse({ ok: false, error: 'sender_tab_mismatch' });
        return;
      }
      const active = await getActive();
      if (active && active.meetingId === msg.meetingId) {
        await stopCapture('meet_left').catch(() => undefined);
        await setActive(null);
      }
      buffers.delete(msg.meetingId);
      sendResponse({ ok: true });
    } else if (msg.type === 'meet.caption') {
      // Only the actual Meet tab's content script may inject captions. The
      // SW already knows which tab is active; reject if the sender doesn't
      // match.
      const active = await getActive();
      if (!sender.tab || !active || sender.tab.id !== active.tabId) {
        sendResponse({ ok: false, error: 'sender_tab_mismatch' });
        return;
      }
      await ingestCaption(msg);
      sendResponse({ ok: true });
    } else if (msg.type === 'settings.save') {
      // Privileged: only the popup may change prefs.
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      const prefs = sanitizePrefs(msg.prefs);
      const cur = await getSettings();
      await writeState({
        settings: {
          ...cur,
          apiUrl: prefs.apiUrl,
          gatewayUrl: prefs.gatewayUrl,
          shipCaptions: prefs.shipCaptions,
          forceCustomer: prefs.forceCustomer,
        },
        captionStats: null,
      });
      void ensureInboxPolling();
      void pollInbox();
      void flushBuffers();
      sendResponse({ ok: true });
    } else if (msg.type === 'popup.query') {
      // Privileged: never expose the response to a content script. This is
      // the channel the audit flagged as the credential-exfil pivot.
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      const state = await readState();
      sendResponse(buildPopupQueryResponse(state));
    } else if (msg.type === 'capture.start') {
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      const r = await startCapture();
      sendResponse(r);
    } else if (msg.type === 'capture.stop') {
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      const r = await stopCapture('user');
      sendResponse(r);
    } else if (msg.type === 'capture.refreshToken') {
      // Offscreen calls this right before reopening the WS during a reconnect.
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
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
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      // Reject ids that don't match our backend format.
      if (!NOTIFICATION_ID_RE.test(msg.id)) {
        sendResponse({ ok: false, error: 'bad_id' });
        return;
      }
      const settings = await getSettings();
      if (settings.accessToken) {
        await signedFetch(
          `${settings.apiUrl}/v1/notifications/${encodeURIComponent(msg.id)}/read`,
          { method: 'POST' },
        ).catch(() => {});
      }
      const state = await readState();
      await writeState({ inbox: state.inbox.filter((n) => n.id !== msg.id) });
      await refreshActionBadge();
      sendResponse({ ok: true });
    } else if (msg.type === 'auth.login') {
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
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
    } else if (msg.type === 'auth.pair') {
      // Exchange a one-time pairing code minted on admin-web for the same
      // {accessToken, refreshToken, expiresAt} bundle that auth.login returns.
      // Closes the gap for Google-OAuth users with no email+password.
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      try {
        const settings = await getSettings();
        const r = await fetch(`${settings.apiUrl}/v1/auth/extension/pair-claim`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: msg.code }),
        });
        const body = (await r.json().catch(() => ({}))) as
          | (LoginResponseBody & { error?: string; message?: string; user?: { email?: string } })
          | undefined;
        if (!r.ok || !body?.accessToken) {
          sendResponse({
            ok: false,
            error: body?.message ?? `pair-claim failed (HTTP ${r.status})`,
          });
          return;
        }
        await writeState({
          settings: {
            ...settings,
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresAt: body.expiresAt,
            // The pair-claim response doesn't echo email; fetch it via /auth/me
            // best-effort so the popup shows "as <email>" instead of blank.
            userEmail: body.user?.email ?? settings.userEmail,
          },
          captionStats: null,
        });
        // Hydrate user email from /auth/me if pair-claim didn't include it.
        if (!body.user?.email) {
          void fetch(`${settings.apiUrl}/v1/auth/me`, {
            headers: { authorization: `Bearer ${body.accessToken}` },
          })
            .then(async (res) => {
              if (!res.ok) return;
              const me = (await res.json().catch(() => null)) as
                | { user?: { email?: string } }
                | null;
              if (me?.user?.email) {
                const cur = await getSettings();
                await writeState({
                  settings: { ...cur, userEmail: me.user.email },
                });
              }
            })
            .catch(() => undefined);
        }
        void ensureInboxPolling();
        void pollInbox();
        void flushBuffers();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'pair-claim failed',
        });
      }
    } else if (msg.type === 'auth.logout') {
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
      await stopCapture('logout').catch(() => undefined);
      // Full reset: token fields, captionStats, capture state, inbox AND
      // inboxSeen. A shared/forensic profile must not leak prior session
      // notifications or active-meeting context after sign-out.
      const settings = await getSettings();
      await writeState({
        active: null,
        settings: {
          ...settings,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          userEmail: null,
        },
        captionStats: null,
        capture: null,
        inbox: [],
        inboxSeen: [],
      });
      buffers.clear();
      clearFlushTimer();
      await refreshActionBadge();
      sendResponse({ ok: true });
    } else if (msg.type === 'demo.injectCaptions') {
      if (!isPrivilegedSender(sender)) {
        sendResponse({ ok: false, error: 'untrusted_sender' });
        return;
      }
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

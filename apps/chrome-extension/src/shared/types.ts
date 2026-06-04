/** Messages on the chrome.runtime bus. */
export type RuntimeMessage =
  | {
      type: 'meet.detected';
      tabId: number;
      meetingUrl: string;
      meetingId: string;
      title: string | null;
      detectedAt: string;
    }
  | { type: 'meet.left'; tabId: number; meetingId: string }
  | {
      type: 'meet.caption';
      meetingId: string;
      text: string;
      speakerLabel: string | null;
      capturedAt: string;
    }
  | { type: 'popup.query' }
  | { type: 'settings.save'; prefs: PopupPrefs }
  | { type: 'inbox.markRead'; id: string }
  | { type: 'auth.login'; email: string; password: string; workspaceSlug?: string }
  | { type: 'auth.pair'; code: string }
  | { type: 'auth.logout' }
  | { type: 'demo.injectCaptions'; meetingId: string }
  // streamId is minted by the popup via chrome.tabCapture.getMediaStreamId
  // BEFORE this message is sent. Chrome MV3 raises "Extension has not been
  // invoked for the current page" if getMediaStreamId runs from a
  // chrome.runtime.onMessage handler — the user-invocation context doesn't
  // propagate through message passing. The popup IS a valid invocation
  // surface, so it mints the streamId and ships it to the SW.
  | { type: 'capture.start'; streamId: string }
  | { type: 'capture.stop' }
  | { type: 'capture.refreshToken' };

/** chrome.storage.local shape. */
export interface PersistedState {
  active: ActiveMeeting | null;
  settings: ExtensionSettings;
  captionStats: CaptionStats | null;
  inbox: InboxNotification[];
  /** Notification IDs already surfaced as chrome.notifications. */
  inboxSeen: string[];
  /** Live tab-audio capture state — null when not capturing. */
  capture: CaptureStatus | null;
}

export interface CaptureStatus {
  /** External Meet code (e.g. "abc-defg-hij") of the meeting being captured. */
  meetingId: string;
  startedAt: string;
  /** Audio frames pushed to the WS so far. */
  shipped: number;
  /** Final transcript segments echoed back from the gateway. */
  finalsHeard: number;
  /** Suggestion frames echoed back from the gateway. */
  suggestionsHeard: number;
  lastError: string | null;
  sessionId: string | null;
  /** Set true when the WS closes — popup uses this to flip the toggle. */
  closed: boolean;
  /** Non-null while the offscreen WS is in the middle of a backoff loop. */
  reconnectAttempt: number | null;
}

export interface InboxNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkPath: string | null;
  createdAt: string;
}

export interface ExtensionSettings {
  apiUrl: string;
  /** Realtime-gateway base URL — captions ship here for live coach injection. */
  gatewayUrl: string;
  accessToken: string | null;
  /** 30-day rotating refresh token — survives access-token expiry. */
  refreshToken: string | null;
  /** ISO date when accessToken expires; used for proactive refresh. */
  expiresAt: string | null;
  /** Email of the signed-in user — shown in popup. */
  userEmail: string | null;
  /** Off by default. User opts in with consent banner. */
  shipCaptions: boolean;
  /** Solo-test mode: classify every diarized turn as customer so the coach
   * fires on the rep's own voice. Dev-only — never enable for real calls. */
  forceCustomer: boolean;
}

export interface CaptionStats {
  meetingId: string;
  /** Internal meeting UUID resolved via the api when shipping captions. */
  internalMeetingId: string | null;
  shipped: number;
  buffered: number;
  lastError: string | null;
}

export interface ActiveMeeting {
  meetingId: string;
  meetingUrl: string;
  title: string | null;
  tabId: number;
  detectedAt: string;
  /** Resolved internal meeting UUID (populated by ensureApiMeeting). Required
   * by the gateway WS hello frame which expects a UUID, not the Meet code. */
  internalMeetingId: string | null;
}

/**
 * Sanitized popup view of the current account. Tokens are NEVER returned to
 * the popup process — the SW owns them. This prevents a compromised
 * meet.google.com page (which can fire chrome.runtime.sendMessage) from
 * exfiltrating credentials via popup.query.
 */
/**
 * Three-state auth model so the UI distinguishes a recoverable expired access
 * token from a genuinely-ended session:
 *  - 'valid'       access token present and not past expiry
 *  - 'refreshable' access token expired but a refresh token is present (the
 *                  background silently refreshes — STILL shows as signed-in)
 *  - 'signed-out'  no refresh token, or the refresh token was rejected
 * Consumed by the popup/panel in PR-G; defined here so all surfaces agree.
 */
export type AuthState = 'valid' | 'refreshable' | 'signed-out';

export interface AccountInfo {
  /** Derived: state !== 'signed-out'. Kept for backward-compat with callers
   *  that haven't migrated to `state` yet. */
  isSignedIn: boolean;
  /** Validity-aware auth state (see AuthState). Optional during PR-G migration. */
  state?: AuthState;
  email: string | null;
  /** Stable hint for the popup so it can show "session expires in N min". */
  expiresAt: string | null;
}

/**
 * WebSocket close codes for auth failures. ADDITIVE: 4001 keeps its original
 * meaning (any auth failure) so already-deployed clients are never bricked;
 * 4011 is the new, narrower "token expired — refresh and reconnect" signal the
 * gateway emits to version-aware clients (PR-F/PR-G).
 */
export const WS_CLOSE_TOKEN_INVALID = 4001;
export const WS_CLOSE_TOKEN_EXPIRED = 4011;

/**
 * User-controllable preferences. Excludes credentials. Used in both the
 * popup.query response AND the settings.save request so the wire shape is
 * symmetric and the popup never has the chance to round-trip a token.
 */
export interface PopupPrefs {
  apiUrl: string;
  gatewayUrl: string;
  shipCaptions: boolean;
  forceCustomer: boolean;
}

export interface PopupQueryResponse {
  active: ActiveMeeting | null;
  account: AccountInfo;
  prefs: PopupPrefs;
  captionStats: CaptionStats | null;
  inbox: InboxNotification[];
  capture: CaptureStatus | null;
}

declare const process: { env: { ATHENA_API_URL?: string; ATHENA_GATEWAY_URL?: string } };

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: process.env.ATHENA_API_URL ?? 'http://localhost:4000',
  gatewayUrl: process.env.ATHENA_GATEWAY_URL ?? 'http://localhost:4040',
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  userEmail: null,
  shipCaptions: false,
  forceCustomer: false,
};

export const MEET_RE = /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/i;

/**
 * Allowlist of host:port patterns the extension is permitted to talk to.
 * Validated on every settings.save AND on the SW startup read so a tampered
 * chrome.storage entry can't trick signedFetch into hitting an attacker host.
 *
 * Bare regex strings — `URL.host` is matched against `^(pattern)$` with one
 * leading `^` and trailing `$` per entry. Anything not matching falls back
 * to DEFAULT_SETTINGS at storage-read time.
 */
export const ALLOWED_API_HOST_RE =
  /^(athena-api-production-aa5b\.up\.railway\.app|localhost:\d+|127\.0\.0\.1:\d+)$/;
export const ALLOWED_GATEWAY_HOST_RE =
  /^(athena-realtime-production\.up\.railway\.app|localhost:\d+|127\.0\.0\.1:\d+)$/;

export function isAllowedApiUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_API_HOST_RE.test(u.host);
  } catch {
    return false;
  }
}

export function isAllowedGatewayUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(u.protocol)) return false;
    return ALLOWED_GATEWAY_HOST_RE.test(u.host);
  } catch {
    return false;
  }
}

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
  | { type: 'settings.save'; settings: ExtensionSettings }
  | { type: 'inbox.markRead'; id: string }
  | { type: 'auth.login'; email: string; password: string; workspaceSlug?: string }
  | { type: 'auth.logout' }
  | { type: 'demo.injectCaptions'; meetingId: string }
  | { type: 'capture.start' }
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

/**
 * Pure auth-token decision logic — no chrome.* / fetch / timers, so it is
 * unit-testable and auditable in isolation. The stateful refresh orchestration
 * (coalescing, storage writes) lives in background/index.ts and calls these.
 */
import type { AuthState } from '../shared/types.js';

/** Refresh when the access token has less than this much life left. Covers
 *  client/server clock drift plus one request round-trip (15m TTL → ~13m in). */
export const TOKEN_SKEW_MS = 120_000;

/**
 * Should we refresh before sending this token? True when there is no expiry
 * recorded, the expiry is unparseable, or it is within the skew margin / past.
 * Conservative: an unknown/garbled expiry refreshes rather than risks sending
 * a dead token.
 */
export function needsRefresh(
  expiresAt: string | null | undefined,
  now: number,
  skewMs: number = TOKEN_SKEW_MS,
): boolean {
  if (!expiresAt) return true;
  const expMs = Date.parse(expiresAt);
  if (!Number.isFinite(expMs)) return true;
  return expMs - now <= skewMs;
}

/**
 * Classify a non-OK /v1/auth/refresh HTTP status. `dead` (401/403) means the
 * refresh token was actively rejected → the session is over, clear credentials.
 * Everything else (5xx/429/0) is transient → keep credentials so a deploy blip
 * or rate-limit can't mass-logout the field.
 */
export function classifyRefreshHttpFailure(status: number): { dead: boolean } {
  return { dead: status === 401 || status === 403 };
}

/**
 * Validity-aware auth state for the UI (PR-G). Derived purely from token
 * presence + expiry — never a network call. An expired access token with a
 * refresh token in hand is 'refreshable' (still shown as signed-in; the
 * background refreshes silently), NOT 'signed-out'.
 */
export function deriveAuthState(args: {
  accessToken: string | null | undefined;
  refreshToken: string | null | undefined;
  expiresAt: string | null | undefined;
  now: number;
}): AuthState {
  const { accessToken, refreshToken, expiresAt, now } = args;
  if (accessToken && !needsRefresh(expiresAt, now, 0)) return 'valid';
  if (refreshToken) return 'refreshable';
  if (accessToken) return 'valid'; // token present, no expiry info, no refresh — treat as usable
  return 'signed-out';
}

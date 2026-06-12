/**
 * Pure decision logic for active-meeting liveness. Extracted from the SW so
 * it is unit-testable without chrome.* mocks (same pattern as auth-logic.ts).
 *
 * Why this exists: the active meeting is persisted in storage.local, but tab
 * ids are NOT stable — they die with the tab, the browser session, and
 * extension reloads. A stale record both broke capture ("Invalid tab
 * specified" from tabCapture.getMediaStreamId, 2026-06-12 incident) and —
 * via the first-one-wins guard — blocked every NEW meeting from becoming
 * active. These helpers let the SW verify and self-heal that state.
 */
import { MEET_RE, type ActiveMeeting } from '../shared/types.js';

export interface TabLike {
  id?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
}

export function parseMeetUrl(
  url: string | undefined,
): { meetingId: string; meetingUrl: string } | null {
  if (!url) return null;
  const m = MEET_RE.exec(url);
  if (!m || !m[1]) return null;
  return { meetingId: m[1], meetingUrl: `https://meet.google.com/${m[1]}` };
}

/**
 * The recorded active meeting is healthy iff its tab still shows the SAME
 * meeting. A different meeting code, a non-Meet URL, or no URL at all means
 * the record is stale and must not be used for capture targeting.
 */
export function isActiveTabHealthy(active: ActiveMeeting, tabUrl: string | undefined): boolean {
  const parsed = parseMeetUrl(tabUrl);
  return parsed !== null && parsed.meetingId === active.meetingId;
}

/**
 * Pick the first tab that is showing a Meet call and build a fresh
 * ActiveMeeting record for it. Mirrors the first-one-wins detection order.
 */
export function adoptMeetTab(tabs: TabLike[], detectedAt: string): ActiveMeeting | null {
  for (const tab of tabs) {
    const parsed = parseMeetUrl(tab.url);
    if (!parsed || typeof tab.id !== 'number' || tab.id < 0) continue;
    return {
      meetingId: parsed.meetingId,
      meetingUrl: parsed.meetingUrl,
      title: tab.title ?? null,
      tabId: tab.id,
      detectedAt,
      internalMeetingId: null,
    };
  }
  return null;
}

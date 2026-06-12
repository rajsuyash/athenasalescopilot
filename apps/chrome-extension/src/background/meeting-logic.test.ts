import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { ActiveMeeting } from '../shared/types.js';
import { adoptMeetTab, isActiveTabHealthy, parseMeetUrl } from './meeting-logic.js';

const ACTIVE: ActiveMeeting = {
  meetingId: 'abc-defg-hij',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  title: 'Old call',
  tabId: 42,
  detectedAt: '2026-06-12T10:00:00.000Z',
  internalMeetingId: null,
};

describe('parseMeetUrl', () => {
  it('extracts the meeting code from a Meet URL', () => {
    assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij?authuser=0'), {
      meetingId: 'abc-defg-hij',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('returns null for non-Meet URLs and undefined', () => {
    assert.equal(parseMeetUrl('https://example.com/abc-defg-hij'), null);
    assert.equal(parseMeetUrl('https://meet.google.com/landing'), null);
    assert.equal(parseMeetUrl(undefined), null);
  });
});

describe('isActiveTabHealthy', () => {
  it('healthy when the tab still shows the recorded meeting', () => {
    assert.equal(isActiveTabHealthy(ACTIVE, 'https://meet.google.com/abc-defg-hij'), true);
  });

  it('stale when the tab navigated to a DIFFERENT meeting', () => {
    assert.equal(isActiveTabHealthy(ACTIVE, 'https://meet.google.com/zzz-zzzz-zzz'), false);
  });

  it('stale when the tab left Meet entirely or URL is unavailable', () => {
    assert.equal(isActiveTabHealthy(ACTIVE, 'https://mail.google.com/'), false);
    assert.equal(isActiveTabHealthy(ACTIVE, undefined), false);
  });
});

describe('adoptMeetTab', () => {
  const NOW = '2026-06-12T12:00:00.000Z';

  it('adopts the first live Meet tab, skipping non-Meet tabs', () => {
    const adopted = adoptMeetTab(
      [
        { id: 1, url: 'https://mail.google.com/', title: 'Mail' },
        { id: 7, url: 'https://meet.google.com/new-call-xyz', title: 'New call' },
      ],
      NOW,
    );
    assert.deepEqual(adopted, {
      meetingId: 'new-call-xyz',
      meetingUrl: 'https://meet.google.com/new-call-xyz',
      title: 'New call',
      tabId: 7,
      detectedAt: NOW,
      internalMeetingId: null,
    });
  });

  it('skips tabs without a usable id and returns null when no Meet tab exists', () => {
    assert.equal(
      adoptMeetTab([{ url: 'https://meet.google.com/zzz-zzzz-zzz' }], NOW),
      null,
    );
    assert.equal(adoptMeetTab([], NOW), null);
  });
});

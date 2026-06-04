import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  needsRefresh,
  classifyRefreshHttpFailure,
  deriveAuthState,
  TOKEN_SKEW_MS,
} from './auth-logic.js';

const NOW = 1_000_000_000_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('needsRefresh', () => {
  it('false when the token has more than the skew margin left', () => {
    assert.equal(needsRefresh(iso(TOKEN_SKEW_MS + 60_000), NOW), false);
  });
  it('true when within the skew margin', () => {
    assert.equal(needsRefresh(iso(TOKEN_SKEW_MS - 1_000), NOW), true);
  });
  it('true when already expired', () => {
    assert.equal(needsRefresh(iso(-1_000), NOW), true);
  });
  it('true when expiry is missing or unparseable (fail-safe)', () => {
    assert.equal(needsRefresh(null, NOW), true);
    assert.equal(needsRefresh('not-a-date', NOW), true);
  });
});

describe('classifyRefreshHttpFailure', () => {
  it('marks 401/403 as dead (session over)', () => {
    assert.equal(classifyRefreshHttpFailure(401).dead, true);
    assert.equal(classifyRefreshHttpFailure(403).dead, true);
  });
  it('marks 5xx/429/0 as transient (keep credentials — no mass logout on a blip)', () => {
    assert.equal(classifyRefreshHttpFailure(500).dead, false);
    assert.equal(classifyRefreshHttpFailure(503).dead, false);
    assert.equal(classifyRefreshHttpFailure(429).dead, false);
    assert.equal(classifyRefreshHttpFailure(0).dead, false);
  });
});

describe('deriveAuthState', () => {
  it("'valid' when access token is present and unexpired", () => {
    assert.equal(
      deriveAuthState({ accessToken: 'a', refreshToken: 'r', expiresAt: iso(600_000), now: NOW }),
      'valid',
    );
  });
  it("'refreshable' when access expired but a refresh token is present", () => {
    assert.equal(
      deriveAuthState({ accessToken: 'a', refreshToken: 'r', expiresAt: iso(-1), now: NOW }),
      'refreshable',
    );
  });
  it("'signed-out' when no refresh token and no access token", () => {
    assert.equal(
      deriveAuthState({ accessToken: null, refreshToken: null, expiresAt: null, now: NOW }),
      'signed-out',
    );
  });
  it("'refreshable' (not signed-out) when access expired with refresh token — the incident state", () => {
    // The screenshot: access expired, refresh token still valid → must NOT show signed-out.
    assert.equal(
      deriveAuthState({
        accessToken: 'expired',
        refreshToken: 'r',
        expiresAt: iso(-60_000),
        now: NOW,
      }),
      'refreshable',
    );
  });
});

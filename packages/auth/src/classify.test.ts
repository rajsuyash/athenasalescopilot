import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyJwtError, toAuthError, AuthError } from './classify.js';
import { isExpiredJwtCode, EXPIRED_JWT_CODES } from './codes.js';

describe('isExpiredJwtCode', () => {
  it('recognizes the real @fastify/jwt expiry code', () => {
    assert.equal(isExpiredJwtCode('FST_JWT_AUTHORIZATION_TOKEN_EXPIRED'), true);
  });
  it('still recognizes the legacy @fast-jwt code (belt-and-suspenders)', () => {
    assert.equal(isExpiredJwtCode('FAST_JWT_EXPIRED'), true);
  });
  it('rejects invalid/unknown codes and undefined', () => {
    assert.equal(isExpiredJwtCode('FAST_JWT_INVALID_SIGNATURE'), false);
    assert.equal(isExpiredJwtCode(undefined), false);
  });
  it('exposes both codes in the constant', () => {
    assert.deepEqual(
      [...EXPIRED_JWT_CODES],
      ['FST_JWT_AUTHORIZATION_TOKEN_EXPIRED', 'FAST_JWT_EXPIRED'],
    );
  });
});

describe('classifyJwtError', () => {
  it('classifies the expiry code as TOKEN_EXPIRED (the refreshable signal)', () => {
    const c = classifyJwtError(
      Object.assign(new Error('jwt expired'), { code: 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' }),
    );
    assert.equal(c.code, 'TOKEN_EXPIRED');
    assert.equal(c.status, 401);
    assert.equal(c.jwtCode, 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED');
  });
  it('classifies a bad signature as TOKEN_INVALID', () => {
    const c = classifyJwtError(
      Object.assign(new Error('bad sig'), { code: 'FAST_JWT_INVALID_SIGNATURE' }),
    );
    assert.equal(c.code, 'TOKEN_INVALID');
  });
  it('classifies an unknown/codeless error as TOKEN_INVALID', () => {
    assert.equal(classifyJwtError(new Error('???')).code, 'TOKEN_INVALID');
    assert.equal(classifyJwtError(null).code, 'TOKEN_INVALID');
  });
});

describe('toAuthError', () => {
  it('produces a 401 AuthError with the right code + message for expiry', () => {
    const e = toAuthError(
      Object.assign(new Error('jwt expired'), { code: 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' }),
    );
    assert.ok(e instanceof AuthError);
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'TOKEN_EXPIRED');
    assert.equal(e.message, 'Token has expired.');
    assert.equal(e.details?.jwtCode, 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED');
  });
  it('produces TOKEN_INVALID for anything else', () => {
    const e = toAuthError(Object.assign(new Error('nope'), { code: 'FAST_JWT_MALFORMED' }));
    assert.equal(e.code, 'TOKEN_INVALID');
    assert.equal(e.message, 'Token is invalid.');
  });
});

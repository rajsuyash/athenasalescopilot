/// <reference types="@fastify/jwt" />
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin as sharedAuthPlugin } from '@athena/auth';

// Set required env BEFORE importing the server module.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('./server.js');

describe('api server', () => {
  let app: FastifyInstance;
  // A no-TTL signer (same secret) so we can mint a token with a manual past exp —
  // the app's own signer has expiresIn configured and rejects a manual exp.
  let signer: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
    signer = Fastify();
    await signer.register(sharedAuthPlugin, { secret: process.env.JWT_ACCESS_SECRET! });
    await signer.ready();
  });

  after(async () => {
    await app.close();
    await signer.close();
  });

  it('healthz returns ok without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });

  it('rejects /auth/me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    assert.equal(res.statusCode, 401);
    const body = res.json() as { error: string };
    assert.ok(['TOKEN_INVALID', 'TOKEN_EXPIRED'].includes(body.error));
  });

  it('rejects /v1/workspaces/me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/workspaces/me' });
    assert.equal(res.statusCode, 401);
  });

  it('classifies an EXPIRED token as TOKEN_EXPIRED with the exact client-facing body', async () => {
    const expired = signer.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${expired}` },
    });
    assert.equal(res.statusCode, 401);
    const body = res.json() as { error: string; message: string };
    // The load-bearing assertion: the CODE must be TOKEN_EXPIRED (not just 401),
    // and the body shape must match what the api always returned so clients that
    // parse body.error / body.message are unaffected.
    assert.equal(body.error, 'TOKEN_EXPIRED');
    assert.equal(body.message, 'Token has expired.');
  });

  it('classifies a malformed token as TOKEN_INVALID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal((res.json() as { error: string }).error, 'TOKEN_INVALID');
  });

  it('rejects malformed signup body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: {
        email: 'not-an-email',
        password: 'short',
        name: '',
        workspaceName: '',
        workspaceSlug: 'x',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'VALIDATION_ERROR');
  });

  it('returns 404 on unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-such-thing' });
    assert.equal(res.statusCode, 404);
  });

  it('rejects /auth/token without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/token' });
    assert.equal(res.statusCode, 401);
  });

  it('exchanges a verified identity for a short-lived HMAC access token', async () => {
    const bearer = signer.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: { authorization: `Bearer ${bearer}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { accessToken: string };
    assert.ok(body.accessToken);

    // The minted token must verify under the shared HMAC secret, carry the
    // same tenant claims, and expire (the whole point: a token every
    // downstream service accepts, unlike the Clerk RS256 session JWT).
    const claims = signer.jwt.verify<{
      sub: string;
      workspaceId: string;
      role: string;
      membershipId: string;
      exp: number;
    }>(body.accessToken);
    assert.equal(claims.sub, 'u_1');
    assert.equal(claims.workspaceId, 'ws_1');
    assert.equal(claims.role, 'rep');
    assert.equal(claims.membershipId, 'm_1');
    assert.ok(claims.exp > Math.floor(Date.now() / 1000));
  });
});

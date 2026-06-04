import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from './plugin.js';
import { verifyTokenString } from './ws.js';
import type { AccessTokenClaims } from './claims.js';

const SECRET = 'test-secret-please-ignore';

const claims: AccessTokenClaims = {
  sub: 'user-1',
  workspaceId: 'ws-1',
  role: 'owner',
  membershipId: 'm-1',
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin, { secret: SECRET, accessTtl: '15m' });
  app.get('/protected', async (req) => {
    const c = await req.requireAuth();
    return { ok: true, workspaceId: c.workspaceId };
  });
  // Serialize AuthError-shaped errors the way services' global handlers do.
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    void reply.code(e.statusCode ?? 500).send({ code: e.code ?? 'ERROR', message: e.message });
  });
  await app.ready();
  return app;
}

/**
 * A signer with NO accessTtl, so we can mint a token with a manual past `exp`
 * (fast-jwt forbids negative expiresIn and forbids `exp` in the payload when
 * expiresIn is configured). Same SECRET ⇒ it verifies against buildApp().
 */
let signerApp: FastifyInstance | undefined;
async function expiredToken(): Promise<string> {
  if (!signerApp) {
    signerApp = Fastify();
    await signerApp.register(authPlugin, { secret: SECRET });
    await signerApp.ready();
  }
  const pastExp = Math.floor(Date.now() / 1000) - 60;
  return signerApp.jwt.sign({ ...claims, exp: pastExp });
}

describe('authPlugin contract', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
  });
  after(async () => {
    await app.close();
  });

  it('accepts a valid token', async () => {
    const token = app.jwt.sign(claims);
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().workspaceId, 'ws-1');
  });

  it('rejects an EXPIRED token with 401 AND code TOKEN_EXPIRED (not just 401)', async () => {
    const token = await expiredToken();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 401);
    // The load-bearing assertion: asserting only 401 would pass against the
    // historical broken code. The CODE is what the client refreshes on.
    assert.equal(res.json().code, 'TOKEN_EXPIRED');
  });

  it('rejects a malformed token with TOKEN_INVALID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'TOKEN_INVALID');
  });

  it('rejects a token missing workspaceId with MISSING_WORKSPACE_CLAIM', async () => {
    const token = app.jwt.sign({ sub: 'u', role: 'owner', membershipId: 'm' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'MISSING_WORKSPACE_CLAIM');
  });
});

describe('verifyTokenString (WS path)', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
  });
  after(async () => {
    await app.close();
    if (signerApp) await signerApp.close();
  });

  it('returns ok for a valid token', () => {
    const token = app.jwt.sign(claims);
    const r = verifyTokenString(app, token);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.claims.workspaceId, 'ws-1');
  });

  it('returns TOKEN_EXPIRED for an expired token (WS can now signal expiry)', async () => {
    const token = await expiredToken();
    const r = verifyTokenString(app, token);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'TOKEN_EXPIRED');
  });

  it('returns TOKEN_INVALID for a garbage token', () => {
    const r = verifyTokenString(app, 'garbage');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'TOKEN_INVALID');
  });
});

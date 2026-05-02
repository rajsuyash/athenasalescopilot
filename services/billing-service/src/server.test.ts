import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('./server.js');

describe('billing-service', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('healthz reports stripe disabled in mock mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; stripe: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.stripe, false);
  });

  it('rejects unauthenticated subscription read', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/subscription' });
    assert.equal(res.statusCode, 401);
  });

  it('rejects checkout from rep role', async () => {
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: { planTier: 'pro', seats: 5 },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
  });
});

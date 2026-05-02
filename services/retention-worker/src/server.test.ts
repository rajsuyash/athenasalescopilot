import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';
process.env.SWEEP_INTERVAL_MS = '0';

const { buildApp } = await import('./server.js');

describe('retention-worker', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('healthz reports sweep disabled in test env', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; sweepEnabled: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.sweepEnabled, false);
  });

  it('rejects unauthenticated enforce', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/enforce',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('rejects rep role (insufficient permission)', async () => {
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/enforce',
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'INSUFFICIENT_ROLE');
  });
});

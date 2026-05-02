import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.LLM_PROVIDER = 'mock';

const { buildApp } = await import('./server.js');

describe('orchestrator-service', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  it('rejects unauthenticated suggest', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orchestrator/suggest',
      payload: { customerText: 'pricing question' },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('validates request body', async () => {
    // We need a valid token to reach validation; use a hand-rolled token for
    // the boot path since the api service's signer isn't wired in here.
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orchestrator/suggest',
      payload: { customerText: '' },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'VALIDATION_ERROR');
  });
});

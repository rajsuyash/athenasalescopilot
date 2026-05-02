import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';
process.env.LLM_PROVIDER = 'mock';

const { buildApp } = await import('./server.js');

describe('postcall-service', () => {
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

  it('rejects unauthenticated recap run', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/postcall/meetings/${id}/recap`,
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('validates meetingId is a uuid', async () => {
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/postcall/meetings/not-a-uuid/recap',
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 400);
  });
});

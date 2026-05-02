import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('./server.js');

describe('analytics-service', () => {
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

  it('rejects unauthenticated /analytics/adoption', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/analytics/adoption' });
    assert.equal(res.statusCode, 401);
  });

  it('rejects unauthenticated /analytics/quality', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/analytics/quality' });
    assert.equal(res.statusCode, 401);
  });
});

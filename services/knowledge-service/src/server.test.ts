import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';
process.env.EMBEDDING_PROVIDER = 'deterministic';

const { buildApp } = await import('./server.js');

describe('knowledge-service', () => {
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
  });

  it('rejects unauthenticated search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/search?query=hello',
    });
    assert.equal(res.statusCode, 401);
  });

  it('rejects unauthenticated text ingest', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/text',
      payload: {
        name: 'x',
        category: 'security',
        format: 'text',
        text: 'hello',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 401);
  });
});

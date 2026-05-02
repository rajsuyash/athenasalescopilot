import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

// Set required env BEFORE importing the server module.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('./server.js');

describe('api server', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
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

  it('rejects malformed signup body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'not-an-email', password: 'short', name: '', workspaceName: '', workspaceSlug: 'x' },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'VALIDATION_ERROR');
  });

  it('returns 404 on unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-such-thing' });
    assert.equal(res.statusCode, 404);
  });
});

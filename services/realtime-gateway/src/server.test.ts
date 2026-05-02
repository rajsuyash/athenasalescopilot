import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'fatal';
process.env.STT_PROVIDER = 'mock';
process.env.LLM_PROVIDER = 'mock';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.IDLE_TIMEOUT_MS = '60000';
process.env.AUTO_RECAP = 'false';
process.env.AUTO_END_MEETING = 'false';

const { buildApp } = await import('./server.js');

function port(app: FastifyInstance): number {
  const addr = app.server.address() as AddressInfo;
  return addr.port;
}

async function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 1500);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('realtime-gateway', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
  });
  after(async () => {
    await app.close();
  });

  it('healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; stt: string };
    assert.equal(body.ok, true);
    assert.equal(body.stt, 'mock');
  });

  it('rejects WS without a token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port(app)}/v1/sessions`);
    const closed = new Promise<{ code: number }>((resolve) =>
      ws.once('close', (code) => resolve({ code })),
    );
    const m = await nextMessage(ws);
    assert.equal((m as { type: string }).type, 'error');
    assert.equal((m as { code: string }).code, 'TOKEN_INVALID');
    const r = await closed;
    assert.equal(r.code, 4001);
  });

  it('accepts valid token and sends hello.required', async () => {
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const ws = new WebSocket(
      `ws://127.0.0.1:${port(app)}/v1/sessions?token=${encodeURIComponent(token)}`,
    );
    const m = await nextMessage(ws);
    assert.equal((m as { type: string }).type, 'hello.required');
    ws.close();
  });

  it('rejects bad hello payload', async () => {
    const token = app.jwt.sign({
      sub: 'u_1',
      workspaceId: 'ws_1',
      role: 'rep',
      membershipId: 'm_1',
    });
    const ws = new WebSocket(
      `ws://127.0.0.1:${port(app)}/v1/sessions?token=${encodeURIComponent(token)}`,
    );
    await nextMessage(ws); // skip hello.required
    ws.send(JSON.stringify({ type: 'hello', meetingId: 'not-a-uuid' }));
    const m = await nextMessage(ws);
    assert.equal((m as { type: string }).type, 'error');
    assert.equal((m as { code: string }).code, 'VALIDATION_ERROR');
    ws.close();
  });
});

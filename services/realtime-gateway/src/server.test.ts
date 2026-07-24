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
const { mintServiceToken, verifyTokenString } = await import('./lib/ws-auth.js');

function port(app: FastifyInstance): number {
  const addr = app.server.address() as AddressInfo;
  return addr.port;
}

/** Collect messages until one has the given `type`, or time out. Robust to
 *  extra/ordering of server frames. */
async function waitForType(
  ws: WebSocket,
  type: string,
  ms = 1500,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    const onMessage = (data: WebSocket.RawData): void => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(m);
      }
    };
    ws.on('message', onMessage);
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
    const body = res.json() as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('rejects a pre-auth non-auth frame with TOKEN_INVALID and close 4001', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port(app)}/v1/sessions`);
    const closed = new Promise<{ code: number }>((resolve) =>
      ws.once('close', (code) => resolve({ code })),
    );
    // First the server prompts for auth; sending anything that isn't an auth
    // frame is rejected.
    await waitForType(ws, 'auth.required');
    ws.send(JSON.stringify({ type: 'hello', meetingId: 'whatever' }));
    const m = await waitForType(ws, 'error');
    assert.equal(m.code, 'TOKEN_INVALID');
    assert.equal((await closed).code, 4001);
  });

  // Query-string token transport was removed (it leaks tokens into URLs/logs).
  // The supported browser transport is the first-frame {type:'auth', token}
  // handshake, so the auth tests below authenticate that way.
  const validClaims = { sub: 'u_1', workspaceId: 'ws_1', role: 'rep', membershipId: 'm_1' };

  it('accepts a valid token via the auth-frame handshake and sends hello.required', async () => {
    const token = app.jwt.sign(validClaims);
    const ws = new WebSocket(`ws://127.0.0.1:${port(app)}/v1/sessions`);
    await waitForType(ws, 'auth.required');
    ws.send(JSON.stringify({ type: 'auth', token }));
    // auth.ok and hello.required are sent back-to-back; collect until the latter.
    await waitForType(ws, 'hello.required');
    ws.close();
  });

  it('rejects an EXPIRED token with code TOKEN_EXPIRED and WS close 4011', async () => {
    // Mint with a manual past exp (no expiresIn configured on this signer path).
    const token = app.jwt.sign({ ...validClaims, exp: Math.floor(Date.now() / 1000) - 60 });
    const ws = new WebSocket(`ws://127.0.0.1:${port(app)}/v1/sessions`);
    const closed = new Promise<{ code: number }>((resolve) =>
      ws.once('close', (code) => resolve({ code })),
    );
    await waitForType(ws, 'auth.required');
    ws.send(JSON.stringify({ type: 'auth', token }));
    const m = await waitForType(ws, 'error');
    assert.equal(m.code, 'TOKEN_EXPIRED');
    assert.equal((await closed).code, 4011);
  });

  it('mintServiceToken produces a token that verifies and preserves tenant claims (recap 401 fix)', () => {
    const s2s = mintServiceToken(app, validClaims);
    const v = verifyTokenString(app, s2s);
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.verified.claims.workspaceId, validClaims.workspaceId);
      assert.equal(v.verified.claims.role, validClaims.role);
      assert.equal(v.verified.claims.sub, validClaims.sub);
    }
  });

  it('rejects bad hello payload with VALIDATION_ERROR (after authenticating)', async () => {
    const token = app.jwt.sign(validClaims);
    const ws = new WebSocket(`ws://127.0.0.1:${port(app)}/v1/sessions`);
    await waitForType(ws, 'auth.required');
    ws.send(JSON.stringify({ type: 'auth', token }));
    await waitForType(ws, 'hello.required');
    ws.send(JSON.stringify({ type: 'hello', meetingId: 'not-a-uuid' }));
    const m = await waitForType(ws, 'error');
    assert.equal(m.code, 'VALIDATION_ERROR');
    ws.close();
  });
});

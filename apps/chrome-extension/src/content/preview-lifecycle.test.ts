import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { build, transform } from 'esbuild';
import { chromium } from 'playwright';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const session = '12345678-1234-4234-8234-123456789012';
const meetingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const gen = (n: number) => `${session}:${n}`;

async function bundle(entry: string, suffix = '') {
  const result = await build({
    stdin: {
      contents: (await readFile(entry, 'utf8')) + suffix,
      resolveDir: dirname(entry),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    define: {
      'process.env.ATHENA_DEV': '"false"',
      'process.env.ATHENA_API_URL': '"https://example.invalid"',
      'process.env.ATHENA_GATEWAY_URL': '"https://example.invalid"',
    },
  });
  return result.outputFiles![0]!.text;
}

test('offscreen preserves lifecycle identity and clears drafts on stop/reconnect', async () => {
  const forwarded: any[] = [];
  let refresh: Promise<unknown> | undefined;
  class Socket {
    static OPEN = 1;
    static all: Socket[] = [];
    readyState = 1;
    listeners = new Map<string, Function[]>();
    constructor() {
      Socket.all.push(this);
    }
    addEventListener(name: string, fn: Function) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
    }
    async emit(name: string, value: unknown) {
      for (const fn of this.listeners.get(name) ?? []) await fn(value);
    }
    send() {}
    close() {}
  }
  const context = vm.createContext({
    console,
    WebSocket: Socket,
    Blob,
    TextDecoder,
    ArrayBuffer,
    setTimeout,
    chrome: {
      runtime: {
        id: 'test',
        onMessage: { addListener() {} },
        sendMessage: async (m: any) => {
          forwarded.push(m);
          if (m.type === 'capture.refreshToken') return refresh;
        },
      },
    },
  });
  vm.runInContext(
    await bundle(
      resolve(src, 'offscreen/index.ts'),
      '\nglobalThis.testCapture = { set(value) { active = value; }, openSocket, stop, scheduleReconnect };',
    ),
    context,
  );
  const capture = {
    generationId: null,
    gatewayUrl: 'https://example.invalid',
    meetingId,
    reconnectAttempt: null,
    ctx: { close: async () => {} },
    stream: { getTracks: () => [] },
    micStream: null,
    node: null,
    suggestionsHeard: 0,
  };
  context.testCapture.set(capture);
  context.testCapture.openSocket();
  const first = Socket.all[0]!;
  await first.emit('message', {
    data: JSON.stringify({ type: 'suggestion.started', generationId: gen(1) }),
  });
  await first.emit('message', {
    data: JSON.stringify({
      type: 'suggestion.streaming',
      generationId: gen(1),
      answerText: 'draft',
    }),
  });
  context.testCapture.openSocket();
  const count = forwarded.length;
  await first.emit('message', {
    data: JSON.stringify({
      type: 'suggestion.streaming',
      generationId: gen(1),
      answerText: 'late old socket',
    }),
  });
  assert.equal(forwarded.length, count);
  assert.ok(forwarded.some((m) => m.event === 'ended' && m.generationId === gen(1)));
  const second = Socket.all[1]!;
  await second.emit('message', {
    data: JSON.stringify({ type: 'suggestion.started', generationId: gen(2) }),
  });
  await context.testCapture.stop('test');
  assert.ok(forwarded.some((m) => m.event === 'ended' && m.generationId === gen(2)));
  const scoped = forwarded.filter((m) => m.type === 'suggestion.lifecycle.forward');
  assert.ok(scoped.every((m) => m.meetingId === meetingId));
  let release!: (value: unknown) => void;
  refresh = new Promise((resolve) => {
    release = resolve;
  });
  context.testCapture.set(capture);
  const reconnect = context.testCapture.scheduleReconnect('test', true);
  await context.testCapture.stop('test');
  const replacement = { ...capture, generationId: gen(3) };
  context.testCapture.set(replacement);
  const sockets = Socket.all.length;
  release({ ok: true, accessToken: 'synthetic-token' });
  await reconnect;
  assert.equal(Socket.all.length, sockets);
  assert.equal(replacement.generationId, gen(3));
});

test('background serializes scoped forwarding and rejects other meetings/untrusted senders', async () => {
  const source = await readFile(resolve(src, 'background/index.ts'), 'utf8');
  const start = source.indexOf('const MAX_SUGGESTION_FIELD_LEN =');
  const end = source.indexOf('// Footer link in the in-Meet panel');
  assert.ok(start >= 0 && end > start);
  const code = (await transform(source.slice(start, end), { loader: 'ts' })).code;
  const listeners: Function[] = [];
  const delivered: any[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  let reads = 0;
  const context = vm.createContext({
    isPrivilegedSender: (s: any) => s.id === 'extension' && !s.tab,
    getActive: async () => {
      if (++reads === 1) await blocked;
      return { tabId: 7, internalMeetingId: meetingId, meetingId: 'abc-defg-hij' };
    },
    chrome: {
      runtime: { onMessage: { addListener: (fn: Function) => listeners.push(fn) } },
      tabs: {
        sendMessage: async (_tab: number, m: unknown) => {
          delivered.push(m);
        },
      },
    },
  });
  vm.runInContext(code, context);
  const send = (event: string, overrides = {}, sender = { id: 'extension' }) =>
    listeners[0]!(
      {
        type: 'suggestion.lifecycle.forward',
        event,
        generationId: gen(1),
        meetingId,
        ...overrides,
      },
      sender,
    );
  send('started');
  send('streaming', { answerText: 'x'.repeat(5000) });
  send('ended');
  send('started', { meetingId: 'other' });
  send('started', {}, { id: 'other' });
  release();
  await vm.runInContext('coachRelay', context);
  assert.deepEqual(
    delivered.map((m) => m.event),
    ['started', 'streaming', 'ended'],
  );
  assert.equal(delivered[1].answerText.length, 4000);
  assert.ok(delivered.every((m) => m.generationId === gen(1) && m.meetingCode === 'abc-defg-hij'));
});

test(
  'real browser retracts only the cancelled preview and preserves committed cards',
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<html><head><title>Meet</title></head><body></body></html>',
        }),
      );
      await page.goto('https://meet.google.com/abc-defg-hij');
      // tsx preserves function names using this helper when serializing callbacks.
      await page.addScriptTag({ content: 'globalThis.__name = (fn) => fn;' });
      await page.evaluate(() => {
        const w = window as any;
        w.listeners = [];
        w.storageListeners = [];
        w.capture = { closed: false };
        w.chrome = {
          runtime: {
            onMessage: { addListener: (fn: Function) => w.listeners.push(fn) },
            sendMessage: async () => ({}),
          },
          storage: {
            local: {
              get: (_keys: unknown, cb?: Function) => {
                const value = { capture: w.capture };
                cb?.(value);
                return Promise.resolve(value);
              },
              set: async () => {},
            },
            onChanged: { addListener: (fn: Function) => w.storageListeners.push(fn) },
          },
        };
      });
      await page.addScriptTag({ content: await bundle(resolve(src, 'content/index.ts')) });
      assert.deepEqual(errors, []);
      const send = async (event: string, n: number, extra = {}) =>
        page.evaluate(
          (m) => {
            for (const listener of (window as any).listeners) listener(m);
          },
          {
            type: 'overlay.suggestion.lifecycle',
            event,
            generationId: gen(n),
            meetingCode: 'abc-defg-hij',
            ...extra,
          },
        );
      const draft = page.locator('.athena-card-streaming');
      await send('started', 1);
      await send('streaming', 1, { answerText: 'First draft' });
      assert.equal(await draft.count(), 1);
      await send('started', 2);
      await send('streaming', 2, { answerText: 'New draft' });
      await send('ended', 1);
      assert.match(await draft.innerText(), /New draft/);
      await send('streaming', 1, { answerText: 'Stale text' });
      await send('started', 1);
      assert.match(await draft.innerText(), /New draft/);
      await send('ended', 2);
      assert.equal(await draft.count(), 0);
      await send('streaming', 2, { answerText: 'Resurrection' });
      assert.equal(await draft.count(), 0);
      await send('started', 3);
      await send('streaming', 3, { answerText: 'Current draft' });
      await send('generated', 3, {
        suggestion: { type: 'answer', answerText: 'Committed answer', sources: [] },
      });
      await send('ended', 3);
      assert.equal(await draft.count(), 0);
      assert.match(await page.locator('#athena-overlay-root').innerText(), /Committed answer/);
      await send('started', 4);
      await send('generated', 4, {
        suggestion: { type: 'answer', answerText: 'Second committed answer', sources: [] },
      });
      await send('started', 5);
      await send('streaming', 5, { answerText: 'Draft before stop' });
      assert.equal(await page.locator('.athena-card:not(.athena-card-streaming)').count(), 2);
      await page.evaluate(() => {
        const w = window as any;
        w.capture = { closed: true };
        for (const listener of w.storageListeners)
          listener({ capture: { newValue: w.capture } }, 'local');
      });
      await page.waitForFunction(() => !document.querySelector('.athena-card-streaming'));
      await send('streaming', 5, { answerText: 'Late after stop' });
      await send('started', 6);
      await send('streaming', 6, { answerText: 'Queued start after stop' });
      assert.equal(await draft.count(), 0);
      assert.equal(await page.locator('.athena-card:not(.athena-card-streaming)').count(), 2);
      assert.match(await page.locator('#athena-overlay-root').innerText(), /Committed answer/);
      await page.screenshot({ path: '/private/tmp/athena-phase3-overlay.png' });
    } finally {
      await browser.close();
    }
  },
);

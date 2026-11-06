// Synthetic audio enters after capture. Real providers/DB/handler/relay/DOM; no production writes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { chromium } from 'playwright';
import { prisma } from '@athena/db';
import { createLlmClient } from '@athena/sdk-llm';
import { createEmbeddingClient } from '@athena/sdk-embeddings';
import { createSttClient } from '@athena/sdk-stt';
import { registerSessionHandler } from '../src/modules/session/handler.ts';
import { coachAndPersist, proactiveCoach } from '../src/lib/coach.ts';
import { shutdownLatency } from '../src/lib/latency.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const extension = resolve(root, 'apps/chrome-extension/src');
const { build, transform } = createRequire(resolve(extension, '../package.json'))('esbuild');
const output = resolve(root, 'research/athena-phase4/results.json');
const scratch = mkdtempSync(resolve(tmpdir(), 'athena-phase4-'));
const db = new URL(process.env.DATABASE_URL);
assert.equal(db.hostname, 'localhost');
assert.equal(db.pathname, '/athena_phase4_eval');
const scopedKey = (file, key) => parseEnv(readFileSync(file, 'utf8'))[key];
const anthropicKey = scopedKey(process.env.EVAL_ANTHROPIC_ENV, 'ANTHROPIC_API_KEY');
const openaiKey = scopedKey(process.env.EVAL_OPENAI_ENV, 'OPENAI_API_KEY');
assert.ok(anthropicKey && openaiKey && process.env.DEEPGRAM_API_KEY);
const model = process.env.EVAL_MODEL ?? 'claude-haiku-4-5-20251001';
const sttModel = process.env.EVAL_STT_MODEL ?? 'nova-3';
const repeats = Number(process.env.EVAL_REPEATS ?? 3);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5);
const knowledge = [
  [
    'pricing',
    'Growth plan costs $1,200 per month for up to 25 seats on annual billing. Monthly billing costs $1,450. Onboarding is included. No discounts are approved.',
  ],
  [
    'security',
    'The product is SOC 2 Type II certified. Customers choose EU or US data residency. Audio is discarded after transcription unless retention is enabled. HIPAA compliance and a BAA are not offered.',
  ],
  [
    'implementation',
    'Standard implementation takes ten business days. Week one is workspace and knowledge setup; week two is rep enablement. No engineering work is required.',
  ],
  [
    'integrations',
    'Salesforce and HubSpot integrations sync call notes and next steps. Other CRM integrations are not supported.',
  ],
  [
    'objection_handling',
    'Acknowledge price concerns without promising discounts. Clarify the buyer goal. Respect a firm refusal. For procurement involve the decision maker. A real product question needs a direct factual answer.',
  ],
];
const scenarios = [
  {
    id: 'price-objection',
    turns: ['That is too expensive for us.'],
    expected: 'Acknowledge price; clarify value or budget; no invented discount.',
  },
  {
    id: 'price-question',
    turns: ['Why does it cost twelve hundred dollars a month?'],
    expected:
      'Explain included seats/onboarding or ask a relevant value question; do not dismiss the question.',
  },
  {
    id: 'implementation',
    turns: ['How long does implementation take?'],
    expected: 'Ten business days; no engineering required.',
  },
  {
    id: 'security',
    turns: ['Can our customer data stay in Europe?'],
    expected: 'Yes, EU data residency is available.',
  },
  {
    id: 'unsupported',
    turns: ['Can you sign a HIPAA business associate agreement?'],
    expected: 'Do not claim HIPAA/BAA support; admit unavailable or verify.',
  },
  {
    id: 'benign',
    turns: ['Thanks, I can see your screen clearly.'],
    expected: 'Silence; no objection reframe.',
  },
  {
    id: 'concern-change',
    turns: ['That is too expensive for us.', 'Actually, can our customer data stay in Europe?'],
    expected: 'Second response answers EU residency, not another price-loop step.',
  },
  {
    id: 'interruption',
    turns: ['How long does implementation take?', 'Can data stay in Europe?'],
    interrupt: true,
    expected: 'Only latest EU residency answer should remain after supersession.',
  },
];
const results = {
  createdAt: new Date().toISOString(),
  model,
  sttModel,
  repeats,
  scope:
    'Synthetic PCM after capture; local gateway/Postgres; real remote providers; actual offscreen/background relay code in VM; actual content script in Chromium with mocked chrome APIs. DOM frame acknowledgement is not physical screen paint.',
  knowledge,
  samples: [],
};
let current;
const now = () => Date.now();
const save = () => {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(results, null, 2));
  JSON.parse(readFileSync(output, 'utf8'));
};
const embeddingBase = createEmbeddingClient({
  provider: 'openai',
  openaiApiKey: openaiKey,
  openaiOutputDimensions: 256,
});
const embeddings = {
  dimension: () => 256,
  embed: async (req) => {
    const sample = current;
    const t = now();
    const r = await embeddingBase.embed(req);
    sample?.stages.push({ stage: 'embedding', start: t, end: now() });
    return r;
  },
};
const llmBase = createLlmClient({
  provider: 'anthropic',
  anthropicApiKey: anthropicKey,
  anthropicModel: model,
});
const llm = {
  complete: async (req) => {
    const sample = current;
    const call = { stage: 'llm', start: now(), firstRawToken: null, completeField: null };
    sample?.stages.push(call);
    const r = await llmBase.complete({
      ...req,
      onPartialText: (delta, acc) => {
        call.firstRawToken ??= now();
        if (
          !call.completeField &&
          /"(?:answer_text|followup_text)"\s*:\s*"(?:\\.|[^"\\])+"/.test(acc)
        )
          call.completeField = now();
        req.onPartialText?.(delta, acc);
      },
    });
    Object.assign(call, {
      end: now(),
      model: r.model,
      finish: r.finishReason,
      parsed: !!r.parsed,
      usage: r.usage,
    });
    if (r.finishReason === 'error')
      call.error = r.text.match(/anthropic \d+/)?.[0] ?? 'provider error';
    return r;
  },
};
const app = Fastify({ logger: false });
let browser;
let offscreen;
try {
  const workspace = await prisma.workspace.create({
    data: { name: 'Phase 4 synthetic benchmark', slug: `phase4-${randomUUID()}` },
  });
  const user = await prisma.user.create({
    data: { name: 'Synthetic evaluator', email: `phase4-${randomUUID()}@example.invalid` },
  });
  results.workspaceId = workspace.id;
  await prisma.workspaceBmc.create({
    data: {
      workspaceId: workspace.id,
      sourceType: 'manual',
      data: {
        niche: 'B2B sales teams with 10 to 50 reps',
        problem: 'Reps need grounded live-call coaching',
        pricing: knowledge[0][1],
        delivery: knowledge[2][1],
      },
    },
  });
  const vectors = await embeddings.embed({
    workspaceId: workspace.id,
    texts: knowledge.map((k) => k[1]),
  });
  for (const [i, [category, text]] of knowledge.entries()) {
    const document = await prisma.knowledgeDocument.create({
      data: { workspaceId: workspace.id, name: `${category}.md`, category, status: 'ready' },
    });
    const version = await prisma.knowledgeDocumentVersion.create({
      data: { documentId: document.id, version: 1, contentHash: randomUUID() },
    });
    await prisma.$executeRawUnsafe(
      "INSERT INTO knowledge_chunks (id,workspace_id,document_version_id,chunk_text,chunk_order,tags_json,language,embedding) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,0,'[]'::jsonb,'en-US',$5::vector)",
      randomUUID(),
      workspace.id,
      version.id,
      text,
      JSON.stringify(vectors.vectors[i]),
    );
  }
  await app.register(jwt, { secret: randomUUID() + randomUUID() });
  await app.register(websocket);
  registerSessionHandler(
    app,
    {
      stt: createSttClient({
        provider: 'deepgram',
        deepgramApiKey: process.env.DEEPGRAM_API_KEY,
        deepgramModel: sttModel,
      }),
      embeddings,
      llm,
      minDisplayConfidence: 0.5,
      urgencyThreshold: 0.35,
      idleTimeoutMs: 60000,
      maxPendingSegments: 200,
      postcallUrl: '',
      apiUrl: '',
      autoRecap: false,
      autoEndMeeting: false,
    },
    {
      reactive: async (input, deps) => {
        const sample = current;
        const stage = {
          stage: 'coach',
          start: now(),
          text: input.customerText,
          transcriptArrived: input.turnEndAt,
        };
        sample.stages.push(stage);
        try {
          const r = await coachAndPersist(input, deps);
          Object.assign(stage, { end: now(), display: r.display, rationale: r.rationale });
          return r;
        } catch (e) {
          Object.assign(stage, { end: now(), error: e.name });
          throw e;
        }
      },
      proactive: async (input, deps) => {
        const sample = current;
        const stage = { stage: 'proactive', start: now(), trigger: input.trigger };
        sample?.stages.push(stage);
        try {
          const r = await proactiveCoach(input, deps);
          Object.assign(stage, { end: now(), display: r?.display });
          return r;
        } catch (e) {
          Object.assign(stage, { end: now(), error: e.name });
          throw e;
        }
      },
    },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  browser = await chromium.launch({ headless: true });
  async function bundle(entry, suffix = '') {
    return (
      await build({
        stdin: {
          contents: readFileSync(entry, 'utf8') + suffix,
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
      })
    ).outputFiles[0].text;
  }
  const contentCode = await bundle(resolve(extension, 'content/index.ts'));
  const offscreenCode = await bundle(
    resolve(extension, 'offscreen/index.ts'),
    '\nglobalThis.probe = {set(v){active=v},openSocket,stop};',
  );
  const bgSource = readFileSync(resolve(extension, 'background/index.ts'), 'utf8');
  const bgCode = (
    await transform(
      bgSource.slice(
        bgSource.indexOf('const MAX_SUGGESTION_FIELD_LEN ='),
        bgSource.indexOf('// Footer link in the in-Meet panel'),
      ),
      { loader: 'ts' },
    )
  ).code;
  const pcm = new Map();
  for (const text of new Set(scenarios.flatMap((s) => s.turns))) {
    const file = resolve(scratch, `speech-${pcm.size}.aiff`);
    execFileSync('say', ['-v', 'Samantha', '-r', '175', '-o', file, text]);
    const raw = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      '16000',
      'pipe:1',
    ]);
    let last = raw.length / 2 - 1;
    while (last > 0 && Math.abs(raw.readInt16LE(last * 2)) < 300) last--;
    assert.ok(last > 1600, 'TTS fixture must contain actual audio');
    const stereo = Buffer.alloc((last + 1) * 4);
    for (let i = 0; i <= last; i++) stereo.writeInt16LE(raw.readInt16LE(i * 2), i * 4);
    pcm.set(text, stereo);
  }
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const scenario of scenarios) {
      const sample = {
        id: scenario.id,
        repeat,
        expected: scenario.expected,
        stages: [],
        frames: [],
        paints: [],
        audio: [],
        errors: [],
      };
      current = sample;
      results.samples.push(sample);
      const meeting = await prisma.meeting.create({
        data: {
          workspaceId: workspace.id,
          hostUserId: user.id,
          externalPlatform: 'synthetic',
          externalMeetingId: randomUUID(),
          title: `phase4 ${scenario.id}`,
        },
      });
      sample.meetingId = meeting.id;
      const page = await browser.newPage();
      await page.route('**/*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<html><head><title>Meet</title></head><body></body></html>',
        }),
      );
      await page.goto('https://meet.google.com/abc-defg-hij');
      page.on('pageerror', (e) => sample.errors.push(e.message));
      await page.evaluate(() => {
        window.listeners = [];
        window.chrome = {
          runtime: {
            onMessage: { addListener: (fn) => window.listeners.push(fn) },
            sendMessage: async () => ({}),
          },
          storage: {
            local: {
              get: (_keys, cb) => {
                const x = { capture: { closed: false } };
                cb?.(x);
                return Promise.resolve(x);
              },
              set: async () => {},
            },
            onChanged: { addListener() {} },
          },
        };
      });
      await page.addScriptTag({ content: contentCode });
      await page.exposeFunction('paintAck', (value) => sample.paints.push(value));
      const bgListeners = [];
      const bg = vm.createContext({
        isPrivilegedSender: (s) => s.id === 'phase4',
        getActive: async () => ({
          tabId: 1,
          meetingId: 'abc-defg-hij',
          internalMeetingId: meeting.id,
        }),
        chrome: {
          runtime: { onMessage: { addListener: (fn) => bgListeners.push(fn) } },
          tabs: {
            sendMessage: async (_id, m) => {
              await page.evaluate((msg) => {
                for (const f of window.listeners) f(msg);
                const deliveredText =
                  document.querySelector('#athena-overlay-root')?.innerText ?? '';
                requestAnimationFrame(() =>
                  requestAnimationFrame(() =>
                    window.paintAck({
                      at: Date.now(),
                      text: document.querySelector('#athena-overlay-root')?.innerText ?? '',
                      draft: document.querySelector('.athena-card-streaming')?.innerText ?? '',
                      event: msg.event,
                      generationId: msg.generationId,
                      stable:
                        deliveredText ===
                        (document.querySelector('#athena-overlay-root')?.innerText ?? ''),
                    }),
                  ),
                );
              }, m);
            },
          },
        },
      });
      vm.runInContext(bgCode, bg);
      class ObservedSocket extends WebSocket {
        constructor(url) {
          super(url);
          this.on('message', (data) => {
            const frame = JSON.parse(data.toString());
            sample.frames.push({ at: now(), ...frame });
          });
        }
      }
      offscreen = vm.createContext({
        console,
        WebSocket: ObservedSocket,
        Blob,
        ArrayBuffer,
        TextDecoder,
        setTimeout,
        chrome: {
          runtime: {
            id: 'phase4',
            onMessage: { addListener() {} },
            sendMessage: async (m) => {
              if (m.type === 'suggestion.lifecycle.forward')
                for (const listener of bgListeners) listener(m, { id: 'phase4' });
            },
          },
        },
      });
      vm.runInContext(offscreenCode, offscreen);
      const capture = {
        generationId: null,
        gatewayUrl: `http://127.0.0.1:${port}`,
        meetingId: meeting.id,
        channels: 2,
        accessToken: app.jwt.sign({
          sub: user.id,
          workspaceId: workspace.id,
          role: 'rep',
          membershipId: randomUUID(),
        }),
        reconnectAttempt: null,
        finalsHeard: 0,
        suggestionsHeard: 0,
        ctx: { close: async () => {} },
        stream: { getTracks: () => [] },
      };
      offscreen.probe.set(capture);
      offscreen.probe.openSocket();
      const waitUntil = async (predicate, ms) => {
        const end = now() + ms;
        while (now() < end) {
          if (predicate()) return true;
          await delay(20);
        }
        return false;
      };
      assert.ok(await waitUntil(() => capture.ready, 12000), 'STT session must become ready');
      for (const [index, text] of scenario.turns.entries()) {
        const raw = pcm.get(text);
        const start = now();
        for (let offset = 0; offset < raw.length; offset += 6400) {
          await delay(Math.max(0, start + Math.min(offset + 6400, raw.length) / 64 - now()));
          capture.ws.send(raw.subarray(offset, offset + 6400));
        }
        const end = start + raw.length / 64;
        sample.audio.push({ text, start, end });
        const waitMs = 10000;
        const until = now() + waitMs;
        while (now() < until) {
          capture.ws.send(Buffer.alloc(6400));
          await delay(100);
          if (
            scenario.interrupt &&
            index === 0 &&
            sample.frames.some((f) => f.type === 'suggestion.started' && f.at > end)
          )
            break;
          if (
            now() > end + 2000 &&
            sample.frames.some((f) => {
              const latest = sample.frames.findLast((x) => x.type === 'suggestion.started');
              return (
                f.type === 'suggestion.ended' &&
                latest?.at >= start &&
                f.generationId === latest.generationId
              );
            })
          )
            break;
        }
      }
      sample.benchmarkStopAt = now();
      const starts = sample.frames.filter((f) => f.type === 'suggestion.started');
      const coaches = sample.stages.filter((s) => s.stage === 'coach');
      sample.interruptionObserved = scenario.interrupt
        ? !!(
            starts.length >= 2 &&
            coaches[0]?.error === 'AbortError' &&
            coaches[0].end < sample.benchmarkStopAt &&
            !sample.frames.some((f) => f.code === 'COACH_FAILED') &&
            sample.frames.some(
              (f) =>
                f.type === 'suggestion.ended' &&
                f.generationId === starts[0].generationId &&
                f.at <= starts[1].at,
            ) &&
            !sample.frames.some(
              (f) => f.type === 'suggestion.generated' && f.generationId === starts[0].generationId,
            )
          )
        : null;
      await offscreen.probe.stop('benchmark');
      await vm.runInContext('coachRelay', bg);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      sample.finalDom = await page.locator('body').innerText();
      await page.close();
      offscreen = null;
      await shutdownLatency();
      sample.telemetry = await prisma.latencyEvent.findMany({
        where: { workspaceId: workspace.id, meetingId: meeting.id },
        select: { stage: true, latencyMs: true, model: true, cacheReadTokens: true },
      });
      save();
      console.log(
        `${scenario.id} repeat=${repeat} finals=${sample.frames.filter((f) => f.type === 'transcript.final').length} displayed=${sample.frames.filter((f) => f.type === 'suggestion.generated' && f.suggestion?.display).length}`,
      );
    }
} finally {
  if (offscreen) await offscreen.probe.stop('cleanup');
  await browser?.close();
  await app.close();
  await shutdownLatency();
  await prisma.$disconnect();
  rmSync(scratch, { recursive: true, force: true });
  save();
}

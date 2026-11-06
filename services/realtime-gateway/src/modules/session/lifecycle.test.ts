import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';
import WebSocket from 'ws';
import { prisma } from '@athena/db';
import { abortable } from './abortable.js';
import { getActiveSession, registerSessionHandler } from './handler.js';
import {
  coachAndPersist,
  classifyHeuristic,
  type CoachInput,
  type CoachOutput,
  type ProactiveInput,
} from '../../lib/coach.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Prisma delegates expose methods through a proxy, without own descriptors.
function stub(target: object, method: string, replacement: (...args: any[]) => Promise<unknown>) {
  const original = Reflect.get(target, method);
  assert.equal(typeof original, 'function');
  assert.equal(Reflect.set(target, method, replacement), true);
  return () => {
    Reflect.set(target, method, original);
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(5);
  }
  assert.fail('expected lifecycle event did not arrive');
}

function output(text: string): CoachOutput {
  return {
    type: 'answer',
    answerText: text,
    followupText: null,
    confidenceScore: 1,
    priorityScore: 1,
    sourceChunkIds: [],
    policyVersion: 'test',
    rationale: 'test',
    display: true,
    intent: { ...classifyHeuristic('How does it work?'), source: 'heuristic' },
    sources: [],
    suggestionId: null,
    newFacts: [text],
    openEpisode: {
      id: text,
      archetype: 'price',
      currentStep: 'isolate',
      reframeUsed: null,
      deflections: 0,
    },
  };
}

test('abortable releases immediately, observes late rejection, and skips pre-aborted work', async () => {
  const controller = new AbortController();
  const work = deferred<string>();
  let started = false;
  const run = abortable(() => {
    started = true;
    return work.promise;
  }, controller.signal);
  await until(() => started);
  controller.abort();
  await assert.rejects(run, { name: 'AbortError' });
  work.reject(new Error('late provider rejection'));
  await delay(0);
  let invoked = false;
  await assert.rejects(
    abortable(async () => {
      invoked = true;
      return '';
    }, controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(invoked, false);
});

test('cancelled retrieval cannot proceed to a database query or a model call', async () => {
  const embedding = deferred<{ vectors: number[][]; dimension: number; model: string }>();
  const controller = new AbortController();
  let embeddingStarted = false;
  const query = mock.method(prisma, '$queryRawUnsafe', async () => {
    throw new Error('unexpected database work');
  });
  try {
    const run = coachAndPersist(
      {
        workspaceId: 'test',
        meetingId: 'test',
        turnId: 'test',
        customerText: 'How does it work?',
        contextTurns: [],
        abortSignal: controller.signal,
      },
      {
        instantOpeners: false,
        llm: null,
        minDisplayConfidence: 0.6,
        urgencyThreshold: 0.35,
        embeddings: {
          dimension: () => 3,
          embed: async () => {
            embeddingStarted = true;
            return embedding.promise;
          },
        },
      },
    );
    await until(() => embeddingStarted);
    controller.abort();
    embedding.resolve({ vectors: [[1, 0, 0]], dimension: 3, model: 'test' });
    await assert.rejects(run, { name: 'AbortError' });
    assert.equal(query.mock.callCount(), 0);
  } finally {
    query.mock.restore();
  }
});

for (const stopMode of ['bye', 'disconnect'] as const) {
  test(
    `real session supersedes stalled coaches and rejects stale output/state through ${stopMode}`,
    { timeout: 10000 },
    async () => {
      const meetingId = '12345678-1234-4234-8234-123456789012';
      const methods = [
        stub(prisma.meeting, 'findFirst', async () => ({ id: meetingId })),
        stub(prisma.turn, 'create', async () => ({ id: 'turn' })),
        stub(prisma.transcriptSegment, 'create', async () => ({ id: 'segment' })),
      ];
      const runs: Array<{ input: CoachInput; result: ReturnType<typeof deferred<CoachOutput>> }> =
        [];
      const nudges: Array<{
        input: ProactiveInput;
        result: ReturnType<typeof deferred<CoachOutput | null>>;
      }> = [];
      const app = Fastify({ logger: false });
      let ws: WebSocket | undefined;
      const messages: Array<Record<string, any>> = [];
      try {
        await app.register(jwt, { secret: 'test-secret-that-is-long-enough-for-local-tests-only' });
        await app.register(websocket);
        registerSessionHandler(
          app,
          {
            stt: { open: async () => ({ push() {}, close: async () => {} }) },
            embeddings: {
              dimension: () => 3,
              embed: async () => ({ vectors: [], dimension: 3, model: 'test' }),
            },
            llm: null,
            minDisplayConfidence: 0.6,
            urgencyThreshold: 0.35,
            idleTimeoutMs: 60000,
            maxPendingSegments: 50,
            postcallUrl: '',
            apiUrl: '',
            autoRecap: false,
            autoEndMeeting: false,
          },
          {
            reactive: async (input) => {
              const result = deferred<CoachOutput>();
              runs.push({ input, result });
              return result.promise;
            },
            proactive: async (input) => {
              const result = deferred<CoachOutput | null>();
              nudges.push({ input, result });
              return result.promise;
            },
          },
        );
        await app.listen({ port: 0, host: '127.0.0.1' });
        const token = app.jwt.sign({
          sub: 'test-user',
          workspaceId: 'test-workspace',
          role: 'rep',
          membershipId: 'test-member',
        });
        ws = new WebSocket(
          `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/sessions`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
        await once(ws, 'open');
        ws.send(JSON.stringify({ type: 'hello', meetingId, channels: 2 }));
        await until(() => messages.some((m) => m.type === 'ready'));
        const session = getActiveSession(meetingId)!;
        async function say(text: string, channelIndex: number) {
          await session.onFinal({
            segmentId: 'test',
            text,
            startMs: 0,
            endMs: 100,
            confidence: 1,
            isFinal: true,
            speakerLabel: 'test',
            channelIndex,
            language: 'en',
          });
        }
        async function customer(text: string) {
          await say(text, 0);
          await say('Understood.', 1); // unambiguous turn boundary, no timer sleeps
        }

        // A proactive provider that ignores AbortSignal must not block a buyer.
        await say('Let me show you the product.', 1);
        await until(() => nudges.length === 1);
        await customer('How does the first feature work?');
        await until(() => runs.length === 1);
        assert.equal(nudges[0]!.input.abortSignal?.aborted, true);

        runs[0]!.input.onPartialText?.('', '{"answer_text":"first partial"');
        await until(() => messages.some((m) => m.answerText === 'first partial'));
        await customer('How does the second feature work?');
        await until(() => runs.length === 2);
        assert.equal(runs[0]!.input.abortSignal?.aborted, true);
        // Neither ignored cancellation nor a successful stale return may commit.
        nudges[0]!.result.resolve(output('stale proactive'));
        runs[0]!.input.onPartialText?.('', '{"answer_text":"stale partial"');
        runs[0]!.result.resolve(output('stale first'));
        runs[1]!.input.onPartialText?.('', '{"answer_text":"current partial"');
        runs[1]!.result.resolve(output('current final'));
        await until(() => messages.some((m) => m.suggestion?.answerText === 'current final'));

        await customer('How does the third feature work?');
        await until(() => runs.length === 3);
        assert.deepEqual(runs[2]!.input.establishedFacts, ['current final']);
        assert.equal(runs[2]!.input.openEpisode?.id, 'current final');
        assert.deepEqual(runs[2]!.input.recentSuggestions, ['current final']);
        assert.equal(
          messages.some((m) => JSON.stringify(m).includes('stale')),
          false,
        );

        // Stop while generation is unresolved; late transcript callbacks cannot restart it.
        await say('How does the buffered feature work?', 0);
        if (stopMode === 'bye') ws.send(JSON.stringify({ type: 'bye' }));
        else ws.terminate();
        await until(() => runs[2]!.input.abortSignal?.aborted === true);
        runs[2]!.input.onPartialText?.('', '{"answer_text":"after stop"');
        runs[2]!.result.resolve(output('after stop'));
        await customer('How does the fourth feature work?');
        await delay(150); // longer than the default sentence-settle timer
        assert.equal(runs.length, 3);
        assert.equal(
          messages.some((m) => JSON.stringify(m).includes('after stop')),
          false,
        );
        assert.equal(
          messages.some((m) => m.code === 'COACH_FAILED'),
          false,
        );
      } finally {
        ws?.terminate();
        await app.close();
        for (const restore of methods) restore();
      }
    },
  );
}

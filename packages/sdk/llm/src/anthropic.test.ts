import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AnthropicLlmClient } from './anthropic.js';

/** Build an SSE body in Anthropic's `event:`/`data:` frame format. */
function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`${f}\n\n`));
      controller.close();
    },
  });
}

async function withStubbedFetch<T>(body: ReadableStream<Uint8Array>, fn: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as never;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// Prompt-cache counts were previously never read off the wire, which made
// cache effectiveness unmeasurable (PRD v2 F19 AC4). These assert the
// streaming path — the one the live coach uses — surfaces them.
test('streaming usage: cache counts from message_start survive message_delta', async () => {
  const body = sseStream([
    'event: message_start\ndata: ' +
      JSON.stringify({
        type: 'message_start',
        message: {
          model: 'claude-haiku-4-5',
          usage: {
            input_tokens: 1500,
            cache_read_input_tokens: 1300,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    'event: content_block_delta\ndata: ' +
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '{"type":"none"}' },
      }),
    'event: message_delta\ndata: ' +
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 42 },
      }),
  ]);

  const client = new AnthropicLlmClient({ apiKey: 'test-key' });
  const deltas: string[] = [];
  const r = await withStubbedFetch(body, () =>
    client.complete({
      workspaceId: 'ws-1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      onPartialText: (d) => deltas.push(d),
    }),
  );

  assert.equal(r.usage?.cacheReadTokens, 1300, 'cache read count must be surfaced');
  assert.equal(r.usage?.inputTokens, 1500);
  assert.equal(
    r.usage?.outputTokens,
    42,
    'message_delta must update output_tokens without clobbering cache counts',
  );
  // 0 is meaningful ("cache existed, nothing written") and must not be dropped
  // as falsy — absent and zero are different facts.
  assert.equal(r.usage?.cacheCreationTokens, 0);
  assert.equal(r.model, 'claude-haiku-4-5');
  assert.equal(r.finishReason, 'stop');
  assert.deepEqual(deltas, ['{"type":"none"}'], 'text deltas still stream to the callback');
});

test('streaming usage: fields absent on the wire stay undefined', async () => {
  const body = sseStream([
    'event: message_start\ndata: ' +
      JSON.stringify({ type: 'message_start', message: { model: 'claude-haiku-4-5', usage: {} } }),
    'event: content_block_delta\ndata: ' +
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }),
  ]);

  const client = new AnthropicLlmClient({ apiKey: 'test-key' });
  const r = await withStubbedFetch(body, () =>
    client.complete({
      workspaceId: 'ws-1',
      messages: [{ role: 'user', content: 'hi' }],
      onPartialText: () => {},
    }),
  );

  assert.equal(r.usage?.cacheReadTokens, undefined, 'no cache field → undefined, not 0');
  assert.equal(r.usage?.inputTokens, undefined);
  assert.equal(r.text, 'ok');
});

/**
 * BMC guided-builder proxy (wizard Step 1). The knowledge-service endpoint
 * streams the generated section token-by-token over Server-Sent Events. For v1
 * the wizard shows a per-section spinner rather than live tokens, so this proxy
 * collects the stream server-side and returns the final `done` payload as plain
 * JSON: { section, text, version }. A future streaming version can swap to
 * piping `upstream.body` straight through.
 */
import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { serverEnv } from '@/lib/env';

interface DonePayload {
  section: string;
  text: string;
  version: number;
}

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();

  let body: { section?: unknown; userInput?: unknown };
  try {
    body = (await req.json()) as { section?: unknown; userInput?: unknown };
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY', message: 'invalid JSON' }, { status: 400 });
  }
  const section = typeof body.section === 'string' ? body.section.trim() : '';
  const userInput = typeof body.userInput === 'string' ? body.userInput.trim() : '';
  if (!section || !userInput || userInput.length > 10_000) {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'section and userInput (1–10000 chars) required' },
      { status: 400 },
    );
  }

  const upstream = await backendFetch({
    baseUrl: env.knowledgeUrl,
    path: '/v1/playbooks/bmc/build',
    method: 'POST',
    body: { section, userInput },
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: 'BUILD_FAILED', message: text || `HTTP ${upstream.status}` },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
  }

  const { done, error } = await collectSse(upstream.body);
  if (error) {
    return NextResponse.json({ error: 'BUILD_FAILED', message: error }, { status: 502 });
  }
  if (!done) {
    return NextResponse.json(
      { error: 'BUILD_FAILED', message: 'stream ended without a result' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...done });
}

/**
 * Read the SSE stream to completion and extract the terminal event. We only
 * care about `done` (success) and `error`; `delta` events are discarded since
 * v1 does not render live tokens.
 */
async function collectSse(
  body: ReadableStream<Uint8Array>,
): Promise<{ done?: DonePayload; error?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done: DonePayload | undefined;
  let error: string | undefined;

  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = lineValue(raw, 'event:');
      const data = lineValue(raw, 'data:');
      if (!data) continue;
      if (event === 'done') {
        try {
          done = JSON.parse(data) as DonePayload;
        } catch {
          error = 'malformed done payload';
        }
      } else if (event === 'error') {
        try {
          error = (JSON.parse(data) as { message?: string }).message ?? 'generation error';
        } catch {
          error = 'generation error';
        }
      }
    }
  }
  return { done, error };
}

function lineValue(block: string, prefix: string): string | undefined {
  const line = block.split('\n').find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

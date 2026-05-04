/**
 * BMC routes (Block Q phase 3).
 *
 *   POST /v1/playbooks/bmc/import   — multipart PDF/text → extract → save
 *   POST /v1/playbooks/bmc/build    — SSE stream of one bmc-builder section
 *   GET  /v1/playbooks/bmc          — read current BMC for the workspace
 *   PUT  /v1/playbooks/bmc          — manual full-replacement edit
 *
 * The build endpoint streams the LLM's section text via Server-Sent Events
 * so the wizard UI can render tokens as they arrive (no spinner stare for
 * the 5-15s LLM latency per section). All other endpoints are normal JSON.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LlmClient } from '@athena/sdk-llm';
import {
  BMC_SECTIONS,
  buildSectionPrompt,
  extractBmcFromUpload,
  getBmc,
  saveBmc,
  type BmcData,
  type BmcSection,
} from './service.js';
import { generateScriptFromBmc } from './generator.js';

interface RouteDeps {
  llm: LlmClient;
  anthropicApiKey: string;
  anthropicModel: string;
}

const SaveBody = z.object({
  data: z.record(z.string()),
  sourceType: z.enum(['pdf', 'interactive', 'manual']).default('manual'),
});

const BuildBody = z.object({
  section: z.enum(BMC_SECTIONS),
  userInput: z.string().min(1).max(10_000),
});

export function bmcRoutes(deps: RouteDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/playbooks/bmc', async (req) => {
      const claims = await req.requirePermission('knowledge:read');
      const bmc = await getBmc(claims.workspaceId);
      return bmc ?? { data: {}, sourceType: null, version: 0, updatedAt: null };
    });

    app.put('/playbooks/bmc', async (req) => {
      const claims = await req.requirePermission('knowledge:upload');
      const body = SaveBody.parse(req.body);
      const cleaned = sanitizeData(body.data);
      const r = await saveBmc({
        workspaceId: claims.workspaceId,
        data: cleaned,
        sourceType: body.sourceType,
      });
      return { ok: true, version: r.version };
    });

    app.post('/playbooks/bmc/import', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:upload');
      const file = await req.file();
      if (!file) {
        return reply.code(400).send({ code: 'NO_FILE', message: 'multipart file required' });
      }
      const buffer = await file.toBuffer();
      const filename = file.filename ?? '';
      const format: 'pdf' | 'text' | 'markdown' = filename.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : filename.toLowerCase().endsWith('.md')
          ? 'markdown'
          : 'text';
      const extracted = await extractBmcFromUpload(
        { workspaceId: claims.workspaceId, buffer, format },
        { llm: deps.llm },
      );
      if (!extracted) {
        return reply.code(422).send({
          code: 'NOT_A_BMC',
          message: 'document does not look like a Business Model Canvas — try the guided builder',
        });
      }
      const r = await saveBmc({
        workspaceId: claims.workspaceId,
        data: extracted.data,
        sourceType: 'pdf',
      });
      return { ok: true, version: r.version, data: extracted.data, confidence: extracted.confidence };
    });

    app.post('/playbooks/script/generate-from-bmc', async (req, reply) => {
      const claims = await req.requirePermission('script:edit');
      try {
        const r = await generateScriptFromBmc(
          { workspaceId: claims.workspaceId, actorUserId: claims.sub },
          { llm: deps.llm },
        );
        return reply.code(201).send({
          ok: true,
          collectionId: r.collectionId,
          versionId: r.versionId,
          blockCount: r.blockCount,
          generatedAt: r.generatedAt.toISOString(),
        });
      } catch (err) {
        const e = err as { statusCode?: number; code?: string; message?: string };
        return reply.code(e.statusCode ?? 500).send({
          code: e.code ?? 'GENERATE_FAILED',
          message: e.message ?? 'unknown',
        });
      }
    });

    app.post('/playbooks/bmc/build', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:upload');
      const body = BuildBody.parse(req.body);
      const existing = await getBmc(claims.workspaceId);
      const priorSections = (existing?.data ?? {}) as BmcData;

      const prompt = buildSectionPrompt({
        section: body.section as BmcSection,
        priorSections,
        userInput: body.userInput,
      });

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      try {
        const text = await streamAnthropic(
          {
            apiKey: deps.anthropicApiKey,
            model: deps.anthropicModel,
            system: prompt.system,
            user: prompt.user,
          },
          (delta) => {
            reply.raw.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`);
          },
        );
        // Persist the new section into the workspace BMC immediately so the
        // user can refresh / resume. Coach script regen happens separately
        // after step 10.
        const nextData: BmcData = { ...priorSections, [body.section]: text };
        const saved = await saveBmc({
          workspaceId: claims.workspaceId,
          data: nextData,
          sourceType: 'interactive',
        });
        reply.raw.write(
          `event: done\ndata: ${JSON.stringify({ section: body.section, text, version: saved.version })}\n\n`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      } finally {
        reply.raw.end();
      }
      // Inform Fastify we already sent the response.
      return reply;
    });
  };
}

function sanitizeData(raw: Record<string, string>): BmcData {
  const out: BmcData = {};
  for (const k of BMC_SECTIONS) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

/** Minimal Anthropic streaming caller — direct fetch so we don't need the
 *  SDK as a dep. Forwards each text delta to onDelta and returns the full
 *  concatenated text once the stream ends. */
async function streamAnthropic(
  args: { apiKey: string; model: string; system: string; user: string },
  onDelta: (text: string) => void,
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  let acc = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: 1500,
        temperature: 0.3,
        stream: true,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => 'no body')}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const dataLine = event
          .split('\n')
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim();
        if (!dataLine || dataLine === '[DONE]') continue;
        try {
          const payload = JSON.parse(dataLine) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (
            payload.type === 'content_block_delta' &&
            payload.delta?.type === 'text_delta' &&
            payload.delta.text
          ) {
            acc += payload.delta.text;
            onDelta(payload.delta.text);
          }
        } catch {
          // Ignore malformed event lines — Anthropic occasionally sends
          // non-JSON keepalive comments.
        }
      }
    }
    return acc.trim();
  } finally {
    clearTimeout(timer);
  }
}

// Suppress unused warning for FastifyRequest; types prevent name-only import.
void (null as unknown as FastifyRequest);

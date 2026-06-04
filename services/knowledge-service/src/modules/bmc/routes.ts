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
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
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
import { indexBmcAsKnowledge } from './indexer.js';
import { generateObjectionMatrixFromBmc } from './matrix-generator.js';
import { indexObjectionMatrix } from './matrix-indexer.js';

interface RouteDeps {
  llm: LlmClient;
  embeddings: EmbeddingClient;
  anthropicApiKey: string;
  anthropicModel: string;
}

/** A BMC section counts as "filled" at the same threshold the indexer uses, so
 *  proactive generation and retrieval grounding agree on what's substantive. */
const MIN_SECTION_LEN = 10;

/** Proactive generation only fires once the BMC is fully filled — we don't want
 *  to auto-publish a playbook from a half-built canvas. Exported for unit test. */
export function isBmcComplete(data: BmcData): boolean {
  return BMC_SECTIONS.every((s) => (data[s] ?? '').trim().length >= MIN_SECTION_LEN);
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
    // Stash indexer deps on the Fastify instance so `safeIndex` (a free
    // function below) can read them off `req.server` without forcing every
    // route handler to thread them through manually.
    (app as unknown as { _bmcIndexerDeps: { embeddings: EmbeddingClient } })._bmcIndexerDeps = {
      embeddings: deps.embeddings,
    };

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
      const indexed = await safeIndex(req, {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        data: cleaned,
        version: r.version,
      });
      triggerPlaybookGen(
        req,
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          data: cleaned,
          bmcVersion: r.version,
        },
        { llm: deps.llm, embeddings: deps.embeddings },
      );
      return { ok: true, version: r.version, indexed };
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
      const indexed = await safeIndex(req, {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        data: extracted.data,
        version: r.version,
      });
      triggerPlaybookGen(
        req,
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          data: extracted.data,
          bmcVersion: r.version,
        },
        { llm: deps.llm, embeddings: deps.embeddings },
      );
      return {
        ok: true,
        version: r.version,
        data: extracted.data,
        confidence: extracted.confidence,
        indexed,
      };
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
        const indexed = await safeIndex(req, {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          data: nextData,
          version: saved.version,
        });
        reply.raw.write(
          `event: done\ndata: ${JSON.stringify({
            section: body.section,
            text,
            version: saved.version,
            indexed,
          })}\n\n`,
        );
        // Fire proactive gen after each section save; the completeness guard
        // inside runPlaybookGen no-ops until all 10 sections are filled, and
        // idempotency prevents re-runs for an unchanged version.
        triggerPlaybookGen(
          req,
          {
            workspaceId: claims.workspaceId,
            actorUserId: claims.sub,
            data: nextData,
            bmcVersion: saved.version,
          },
          { llm: deps.llm, embeddings: deps.embeddings },
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

/**
 * Proactive playbook generation, fired (fire-and-forget) from every BMC
 * completion point. Two guards keep it cheap and correct:
 *   1. Completeness — skip until all 10 sections are filled.
 *   2. Idempotency — skip if the singleton auto-collection was already built
 *      for this exact bmcVersion (every BMC edit bumps the version, so a real
 *      change always regenerates; a duplicate save does not).
 * Failures NEVER surface to the user — this runs after the response is sent.
 *
 * Phase 3 extends this to also generate the BMC-specific objection→solution
 * matrix after the scripts; for now it covers scripts only.
 */
async function runPlaybookGen(
  args: { workspaceId: string; actorUserId: string; data: BmcData; bmcVersion: number },
  deps: { llm: LlmClient; embeddings: EmbeddingClient },
  log: FastifyBaseLogger,
): Promise<void> {
  if (!isBmcComplete(args.data)) {
    log.info({ workspaceId: args.workspaceId }, 'playbook gen: BMC incomplete, skipping');
    return;
  }

  // Idempotency: has the auto-collection already been built for this version?
  const auto = await prisma.scriptCollection.findFirst({
    where: { workspaceId: args.workspaceId, isAutoGenerated: true },
    select: { sourceBmcVersion: true },
  });
  if (auto && auto.sourceBmcVersion === args.bmcVersion) {
    log.info(
      { workspaceId: args.workspaceId, bmcVersion: args.bmcVersion },
      'playbook gen: already generated for this BMC version, skipping',
    );
    return;
  }

  try {
    const r = await generateScriptFromBmc(
      { workspaceId: args.workspaceId, actorUserId: args.actorUserId },
      { llm: deps.llm },
    );
    log.info(
      { workspaceId: args.workspaceId, bmcVersion: args.bmcVersion, blockCount: r.blockCount },
      'playbook gen: scripts generated',
    );
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // BMC_VERSION_CHANGED is expected when edits race — a newer run supersedes.
    if (e.code === 'BMC_VERSION_CHANGED') {
      log.info({ workspaceId: args.workspaceId }, 'playbook gen: superseded by newer BMC edit');
      return;
    }
    log.warn({ err, workspaceId: args.workspaceId }, 'playbook gen: script generation failed');
  }

  // Objection matrix is independent of the scripts: a matrix failure must not
  // lose the scripts we just published, and vice versa. On LOW_GROUNDING_YIELD
  // the generator throws BEFORE the indexer runs, so the prior matrix is left
  // untouched (no archive). Only a successful generation archives + re-ingests.
  try {
    const m = await generateObjectionMatrixFromBmc(
      { workspaceId: args.workspaceId, actorUserId: args.actorUserId },
      { llm: deps.llm, embeddings: deps.embeddings },
    );
    const r = await indexObjectionMatrix(
      {
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        entries: m.kept,
        bmcVersion: m.bmcVersion,
      },
      { embeddings: deps.embeddings },
    );
    log.info(
      {
        workspaceId: args.workspaceId,
        bmcVersion: m.bmcVersion,
        indexed: r.indexed,
        dropped: m.dropped.length,
      },
      'playbook gen: objection matrix generated',
    );
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'LOW_GROUNDING_YIELD') {
      log.warn(
        { workspaceId: args.workspaceId },
        'playbook gen: matrix grounding yield too low — prior matrix preserved',
      );
      return;
    }
    log.warn({ err, workspaceId: args.workspaceId }, 'playbook gen: objection matrix failed');
  }
}

/** Fire-and-forget wrapper. Detaches generation from the request lifecycle so
 *  the user's BMC save returns immediately and a generation failure can never
 *  fail the save. */
function triggerPlaybookGen(
  req: FastifyRequest,
  args: { workspaceId: string; actorUserId: string; data: BmcData; bmcVersion: number },
  deps: { llm: LlmClient; embeddings: EmbeddingClient },
): void {
  void runPlaybookGen(args, deps, req.log).catch((err) => {
    req.log.warn({ err, workspaceId: args.workspaceId }, 'playbook gen: unexpected throw');
  });
}

/**
 * Best-effort BMC retrieval indexing. Failures here must NEVER fail the user's
 * BMC save — we log and return null so the caller still sees `ok: true`.
 *
 * Outer closure captures `deps.embeddings` so we can call this from any of the
 * three save paths (PUT, /import, /build) without re-passing them every time.
 */
async function safeIndex(
  req: FastifyRequest,
  args: {
    workspaceId: string;
    actorUserId: string;
    data: BmcData;
    version: number;
  },
): Promise<{ indexed: number; skipped: number; failed: number } | null> {
  // The route closure assigns `_indexerDeps` on `req.server` on first
  // registration (see bmcRoutes). Direct DI keeps the helper pure-stateless.
  const deps = (req.server as unknown as { _bmcIndexerDeps?: { embeddings: EmbeddingClient } })
    ._bmcIndexerDeps;
  if (!deps) return null;
  try {
    const r = await indexBmcAsKnowledge(args, deps);
    if (r.failed.length > 0) {
      req.log.warn(
        { workspaceId: args.workspaceId, failed: r.failed },
        'bmc indexer: some sections failed',
      );
    }
    return {
      indexed: r.indexed.length,
      skipped: r.skipped.length,
      failed: r.failed.length,
    };
  } catch (err) {
    req.log.warn({ err, workspaceId: args.workspaceId }, 'bmc indexer threw');
    return null;
  }
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

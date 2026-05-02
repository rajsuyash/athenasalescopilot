import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import { classifyIntent } from '../intent/service.js';
import { suggest } from './service.js';

const Body = z.object({
  customerText: z.string().min(1).max(4000),
  meetingId: z.string().uuid().optional(),
  contextTurns: z
    .array(
      z.object({
        speaker: z.enum(['rep', 'customer', 'unknown']),
        text: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
  language: z.string().optional(),
});

interface SuggestDeps {
  llm: LlmClient | null;
  embeddings: EmbeddingClient;
  minDisplayConfidence: number;
  urgencyThreshold: number;
}

export function suggestRoutes(deps: SuggestDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * POST /v1/orchestrator/suggest
     * One-shot: classify customer turn → retrieve → generate.
     * Returns the full suggestion object so the rep app can render immediately.
     *
     * Pre-realtime path. Once the WebSocket gateway lands, this becomes the
     * server-side function the gateway calls per turn.
     */
    app.post('/orchestrator/suggest', async (req) => {
      const claims = await req.requireAuth();
      const body = Body.parse(req.body);

      const intent = await classifyIntent(
        {
          workspaceId: claims.workspaceId,
          text: body.customerText,
          ...(body.contextTurns ? { contextTurns: body.contextTurns } : {}),
        },
        { llm: deps.llm, deadlineMs: 1000 },
      );

      const suggestion = await suggest(
        {
          workspaceId: claims.workspaceId,
          customerText: body.customerText,
          intent,
          ...(body.contextTurns ? { contextTurns: body.contextTurns } : {}),
          ...(body.language ? { language: body.language } : {}),
          minDisplayConfidence: deps.minDisplayConfidence,
          urgencyThreshold: deps.urgencyThreshold,
        },
        {
          llm: deps.llm,
          embeddings: deps.embeddings,
          deadlineMs: Number(process.env.LLM_DEADLINE_MS ?? 12000),
        },
      );

      // Persist if we have a meetingId and the suggestion is meaningful.
      let suggestionId: string | null = null;
      if (body.meetingId && (suggestion.answerText || suggestion.followupText)) {
        suggestionId = crypto.randomUUID();
        // Synthetic turn so the suggestion has a foreign key parent. In the
        // realtime path this row exists already; here we create one on demand.
        const turn = await prisma.turn.create({
          data: {
            meetingId: body.meetingId,
            speakerType: 'customer',
            startMs: 0,
            endMs: 0,
          },
        });
        await prisma.suggestion.create({
          data: {
            id: suggestionId,
            workspaceId: claims.workspaceId,
            meetingId: body.meetingId,
            turnId: turn.id,
            suggestionType: suggestion.type,
            answerText: suggestion.answerText,
            followupText: suggestion.followupText,
            confidenceScore: suggestion.confidenceScore,
            priorityScore: suggestion.priorityScore,
            sourceChunkIds: suggestion.sourceChunkIds,
            policyVersion: suggestion.policyVersion,
            rationale: suggestion.rationale,
          },
        });
      }

      return {
        intent,
        suggestion,
        ...(suggestionId ? { suggestionId } : {}),
      };
    });
  };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { retrieveChunks } from './service.js';

const Query = z.object({
  query: z.string().min(1).max(2000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  category: z.string().optional(),
  language: z.string().optional(),
});

interface RetrievalDeps {
  embeddings: EmbeddingClient;
}

export function retrievalRoutes(deps: RetrievalDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * GET /v1/knowledge/search?query=...&topK=...
     * Returns top-k chunks scoped to the caller's workspace.
     */
    app.get('/knowledge/search', async (req) => {
      const claims = await req.requirePermission('knowledge:read');
      const q = Query.parse(req.query);
      const chunks = await retrieveChunks(
        {
          workspaceId: claims.workspaceId,
          query: q.query,
          ...(q.topK !== undefined ? { topK: q.topK } : {}),
          ...(q.minScore !== undefined ? { minScore: q.minScore } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.language ? { language: q.language } : {}),
        },
        deps,
      );
      return { query: q.query, chunks };
    });
  };
}

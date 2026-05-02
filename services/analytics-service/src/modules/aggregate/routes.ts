import type { FastifyInstance } from 'fastify';
import { adoption, coverage, latency, objectionTrends, quality } from './service.js';

export async function aggregateRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/analytics/adoption
   * Counts + 30-day daily buckets for the caller's workspace.
   */
  app.get('/analytics/adoption', async (req) => {
    const claims = await req.requireAuth();
    return adoption(claims.workspaceId);
  });

  /**
   * GET /v1/analytics/objections — top objection categories last 30d.
   */
  app.get('/analytics/objections', async (req) => {
    const claims = await req.requireAuth();
    return { categories: await objectionTrends(claims.workspaceId, 30) };
  });

  /**
   * GET /v1/analytics/quality — useful-rate slices (by suggestion_type, by source doc).
   */
  app.get('/analytics/quality', async (req) => {
    const claims = await req.requireAuth();
    return quality(claims.workspaceId, 30);
  });

  /**
   * GET /v1/analytics/coverage — confidence distribution + knowledge gaps.
   */
  app.get('/analytics/coverage', async (req) => {
    const claims = await req.requireAuth();
    return coverage(claims.workspaceId, 30);
  });

  /**
   * GET /v1/analytics/latency — P50/P95/P99 per stage over the last 7 days,
   * with PRD §7 budget overlay.
   */
  app.get('/analytics/latency', async (req) => {
    const claims = await req.requireAuth();
    return latency(claims.workspaceId, 7);
  });
}

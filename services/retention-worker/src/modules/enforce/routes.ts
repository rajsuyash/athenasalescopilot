import type { FastifyInstance } from 'fastify';
import { enforceForWorkspace } from './service.js';

interface RouteDeps {
  batchSize: number;
}

export function enforceRoutes(deps: RouteDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * POST /v1/retention/enforce — run the sweep for the caller's workspace.
     * Requires `retention:update` (admin/owner).
     */
    app.post('/retention/enforce', async (req) => {
      const claims = await req.requirePermission('retention:update');
      const result = await enforceForWorkspace(claims.workspaceId, {
        batchSize: deps.batchSize,
      });
      return result;
    });
  };
}

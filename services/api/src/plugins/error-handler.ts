import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';

/**
 * Single point of error→JSON translation. Domain throws `ApiError`;
 * Zod validation produces `ZodError`; everything else maps to 500 INTERNAL.
 */
export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply
        .status(err.statusCode)
        .send({
          error: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
      return;
    }

    if (err instanceof ZodError) {
      reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request failed validation.',
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
      return;
    }

    // Coded errors from @athena/auth (AuthError → TOKEN_EXPIRED/TOKEN_INVALID/
    // MISSING_WORKSPACE_CLAIM) and the shared RBAC guard (INSUFFICIENT_ROLE)
    // carry { statusCode, code }. Serialize them in the same { error, message }
    // shape as ApiError so clients that parse body.error/body.message are
    // unaffected. Mirrors the error handler in every other service.
    const coded = err as {
      statusCode?: number;
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
    };
    if (typeof coded.statusCode === 'number' && typeof coded.code === 'string') {
      reply.status(coded.statusCode).send({
        error: coded.code,
        message: coded.message,
        ...(coded.details ? { details: coded.details } : {}),
      });
      return;
    }

    // Unknown — log full and return generic.
    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: 'INTERNAL', message: 'Internal server error.' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'NOT_FOUND', message: 'Route not found.' });
  });
});

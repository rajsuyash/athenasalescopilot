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
        .send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
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

    // Unknown — log full and return generic.
    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: 'INTERNAL', message: 'Internal server error.' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'NOT_FOUND', message: 'Route not found.' });
  });
});

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

interface CodedError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: CodedError, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request failed validation.',
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
      return;
    }
    if (err.statusCode && err.code) {
      reply.status(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: 'INTERNAL', message: 'Internal server error.' });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'NOT_FOUND', message: 'Route not found.' });
  });
});

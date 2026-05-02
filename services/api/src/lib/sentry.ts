import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

let initialised = false;

export function initSentry(dsn: string | undefined, environment: string): void {
  if (initialised || !dsn) return;
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  initialised = true;
}

/**
 * Hook into Fastify's onError so we capture 5xx but ignore client errors —
 * a noisy 4xx feed buries the real production issues.
 */
export function attachSentryHandler(app: FastifyInstance): void {
  if (!initialised) return;
  app.addHook('onError', (request, _reply, error, done) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('route', request.url);
        scope.setTag('method', request.method);
        scope.setTag('request_id', request.id);
        Sentry.captureException(error);
      });
    }
    done();
  });
}

/**
 * Tiny logging helper. `log.debug()` is dead-code-eliminated in production
 * builds (esbuild inlines `process.env.ATHENA_DEV` to `'false'`, the minifier
 * drops the call site). `log.warn` and `log.error` always pass through so
 * we still get failure breadcrumbs in production consoles.
 */
declare const process: { env: { ATHENA_DEV?: string } };
const DEV = process.env.ATHENA_DEV === 'true';

export const log = {
  debug: (...args: unknown[]): void => {
    if (DEV) console.log(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};

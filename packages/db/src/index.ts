import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Re-used across hot reloads in dev.
 * Per service, prefer to import this and not instantiate your own.
 */
declare global {
  // eslint-disable-next-line no-var
  var __athenaPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__athenaPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__athenaPrisma = prisma;
}

export type { Prisma } from '@prisma/client';
export * from '@prisma/client';

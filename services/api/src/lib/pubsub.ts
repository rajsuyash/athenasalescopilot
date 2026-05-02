/**
 * Tiny Redis publisher. Used to broadcast cross-process cache invalidation
 * so the realtime-gateway can flush its in-memory script cache the moment
 * the api commits a publish.
 *
 * Falls back to a no-op publisher when REDIS_URL is unset, so the system
 * still works (the gateway's TTL-based refresh covers the gap).
 */
import { Redis } from 'ioredis';

export type CacheInvalidationKind =
  | 'script.published'
  | 'script.collection.created'
  | 'retention.updated';

export interface CacheInvalidation {
  kind: CacheInvalidationKind;
  workspaceId: string;
  metadata?: Record<string, unknown>;
}

export const CACHE_CHANNEL = 'athena:cache.invalidate';

let client: Redis | null = null;
let initialized = false;

export function initPubSub(redisUrl: string | undefined): void {
  if (initialized) return;
  initialized = true;
  if (!redisUrl) return;
  try {
    const c = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
    c.on('error', () => {
      // Silently keep the publisher alive — best-effort broadcast.
    });
    void c.connect().catch(() => {
      client = null;
    });
    client = c;
  } catch {
    client = null;
  }
}

export async function publishCacheInvalidation(msg: CacheInvalidation): Promise<void> {
  if (!client) return;
  try {
    await client.publish(CACHE_CHANNEL, JSON.stringify(msg));
  } catch {
    // best-effort
  }
}

export async function shutdownPubSub(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* ignore */
  }
  client = null;
  initialized = false;
}

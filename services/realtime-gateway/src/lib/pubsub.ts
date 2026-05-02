/**
 * Redis subscriber. Listens for cache-invalidation broadcasts from the api
 * service and applies them to the in-process caches (script grounding).
 *
 * No-op when REDIS_URL is unset — the existing TTL-based refresh covers it.
 */
import { Redis } from 'ioredis';
import { invalidateScriptCache } from './coach.js';

interface CacheInvalidation {
  kind: string;
  workspaceId: string;
  metadata?: Record<string, unknown>;
}

const CHANNEL = 'athena:cache.invalidate';

let sub: Redis | null = null;
let started = false;

export function initSubscriber(redisUrl: string | undefined): void {
  if (started) return;
  started = true;
  if (!redisUrl) return;
  try {
    const s = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    s.on('error', () => {
      // best-effort — fall through to TTL refresh
    });
    void s
      .connect()
      .then(() => s.subscribe(CHANNEL))
      .catch(() => {
        sub = null;
      });
    s.on('message', (channel: string, payload: string) => {
      if (channel !== CHANNEL) return;
      let parsed: CacheInvalidation;
      try {
        parsed = JSON.parse(payload) as CacheInvalidation;
      } catch {
        return;
      }
      if (!parsed.workspaceId) return;
      switch (parsed.kind) {
        case 'script.published':
        case 'script.collection.created':
          invalidateScriptCache(parsed.workspaceId);
          break;
        default:
          break;
      }
    });
    sub = s;
  } catch {
    sub = null;
  }
}

export async function shutdownSubscriber(): Promise<void> {
  if (!sub) return;
  try {
    await sub.quit();
  } catch {
    /* ignore */
  }
  sub = null;
  started = false;
}

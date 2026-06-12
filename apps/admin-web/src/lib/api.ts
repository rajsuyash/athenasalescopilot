/**
 * Server-side fetcher to backend services. After Block T, identity is owned
 * by Clerk — but ONLY the api service verifies Clerk session JWTs (via its
 * preVerify hook). Every other service (knowledge, analytics, billing, …)
 * verifies HMAC HS256 tokens exclusively, so forwarding a Clerk RS256 JWT to
 * them fails with FAST_JWT_INVALID_ALGORITHM (2026-06-12 incident).
 *
 * getBackendBearer therefore exchanges the Clerk session JWT at the api's
 * POST /v1/auth/token for a short-lived HMAC access token accepted by every
 * service, cached per user until shortly before expiry.
 *
 * No refresh-token bookkeeping. Clerk's session is rotated client-side by
 * their middleware; expired sessions auto-redirect to /signin via the same
 * middleware before requests reach this code.
 */
import { auth } from '@clerk/nextjs/server';
import { serverEnv } from './env';

interface CallOpts {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: 'required' | 'none';
  swallow401?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Re-exchange this many seconds before the cached token's exp. */
const TOKEN_REFRESH_MARGIN_S = 60;

interface CachedToken {
  token: string;
  /** Unix epoch seconds. */
  expiresAt: number;
}

/**
 * Per-user cache of exchanged HMAC tokens (module-level: one map per server
 * instance, which is fine — a cold instance just re-exchanges once).
 */
const tokenCache = new Map<string, CachedToken>();

function jwtExpSeconds(token: string): number {
  try {
    const payloadB64 = token.split('.')[1] ?? '';
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function pruneExpiredTokens(nowSeconds: number): void {
  for (const [userId, entry] of tokenCache) {
    if (entry.expiresAt <= nowSeconds) tokenCache.delete(userId);
  }
}

/**
 * Bearer for backend service calls. Exported for the few proxy routes that
 * stream raw requests/responses and can't go through callBackend/backendFetch
 * (multipart import, file export). NEVER forward a Clerk session token to a
 * backend service instead of this — only the api verifies Clerk tokens.
 */
export async function getBackendBearer(): Promise<string | null> {
  const a = await auth();
  if (!a.userId) return null;

  const nowSeconds = Date.now() / 1000;
  const cached = tokenCache.get(a.userId);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_S > nowSeconds) {
    return cached.token;
  }

  const clerkToken = await a.getToken();
  if (!clerkToken) return null;

  // Exchange the Clerk RS256 session JWT for the HMAC token every backend
  // service verifies. Only the api understands Clerk tokens.
  const res = await fetch(`${serverEnv().apiUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${clerkToken}` },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return null; // treated as signed-out
  if (!res.ok) {
    throw new ApiError(502, 'TOKEN_EXCHANGE_FAILED', `token exchange HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { accessToken?: unknown } | null;
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : null;
  if (!accessToken) {
    throw new ApiError(502, 'TOKEN_EXCHANGE_FAILED', 'token exchange returned no accessToken');
  }

  pruneExpiredTokens(nowSeconds);
  tokenCache.set(a.userId, { token: accessToken, expiresAt: jwtExpSeconds(accessToken) });
  return accessToken;
}

async function doFetch(opts: CallOpts, bearer: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return fetch(`${opts.baseUrl}${opts.path}`, {
    method: opts.method ?? 'GET',
    headers,
    cache: 'no-store',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

export async function callBackend<T = unknown>(opts: CallOpts): Promise<T> {
  let bearer: string | null = null;
  if (opts.auth !== 'none') {
    bearer = await getBackendBearer();
    if (!bearer) throw new ApiError(401, 'UNAUTHENTICATED', 'no session');
  }
  const res = await doFetch(opts, bearer);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && opts.swallow401) return null as T;
    const e = body as { error?: string; message?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      e?.error ?? 'HTTP_ERROR',
      e?.message ?? `HTTP ${res.status}`,
      e?.details,
    );
  }
  return body as T;
}

/**
 * Raw forwarder: same bearer attachment as callBackend, but returns the
 * untouched Response so the caller can read a streaming body (e.g. the BMC
 * builder's Server-Sent Events). callBackend assumes a JSON body and would
 * consume the stream, so SSE proxies use this instead.
 */
export async function backendFetch(opts: CallOpts): Promise<Response> {
  let bearer: string | null = null;
  if (opts.auth !== 'none') {
    bearer = await getBackendBearer();
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'UNAUTHENTICATED', message: 'no session' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  }
  return doFetch(opts, bearer);
}

/**
 * Forward a multipart upload from a Next.js route to a backend service.
 * Streams the body straight through — never buffers in admin-web.
 */
export async function forwardUpload(
  baseUrl: string,
  path: string,
  form: FormData,
): Promise<Response> {
  const bearer = await getBackendBearer();
  if (!bearer) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 });
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
}

/**
 * Server-side fetcher to backend services. After Block T, identity is owned
 * by Clerk: we ask Clerk for a fresh JWT on every call (Clerk handles
 * rotation internally) and forward it as the Bearer token. The backend
 * services verify these JWTs against Clerk's JWKS.
 *
 * No more refresh-token bookkeeping. Clerk's session is rotated client-side
 * by their middleware; expired tokens auto-redirect to /signin via the same
 * middleware before requests reach this code.
 */
import { auth } from '@clerk/nextjs/server';

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

async function getBearer(): Promise<string | null> {
  const a = await auth();
  if (!a.userId) return null;
  return a.getToken();
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
    bearer = await getBearer();
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
 * Forward a multipart upload from a Next.js route to a backend service.
 * Streams the body straight through — never buffers in admin-web.
 */
export async function forwardUpload(
  baseUrl: string,
  path: string,
  form: FormData,
): Promise<Response> {
  const bearer = await getBearer();
  if (!bearer) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 });
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
}

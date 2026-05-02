/**
 * Server-side fetcher to backend services. Reads the session cookie on each
 * call and attaches the access token. Never invoked from client components.
 *
 * 401 handling: tries one refresh against /v1/auth/refresh using the cookie's
 * refresh token. If refresh succeeds, the new tokens are persisted to the
 * cookie and the original call retries once. If refresh fails (refresh token
 * also expired/revoked), the cookie is cleared so the redirect to /signin is
 * NOT followed by /signin bouncing the user back to /dashboard.
 */
import { clearSession, getSession, setSession } from './session';
import { serverEnv } from './env';

interface CallOpts {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Auth defaults to required. */
  auth?: 'required' | 'none';
  /** When true, returns null on 401 instead of throwing. */
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

interface RefreshResp {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

let inFlightRefresh: Promise<RefreshResp | null> | null = null;

/**
 * Hit /v1/auth/refresh with the current cookie's refresh token. Updates the
 * session cookie on success. Coalesces concurrent calls so a flurry of 401s
 * inside one request only refreshes once.
 */
async function refreshSession(): Promise<RefreshResp | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    const session = await getSession();
    if (!session?.refreshToken) return null;
    try {
      const env = serverEnv();
      const r = await fetch(`${env.apiUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        cache: 'no-store',
      });
      if (!r.ok) {
        // Refresh failed → cookie is dead. Clear it so /signin doesn't
        // redirect-loop the user back to /dashboard.
        await clearSession();
        return null;
      }
      const body = (await r.json()) as RefreshResp;
      await setSession({
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt: body.expiresAt,
        workspaceId: session.workspaceId,
      });
      return body;
    } catch {
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function doFetch(
  opts: CallOpts,
  bearer: string | null,
): Promise<Response> {
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
    const session = await getSession();
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'no session');
    bearer = session.accessToken;
  }
  let res = await doFetch(opts, bearer);

  // Auto-refresh on 401: one retry with a fresh access token. If refresh
  // itself fails, the cookie has been cleared inside refreshSession() so the
  // resulting 401 we surface here will route the user to /signin without a
  // redirect loop.
  if (res.status === 401 && opts.auth !== 'none') {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch(opts, refreshed.accessToken);
    }
  }

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
 * Forward an upload (multipart) request from a Next.js route to the knowledge
 * service. We re-bundle the FormData rather than streaming because Node 18+
 * fetch handles `FormData` natively and the upload size cap is 50 MB.
 */
export async function forwardUpload(
  baseUrl: string,
  path: string,
  form: FormData,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 });
  }
  let res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: form,
  });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${refreshed.accessToken}` },
        body: form,
      });
    }
  }
  return res;
}

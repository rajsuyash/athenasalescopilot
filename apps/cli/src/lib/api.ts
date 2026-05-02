import type { Config } from './config.js';
import { loadConfig, saveConfig } from './config.js';

interface ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export class HttpError extends Error implements ApiError {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface FetchOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  /** Auth: 'access' (default), 'none'. */
  auth?: 'access' | 'none';
  /** Override base URL for non-api services. */
  baseUrl?: string;
  /** Path including leading slash. */
  path: string;
}

async function refreshIfNeeded(cfg: Config): Promise<Config> {
  if (!cfg.refreshToken) return cfg;
  if (cfg.expiresAt && new Date(cfg.expiresAt) > new Date(Date.now() + 30_000)) return cfg;
  const res = await fetch(`${cfg.apiUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: cfg.refreshToken }),
  });
  if (!res.ok) {
    // Refresh failed — leave the user logged out and let the caller error.
    return cfg;
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
  const next: Config = {
    ...cfg,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt,
  };
  await saveConfig(next);
  return next;
}

export async function callApi<T = unknown>(opts: FetchOpts): Promise<T> {
  let cfg = await loadConfig();
  if (opts.auth !== 'none') cfg = await refreshIfNeeded(cfg);

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (opts.auth !== 'none' && cfg.accessToken) {
    headers.authorization = `Bearer ${cfg.accessToken}`;
  }

  const url = `${opts.baseUrl ?? cfg.apiUrl}${opts.path}`;
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const res = await fetch(url, init);

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
    const e = body as { error?: string; message?: string; details?: unknown } | null;
    throw new HttpError(res.status, e?.error ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, e?.details);
  }
  return body as T;
}

export async function uploadFile<T>(opts: {
  baseUrl: string;
  path: string;
  formFields: Record<string, string>;
  fileBuffer: Buffer;
  fileName: string;
}): Promise<T> {
  let cfg = await loadConfig();
  cfg = await refreshIfNeeded(cfg);

  const form = new FormData();
  for (const [k, v] of Object.entries(opts.formFields)) form.append(k, v);
  form.append(
    'file',
    new Blob([new Uint8Array(opts.fileBuffer)], { type: 'application/octet-stream' }),
    opts.fileName,
  );

  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.accessToken) headers.authorization = `Bearer ${cfg.accessToken}`;

  const res = await fetch(`${opts.baseUrl}${opts.path}`, {
    method: 'POST',
    headers,
    body: form,
  });
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
    const e = body as { error?: string; message?: string } | null;
    throw new HttpError(res.status, e?.error ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

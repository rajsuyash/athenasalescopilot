/**
 * Resolve a redirect URL that survives Railway's reverse proxy. Next.js
 * sees the internal `localhost:PORT` as the request host, so naive
 * `new URL(path, req.url)` produces a redirect the browser can't follow.
 * Honor the X-Forwarded-Host + X-Forwarded-Proto headers Railway injects.
 */
export function publicRedirectUrl(path: string, req: Request): URL {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    new URL(req.url).host;
  return new URL(path, `${proto}://${host}`);
}

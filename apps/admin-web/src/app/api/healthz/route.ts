/**
 * Health probe for Railway / load balancers.
 *
 * Returns 200 + `{ ok: true }` once Next.js has finished booting and the
 * route handler is wired. Cheap, no DB hit, no Clerk call — Railway only
 * needs to know "is the HTTP server bound and serving routes yet" so it
 * doesn't kill the container during the 5-15s Next.js cold start.
 *
 * Configured as `healthcheckPath` in apps/admin-web/railway.json.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(): Response {
  return Response.json(
    {
      ok: true,
      service: 'admin-web',
      ts: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}

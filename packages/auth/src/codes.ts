/**
 * The SINGLE definition of which JWT-library error codes mean "expired".
 *
 * @fastify/jwt surfaces `FST_JWT_AUTHORIZATION_TOKEN_EXPIRED` on an expired
 * token. The historical bug was checking only `FAST_JWT_EXPIRED` — that is the
 * lower-level @fast-jwt package's code, which never reaches us through the
 * @fastify/jwt wrapper — so expired tokens were misclassified as invalid and
 * clients couldn't refresh. We keep both: the real one, plus the legacy code as
 * belt-and-suspenders in case the underlying library is ever swapped.
 *
 * This constant must exist in EXACTLY this file. A CI tripwire
 * (scripts/check-no-rogue-auth.sh) fails the build if either literal appears
 * anywhere else, so the classification can never silently diverge again.
 */
export const EXPIRED_JWT_CODES = [
  'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
  'FAST_JWT_EXPIRED',
] as const;

export function isExpiredJwtCode(code: string | undefined): boolean {
  if (!code) return false;
  return (EXPIRED_JWT_CODES as readonly string[]).includes(code);
}

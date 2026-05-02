import type { Role } from '@athena/shared-types';

/** JWT access-token payload. Tenant claim is mandatory per PRD F10. */
export interface AccessTokenClaims {
  sub: string; // user id
  workspaceId: string;
  role: Role;
  membershipId: string;
}

/** JWT refresh-token payload. Minimal — server looks up the row to validate. */
export interface RefreshTokenClaims {
  sub: string;
  workspaceId: string;
  jti: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth plugin for routes that opted into authentication. */
    auth?: AccessTokenClaims;
  }
}

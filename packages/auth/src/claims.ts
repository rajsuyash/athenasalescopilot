import type { Role } from '@athena/shared-types';

/**
 * The one access-token claims shape, shared by every service (previously
 * hand-copied into 8 files). Carries the tenant scope (`workspaceId`, PRD F10)
 * plus identity + role for RBAC.
 */
export interface AccessTokenClaims {
  sub: string;
  workspaceId: string;
  role: Role;
  membershipId: string;
}

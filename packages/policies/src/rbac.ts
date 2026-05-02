import type { Role } from '@athena/shared-types';

/**
 * Permission grammar: `<resource>:<action>`.
 * Add new permissions here; never grant via string literals at the call site.
 */
export type Permission =
  // workspace
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  // users + membership
  | 'membership:invite'
  | 'membership:remove'
  | 'membership:update_role'
  | 'membership:read'
  // teams
  | 'team:create'
  | 'team:update'
  | 'team:delete'
  | 'team:read'
  // knowledge
  | 'knowledge:upload'
  | 'knowledge:delete'
  | 'knowledge:publish'
  | 'knowledge:read'
  // scripts
  | 'script:edit'
  | 'script:publish'
  | 'script:read'
  // meetings
  | 'meeting:start_own'
  | 'meeting:read_own'
  | 'meeting:read_team'
  | 'meeting:read_all'
  | 'meeting:delete'
  // suggestions
  | 'suggestion:feedback_own'
  | 'suggestion:flag'
  // analytics
  | 'analytics:read_self'
  | 'analytics:read_team'
  | 'analytics:read_all'
  // audit + compliance
  | 'audit:read'
  | 'retention:update'
  // integrations
  | 'integration:connect'
  | 'integration:disconnect'
  // billing
  | 'billing:read'
  | 'billing:update';

const REP: ReadonlySet<Permission> = new Set<Permission>([
  'workspace:read',
  'team:read',
  'knowledge:read',
  'script:read',
  'meeting:start_own',
  'meeting:read_own',
  'suggestion:feedback_own',
  'analytics:read_self',
]);

const ANALYST: ReadonlySet<Permission> = new Set<Permission>([
  'workspace:read',
  'team:read',
  'knowledge:read',
  'script:read',
  'meeting:read_all',
  'analytics:read_all',
]);

const COMPLIANCE_VIEWER: ReadonlySet<Permission> = new Set<Permission>([
  'workspace:read',
  'audit:read',
]);

const MANAGER: ReadonlySet<Permission> = new Set<Permission>([
  ...REP,
  'meeting:read_team',
  'analytics:read_team',
  'suggestion:flag',
  'membership:read',
  'team:read',
]);

const ADMIN: ReadonlySet<Permission> = new Set<Permission>([
  ...MANAGER,
  ...ANALYST,
  'workspace:update',
  'membership:invite',
  'membership:remove',
  'membership:update_role',
  'team:create',
  'team:update',
  'team:delete',
  'knowledge:upload',
  'knowledge:delete',
  'knowledge:publish',
  'script:edit',
  'script:publish',
  'meeting:delete',
  'retention:update',
  'integration:connect',
  'integration:disconnect',
]);

const OWNER: ReadonlySet<Permission> = new Set<Permission>([
  ...ADMIN,
  'workspace:delete',
  'billing:read',
  'billing:update',
]);

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  rep: REP,
  analyst: ANALYST,
  compliance_viewer: COMPLIANCE_VIEWER,
  manager: MANAGER,
  admin: ADMIN,
  owner: OWNER,
};

/** Safe lookup: `Role` is a closed union, so the key is always present. */
function lookup(role: Role): ReadonlySet<Permission> {
  const set = ROLE_PERMISSIONS[role];
  if (!set) throw new Error(`unknown role: ${role}`);
  return set;
}

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return lookup(role);
}

/** True iff the role grants the permission. */
export function can(role: Role, permission: Permission): boolean {
  return lookup(role).has(permission);
}

/**
 * Returns the minimum role that satisfies the permission, or `null` if none.
 * Useful for "INSUFFICIENT_ROLE" error messages per PRD F8 AC2.
 */
export function minimumRoleFor(permission: Permission): Role | null {
  const order: Role[] = ['rep', 'analyst', 'compliance_viewer', 'manager', 'admin', 'owner'];
  for (const role of order) {
    if (lookup(role).has(permission)) return role;
  }
  return null;
}

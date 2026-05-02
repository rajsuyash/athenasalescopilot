import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { can, minimumRoleFor, permissionsFor } from './rbac.js';

describe('rbac', () => {
  it('rep can start own meetings but not read team meetings', () => {
    assert.equal(can('rep', 'meeting:start_own'), true);
    assert.equal(can('rep', 'meeting:read_team'), false);
  });

  it('manager inherits rep + reads team', () => {
    assert.equal(can('manager', 'meeting:start_own'), true);
    assert.equal(can('manager', 'meeting:read_team'), true);
    assert.equal(can('manager', 'workspace:update'), false);
  });

  it('admin can publish knowledge but not delete the workspace', () => {
    assert.equal(can('admin', 'knowledge:publish'), true);
    assert.equal(can('admin', 'workspace:delete'), false);
  });

  it('owner is the only role with workspace:delete and billing', () => {
    assert.equal(can('owner', 'workspace:delete'), true);
    assert.equal(can('owner', 'billing:update'), true);
    assert.equal(can('admin', 'billing:update'), false);
  });

  it('compliance_viewer is read-only for audit', () => {
    assert.equal(can('compliance_viewer', 'audit:read'), true);
    assert.equal(can('compliance_viewer', 'knowledge:upload'), false);
  });

  it('analyst sees all meetings + analytics, but cannot mutate', () => {
    assert.equal(can('analyst', 'analytics:read_all'), true);
    assert.equal(can('analyst', 'meeting:read_all'), true);
    assert.equal(can('analyst', 'knowledge:upload'), false);
  });

  it('minimumRoleFor returns the cheapest role', () => {
    assert.equal(minimumRoleFor('meeting:start_own'), 'rep');
    assert.equal(minimumRoleFor('audit:read'), 'compliance_viewer');
    assert.equal(minimumRoleFor('billing:update'), 'owner');
  });

  it('every role has at least one permission', () => {
    const roles = ['rep', 'analyst', 'compliance_viewer', 'manager', 'admin', 'owner'] as const;
    for (const r of roles) {
      assert.ok(permissionsFor(r).size > 0, `role ${r} had no permissions`);
    }
  });
});

# policies

RBAC, retention, redaction, content-restriction policies. Pure functions consumed by services.

## Modules

- `rbac/` — role → permission map; `can(actor, action, resource)` predicate. Roles per PRD F8: owner, admin, manager, rep, analyst, compliance_viewer.
- `retention/` — per-resource retention computation (transcript, audio, summary, audit). Workspace-overridable.
- `redaction/` — PII redaction transforms for exports.
- `content/` — flags such as `restricted_claim`, `requires_canonical_phrasing`. Generator must consult these before emitting.

## Conventions

Policies are pure, deterministic, and unit-tested with workspace fixture matrices.

# api

Core REST API on Fastify (ADR 0001). PRD F8, F10, F11.

## Quickstart

```bash
# from repo root
docker compose -f infra/docker-compose.yml up -d postgres redis minio
pnpm --filter @athena/db prisma:migrate:dev --name init
cp services/api/.env.example services/api/.env  # edit secrets
pnpm --filter @athena/api dev
```

API listens on `http://localhost:4000`.

## Routes (v1)

| Method | Path                    | Auth        | Notes                                    |
| ------ | ----------------------- | ----------- | ---------------------------------------- |
| GET    | /healthz                | —           | liveness                                 |
| GET    | /readyz                 | —           | DB ping                                  |
| POST   | /v1/auth/signup         | —           | creates user + first workspace as owner  |
| POST   | /v1/auth/login          | —           | returns access + opaque refresh tokens   |
| POST   | /v1/auth/refresh        | —           | rotates refresh token                    |
| POST   | /v1/auth/logout         | —           | revokes refresh token                    |
| GET    | /v1/auth/me             | required    | returns user + active workspace          |
| GET    | /v1/workspaces/me       | required    | returns active workspace                 |
| PATCH  | /v1/workspaces/me       | `workspace:update` | updates workspace name             |
| GET    | /v1/memberships         | `membership:read`  | lists workspace members            |
| POST   | /v1/memberships/invites | `membership:invite` | creates invite + returns token    |
| PATCH  | /v1/memberships/:id     | `membership:update_role` | changes role; protects last owner |
| DELETE | /v1/memberships/:id     | `membership:remove` | soft-removes + revokes refresh tokens |

## Responsibilities

- Auth (email + password, Google OAuth). JWT issuance + refresh.
- Workspace, team, user, membership CRUD.
- RBAC middleware (every request).
- Audit log writes.
- Resource endpoints for meetings, suggestions, knowledge metadata, scripts.

## Tenant isolation

Every domain query filters on `workspace_id` from the verified JWT claim. Resources owned by another workspace return 404.

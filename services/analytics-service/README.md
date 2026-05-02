# analytics-service

Workspace-scoped aggregations for the admin dashboard. PRD F12.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp services/analytics-service/.env.example services/analytics-service/.env
pnpm --filter @athena/analytics-service dev    # :4060
```

## Endpoints

| Method | Path                            | Auth     | Notes                                          |
| ------ | ------------------------------- | -------- | ---------------------------------------------- |
| GET    | /healthz                        | —        | liveness                                       |
| GET    | /v1/analytics/adoption          | required | counts + 30-day daily meeting buckets         |
| GET    | /v1/analytics/objections        | required | top 10 objection categories last 30 days      |
| GET    | /v1/analytics/quality           | required | useful-rate by suggestion_type and source doc |
| GET    | /v1/analytics/coverage          | required | confidence distribution + knowledge gaps      |

All endpoints are **read-only** and **workspace-scoped via JWT** (PRD F10).

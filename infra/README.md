# infra

## Local dev stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

Services:

| Name      | Port | Notes                                    |
| --------- | ---- | ---------------------------------------- |
| postgres  | 5432 | pgvector/pgvector:pg16 — pgvector preinstalled |
| redis     | 6379 | appendonly enabled                       |
| minio     | 9000 | S3 API; console on 9001 (minio/minio12345) |

`postgres/init/` runs once on first volume init: enables `vector`, `pgcrypto`, `pg_trgm`.

## Production

See `terraform/` (TBD per ADR).

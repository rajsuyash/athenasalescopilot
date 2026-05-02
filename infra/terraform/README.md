# terraform

Infrastructure as code. AWS or GCP — pick per ADR before any resource is created.

## Layout (planned)

```
terraform/
  envs/
    dev/
    staging/
    prod/
  modules/
    network/
    postgres/
    redis/
    s3/
    secrets/
    observability/
```

## Rules

- No state in repo. Remote state in S3 (or GCS) with locking.
- `terraform apply` requires explicit approval (denied for Claude in `.claude/settings.json`).
- Per-tenant resources scoped via prefix or tag, not separate accounts (v1).

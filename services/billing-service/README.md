# billing-service

Stripe billing — subscription state, seat enforcement, usage metering. PRD F16.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp services/billing-service/.env.example services/billing-service/.env
pnpm --filter @athena/billing-service dev    # :4070
```

Without `STRIPE_SECRET_KEY` the service runs in **mock mode**: Checkout +
Portal sessions return stub URLs and a `POST /v1/billing/mock/upgrade`
endpoint flips the workspace plan tier so the rest of the system is
exercisable end-to-end.

## Endpoints

| Method | Path                          | Auth                | Notes                                   |
| ------ | ----------------------------- | ------------------- | --------------------------------------- |
| GET    | /healthz                      | —                   | reports stripe enabled state            |
| GET    | /v1/billing/subscription      | required            | current plan + seats + period           |
| GET    | /v1/billing/usage             | required            | seats / MAR / meeting hours / chunks    |
| POST   | /v1/billing/checkout          | `billing:update`    | Stripe Checkout session URL             |
| POST   | /v1/billing/portal            | `billing:update`    | Stripe Customer Portal URL              |
| POST   | /v1/billing/webhook           | Stripe sig          | subscription state changes              |
| POST   | /v1/billing/mock/upgrade      | `billing:update`    | dev-only; flips plan tier without Stripe |

## Plan defaults

| Tier       | Seats | Meeting hours / month |
| ---------- | ----- | --------------------- |
| free       | 3     | 5                     |
| pro        | 25    | 250                   |
| enterprise | 200   | unlimited             |

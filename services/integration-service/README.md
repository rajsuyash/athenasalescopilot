# integration-service

CRM sync. PRD F14. Targets v1: Salesforce, HubSpot.

## Responsibilities

- OAuth connection per workspace; encrypted refresh token storage.
- Match contacts/accounts to CRM records by email domain.
- Push post-call CRM-field suggestions as drafts (rep approves before commit).
- Pull deal context (stage, amount, close date) for in-call use.
- Backoff + alert on rate limits or auth failures.

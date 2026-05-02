---
description: Begin work on a PRD feature. Reads PRD, restates AC, drafts plan, waits for confirm.
argument-hint: <feature-id, e.g. F5>
---

You are starting work on PRD feature **$1**.

Do this in order:

1. Read `docs/PRD.md` and locate the section for **$1**. If $1 is not a valid feature ID (F1–F16), stop and ask the user which feature they meant.
2. Restate the feature in plain language: user story, P0/P1, primary acceptance criteria, key error cases.
3. Identify dependencies on other features (per PRD "Dependencies" line) and confirm they exist or are stubbed.
4. List touched directories per the build order in PRD Appendix B.
5. Draft a phased plan: each phase touches ≤5 files and includes a verification step (typecheck + lint + tests).
6. Call out the **tenant isolation** considerations explicitly (which tables, cache keys, S3 paths).
7. Call out the **latency budget** if this touches a hot-path service (PRD §7).
8. Stop. Ask the user to CONFIRM before any file edits.

Do not write code, do not modify files, do not spawn implementation agents until the user confirms the plan.

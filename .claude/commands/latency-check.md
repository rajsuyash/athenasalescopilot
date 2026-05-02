---
description: Audit hot-path changes against PRD §7 latency budgets.
---

Spawn the `realtime-latency-auditor` agent.

Steps:

1. Run `git diff main...HEAD --name-only` and check for any file under:
   - `services/realtime-gateway/`
   - `services/transcript-service/`
   - `services/orchestrator-service/`
   - `apps/desktop-macos/` (overlay rendering paths only)
2. If none touched, report "no hot-path changes" and stop.
3. Otherwise pass the diff + the budget table to the auditor.
4. Print the verdict: `WITHIN-BUDGET` / `AT-RISK` / `OVER-BUDGET`.

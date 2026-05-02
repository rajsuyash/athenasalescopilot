---
description: Run the tenant-isolation review on the current diff vs main.
---

Spawn the `tenant-isolation-reviewer` agent against the current branch's diff.

Steps:

1. Run `git diff main...HEAD --stat` to scope the change.
2. If the diff touches any file under `services/`, `packages/sdk/`, `apps/admin-web/`, or `infra/terraform/` — proceed.
3. Otherwise report "no tenant-sensitive paths touched" and stop.
4. Spawn the agent with the diff and a request for `BLOCKER`/`HIGH` issues only.
5. Print the verdict line clearly: `PASS` or `BLOCK`.

Do not auto-fix issues. The reviewer reports; humans decide.

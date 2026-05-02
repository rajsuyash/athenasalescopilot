---
description: Verify the current branch's diff traces to PRD feature IDs and acceptance criteria.
---

Spawn the `prd-traceability` agent against the current branch.

Steps:

1. Run `git diff main...HEAD` and capture the file list + summary.
2. Run `git log main..HEAD --oneline` for commit messages.
3. Pass the diff, commit log, and `docs/PRD.md` to the agent.
4. Print the agent's verdict line clearly: `TRACEABLE` / `DRIFT` / `MISSING-AC`.
5. If `DRIFT` or `MISSING-AC`, list the recommended next action (PRD edit or scope removal).

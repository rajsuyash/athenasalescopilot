# .claude

Project agent + tooling config for Claude Code. Loaded automatically when running Claude Code from the repo root.

## Files

| Path                                       | Purpose                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `../CLAUDE.md`                             | Project guidance, hard rules, stack invariants, working agreements.  |
| `settings.json`                            | Permissions, denied commands, env, model.                            |
| `agents/tenant-isolation-reviewer.md`      | Sev-0 reviewer for cross-tenant leaks.                               |
| `agents/realtime-latency-auditor.md`       | Hot-path latency audits against PRD §7 budgets.                      |
| `agents/macos-overlay-reviewer.md`         | Swift / SwiftUI / overlay-specific review.                           |
| `agents/prd-traceability.md`               | Maps diff back to PRD feature IDs and AC.                            |
| `commands/start-feature.md`                | `/start-feature F5` — brief, plan, wait for confirm.                 |
| `commands/tenant-check.md`                 | `/tenant-check` — tenant isolation review on current diff.           |
| `commands/latency-check.md`                | `/latency-check` — hot-path latency audit on current diff.           |
| `commands/prd-trace.md`                    | `/prd-trace` — PRD traceability report on current branch.            |
| `commands/new-adr.md`                      | `/new-adr <title>` — scaffold a new ADR.                             |
| `hooks/`                                   | Reserved for PreToolUse / PostToolUse / Stop hooks. Empty for now.   |

## Conventions

- New agents: one file under `agents/`, frontmatter with `name`, `description`, `tools`, `model`. Description triggers automatic invocation.
- New slash commands: one file under `commands/`, frontmatter with `description` and optional `argument-hint`.
- Permissions changes go in `settings.json`. Local-only overrides go in `.claude/settings.local.json` (gitignored).

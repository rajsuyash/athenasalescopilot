# prompts

Versioned prompt templates for Stages A (intent), C (grounded answer), D (post-call).

## Conventions

- One folder per stage: `stage-a-intent/`, `stage-c-answer/`, `stage-d-postcall/`.
- Each prompt is a `.md` file with YAML frontmatter: `id`, `version`, `model`, `inputs`, `outputs`, `eval_set`.
- Prompt diffs are reviewed and shipped via `policy_version` bumps consumed by the orchestrator.
- Never inline prompts in service code — load from this package.

## Eval

Each prompt has a paired `eval_set` (golden inputs + expected outputs) used in CI before a `policy_version` is published.

---
description: Create a new Architecture Decision Record under docs/decisions/.
argument-hint: <short-title-kebab-case>
---

Create a new ADR file at `docs/decisions/NNNN-$1.md` where `NNNN` is the next zero-padded number.

Template:

```markdown
# NNNN. <Title>

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: <names>
- PRD refs: <feature IDs, e.g. F5, F10>

## Context

What problem are we solving? What forces are at play?

## Decision

What we will do. Imperative voice.

## Consequences

Positive, negative, and neutral effects. What becomes easier? What becomes harder?

## Alternatives considered

- Option A: pros / cons / why rejected
- Option B: pros / cons / why rejected

## References

- PRD section / external links
```

Steps:
1. List existing ADRs to determine the next NNNN.
2. Today's date is your `Date` field.
3. Write the file. Do not fill in body — leave skeleton for the human.
4. Print the path to the new file.

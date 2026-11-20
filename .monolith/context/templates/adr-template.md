---
type: template
id: adr-template
category: templates
---

# ADR Template

Canonical shape of an Architecture Decision Record. Copy the block below into
`docs/adr/ADR-NNN-<slug>.md` (the only ADR location; `monolith.config.json`
`contextGateway.adrDirs`). The template itself is not an ADR and is never read
as one.

Rules the Mission Control read model and `monolith governance check` apply:

- The file starts with a YAML frontmatter block (`---` ... `---`) on line 1. A
  status written only in the Markdown body is **not** read as the ADR's status.
- `id` is required and must equal the id in the file name (`ADR-007-...md` →
  `id: ADR-007`). `status` should be one of `proposed | accepted | superseded |
  deprecated`.
- `supersedes` / `superseded_by` are optional, take ADR ids, and are shown as
  declared (never inferred).
- Add a row to the ADR Index in `docs/adr/README.md` if the project keeps one.

```markdown
---
type: adr
id: ADR-NNN
title: Short decision title
status: proposed
date: YYYY-MM-DD
---

# ADR-NNN — Short decision title

## Context

What forces led to this decision?

## Decision

What was decided, in one or two paragraphs.

## Consequences

What becomes easier, what becomes harder, what is deferred.
```

Optional frontmatter lines, added only when they apply (values must be real ADR ids
such as `ADR-012`, never placeholders):

```yaml
supersedes: ADR-012
superseded_by: ADR-020
```

---
type: schema
id: governance-rule-schema
authority: authoritative
---

# Governance Rule Schema

Format for governance rules in `governance/GOV-*.md`.

## File Naming

`GOV-YYYY-XXXX.md` where YYYY = year, XXXX = sequential ID.

## Fields

```yaml
---
id: GOV-YYYY-XXXX
date: YYYY-MM-DD
trigger: pattern that activates this rule
severity: critical | high | medium | low
status: active | superseded | archived
origin_story: STORY X.Y (optional — which story created this rule)
---
```

## Body

```markdown
## Rule

One-sentence statement of the rule. Must be actionable and unambiguous.

## Context

Why this rule exists. What failure pattern it prevents.

## Pattern

The trigger condition: what behavior or situation activates this rule.

## Action

What to do when the pattern is detected.

## Examples

Concrete examples of the rule in action.
```

## When to Create a Rule

Create `GOV-*.md` when:

- A mistake occurs more than once with the same root cause
- A boundary violation is detected in governance evaluation
- A new constraint is established through discussion

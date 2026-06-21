---
type: protocol
id: protocol-dry-run
category: cognition
scope: system
enforcement: conditional
---

# Cognitive Dry-Run Protocol

When to activate dry-run mode and how to execute it.

---

## Activation

Activate dry-run when:

- Task involves irreversible operations (delete, deploy, drop database)
- Task scope is unclear
- Task may affect shared/production systems
- User explicitly requests dry-run

---

## Severity Levels

| Level      | Description                          | Action                    |
| ---------- | ------------------------------------ | ------------------------- |
| `safe`     | Read-only or easily reversible       | Proceed                   |
| `caution`  | Reversible but significant           | Confirm with user         |
| `warning`  | Hard to reverse                      | Show dry-run output first |
| `critical` | Irreversible or production-affecting | Require explicit approval |

---

## Dry-Run Format

```
DRY RUN — What would happen:

1. [ACTION] file.ts — description of change
2. [CREATE] new-file.ts — what would be created
3. [DELETE] old-file.ts — what would be deleted

Severity: warning
Proceed? (yes / no)
```

---

## Rules

- Never execute critical operations without dry-run first
- Never skip dry-run because "it's obvious"
- Dry-run output must list ALL side effects

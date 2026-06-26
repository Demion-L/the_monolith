---
type: reference
id: error-taxonomy
category: errors
authority: authoritative
---

# Error Taxonomy

8 canonical error categories for MONOLITH projects.

| Category          | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `architecture`    | Structural violations, wrong layer boundaries, coupling issues |
| `dependencies`    | Missing packages, version conflicts, import errors             |
| `nonexistent-api` | Calling functions/methods/endpoints that don't exist           |
| `context-sync`    | Memory state out of sync with actual project state             |
| `workflow`        | Protocol violations, skipped steps, wrong execution order      |
| `typescript`      | Type errors, inference failures, incorrect generics            |
| `documentation`   | Missing, stale, or incorrect documentation                     |
| `other`           | Errors that don't fit the above categories                     |

## Usage

- Reference when creating `ERR-*.md` records
- The `category` field must match one of the above exactly
- Lessons in `learning/mistakes/` are organized by these categories

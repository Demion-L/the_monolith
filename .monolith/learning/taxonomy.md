---
type: reference
id: learning-taxonomy
authority: authoritative
---

# Learning Taxonomy

7 canonical categories for organizing lessons and mistakes.

---

| Category          | Lessons About                                                                       |
| ----------------- | ----------------------------------------------------------------------------------- |
| `architecture`    | Structural violations, layer boundary breaches, coupling issues, wrong abstractions |
| `dependencies`    | Missing packages, version conflicts, circular imports, import resolution errors     |
| `nonexistent-api` | Calling functions, methods, endpoints, or properties that do not exist              |
| `context-sync`    | Memory state out of sync with actual project state, stale assumptions               |
| `workflow`        | Protocol violations, skipped steps, wrong execution order, gate bypass              |
| `typescript`      | Type errors, incorrect generics, wrong inference, `any` misuse                      |
| `documentation`   | Missing docs, stale descriptions, incorrect examples, wrong paths                   |

---

## Usage

- When creating a lesson with the self-improvement skill, map the mistake to exactly one category
- When searching for lessons, start with the most specific category
- Use `context-sync` for "I assumed X but it was actually Y" mistakes
- Use `nonexistent-api` for "I called X which doesn't exist" mistakes

---
type: protocol
id: protocol-metadata-schema
category: governance
scope: system
enforcement: mandatory
---

# Metadata Schema

YAML frontmatter schema for all MONOLITH artifacts.

---

## Required Fields

```yaml
---
type: memory | context | protocol | skill | schema | reference | template
id: unique-kebab-case-id
---
```

---

## Optional Fields

```yaml
---
category: working | long-term | errors | execution | boot | governance | cognition
stability: volatile | stable | permanent
authority: authoritative | derived | reference
topology_role: root | node | leaf
enforcement: mandatory | conditional | optional
scope: system | project | story
applies_to:
  - task-type-or-all
related_protocols:
  - protocol-id
referenced_by:
  - artifact-id
append_only: true | false
---
```

---

## topology_role Values

| Value  | Meaning                                      |
| ------ | -------------------------------------------- |
| `root` | Entry point; must exist; read at boot        |
| `node` | Internal; referenced by roots or other nodes |
| `leaf` | Terminal; not referenced by others           |

---

## Rules

- Every artifact must have `type` and `id`
- `id` must be unique across the instance
- `topology_role: root` artifacts are verified by the topology validator

---
type: protocol
id: protocol-memory-governance
category: governance
scope: system
enforcement: mandatory
applies_to:
  - memory
  - stories
  - skills
topology_role: node
---

# Memory Governance

Rules for creating, updating, migrating, and deprecating memory.

---

## Core Rules

### 1. Avoid Monolithic Context Files

Do not expand a single large file indefinitely. Prefer:

- phase memory (per-phase capsules)
- story capsules (per-story records)
- indexed references (pointers, not content duplication)
- modular memory (separate files per domain)

### 2. Separate Stable vs Volatile Memory

| Type                 | Location             | Update Frequency        |
| -------------------- | -------------------- | ----------------------- |
| Volatile (per-story) | `memory/working/`    | Every story             |
| Stable (cross-story) | `memory/long-term/`  | On significant decision |
| Error records        | `memory/errors/`     | On failure              |
| Lessons              | `learning/mistakes/` | On self-improvement     |

### 3. Single Source of Truth

Each fact has exactly one authoritative location. Reference, don't duplicate.

### 4. Append-Only History

`memory/long-term/execution-history.md` is append-only. Never edit past entries.

### 5. Story Context Required

All `memory/working/` updates must reference the active story ID.

### 6. Integrity Before Report

`memory/working/integrity-result.md` must be updated before finalizing a story.

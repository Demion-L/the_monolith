---
type: context
id: agents-root
topology_role: root
authority: authoritative
---

# {{PROJECT_NAME}} — AI Assistant Guide

This is the primary entry point for AI assistants working in this project.

Read this file first on every session start.

---

## Project

**Name:** {{PROJECT_NAME}}  
**Language:** {{LANGUAGE}}  
**AI Tool:** {{AI_TOOL}}  
**MONOLITH Root:** `{{MONOLITH_ROOT}}/`

<!-- Add project description here -->

---

## Boot Sequence

On every session start, read in this order:

1. This file (AGENTS.md)
2. `{{MONOLITH_ROOT}}/context/maps/project-map.md`
3. `{{MONOLITH_ROOT}}/context/maps/routing-map.md` — classify task type
4. `{{MONOLITH_ROOT}}/memory/working/active.md` — current phase and story
5. `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md`
6. `{{MONOLITH_ROOT}}/protocols/governance/memory-governance.md`
7. Relevant skill from `{{MONOLITH_ROOT}}/skills/` (resolved via routing-map)
8. `{{MONOLITH_ROOT}}/learning/injection-map.md` — load relevant lessons
9. `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md` — apply behavioral constraints

See full sequence: `{{MONOLITH_ROOT}}/protocols/boot/boot-sequence.md`

---

## Navigation

| What              | Where                                               |
| ----------------- | --------------------------------------------------- |
| Active story      | `{{MONOLITH_ROOT}}/memory/working/active.md`        |
| Project map       | `{{MONOLITH_ROOT}}/context/maps/project-map.md`     |
| Routing decisions | `{{MONOLITH_ROOT}}/context/maps/routing-map.md`     |
| Skills            | `{{MONOLITH_ROOT}}/skills/INDEX.md`                 |
| Protocols         | `{{MONOLITH_ROOT}}/protocols/boot/boot-sequence.md` |
| Roadmap           | `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md`   |
| Lessons           | `{{MONOLITH_ROOT}}/learning/INDEX.md`               |
| Governance rules  | `{{MONOLITH_ROOT}}/governance/`                     |

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `{{MONOLITH_ROOT}}/protocols/governance/core-invariants.md` before starting any task.

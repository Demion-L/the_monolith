---
type: skill
id: skill-global-status
trigger: global-overview
---

# Skill: Global Status

High-level project overview: vision, architecture, stack, phase progress.

---

## Activation

Triggered by: "global overview", "project status", "big picture", "explain the project", "глобальный статус"

---

## Steps

1. Read `memory/working/active.md`
2. Read `context/maps/roadmap-index.md`
3. Read `memory/long-term/decisions.md`
4. Read `README.md` (project description and stack)
5. Read `MANIFESTO.md` (engineering principles)
6. Report using the output format below

---

## Output Format

```
## MONOLITH — Global Overview

**Project:** Brief description of what this project does.

**Stack:** Language, framework, key packages.

**Architecture:** Core subsystems and their roles.
- Scriptorium — ...
- Explicit Relationship Graph — ...
- Terra — ...
- (etc.)

**Knowledge base:** docs/ layer hierarchy
- docs/research/ — external analysis
- docs/adr/ — architecture decisions
- docs/architecture/ — current system description
- docs/vision/ — long-term direction

**Progress:**
- Phase 1 — Name: IN PROGRESS (N/M stories complete)
  - STORY 1.1 — name: COMPLETED
  - STORY 1.3 — name: COMPLETED
  - STORY 1.N — name: ACTIVE / PLANNED

**Key Decisions:**
- ADR-XXX — one-line summary

**Current Focus:**
Active story objective, or "No active story — next: <candidate>".
```

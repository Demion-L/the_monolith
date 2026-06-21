---
type: skill
id: skill-global-status
trigger: global-overview
---

# Skill: Global Status

High-level project overview: vision, architecture, stack, phase progress.

---

## Activation

Triggered by: "global overview", "project status", "big picture", "explain the project"

---

## Steps

1. Read `memory/working/active.md`
2. Read `context/maps/roadmap-index.md`
3. Read `memory/long-term/decisions.md`
4. Read `memory/long-term/architecture-principles.md`
5. Report:
   - Project description (from AGENTS.md)
   - Tech stack
   - Architecture principles
   - Phase progress summary
   - Key decisions made so far
   - Current focus

---

## Output Format

```
## {{PROJECT_NAME}} — Global Overview

**Project:** Brief description of what this project does.

**Stack:** Language, framework, key packages.

**Architecture:** Core architectural principles and patterns.

**Progress:**
- Phase 1 — Name: COMPLETE (N stories)
- Phase 2 — Name: IN PROGRESS (N/M stories)
- Phase 3 — Name: PLANNED

**Key Decisions:**
- Decision summary (link to decisions.md)

**Current Focus:**
Active story objective and what's being built now.
```

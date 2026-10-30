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

## Mission Lifecycle (Coordinatorium v0.1)

```
monolith mission start --title "..." --system "..."
monolith mission list
monolith mission show <id>
monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
monolith mission checkpoints <missionId>
```

This records development missions in `{{MONOLITH_ROOT}}/state.json`,
independent of any single AI session's memory. **This is not
runtime-enforced in v0.1:** nothing prevents an AI session from editing
code without ever calling `mission start`/`finish`. It is a recommended
discipline, not a gate.

---

## Project Brief

```
monolith brief [--max-chars N] [--strict]
```

Prints a deterministic, read-only, bounded summary of current project
state (State Keeper status, active missions and latest checkpoints,
mandatory protocols, current story, accepted ADRs), with the source of
each section. It supplements the Boot Sequence; it does not replace it.
The first line is `Completeness: COMPLETE` or `INCOMPLETE`; exit code 2
under `--strict` means INCOMPLETE. ADR directories are
listed in `monolith.config.json` under `contextGateway.adrDirs`; a new instance
sets `["docs/adr"]`, the only ADR location.

**Mission Checkpoints (COORDINATORIUM-002):** an `in_progress` mission can
accumulate durable, append-only checkpoints (`summary` required,
`remainingSteps` via repeated `--remaining`, optional `context`) —
immutable once created, no update/delete command. Rejected for a
completed/failed/cancelled mission; `mission checkpoints` keeps listing a
finished mission's history regardless.

---

## Idea Capture

```
monolith idea add --title "..." --description "..." [--context "..."]
monolith idea list
monolith idea show <id>
```

When a thought comes up that does not belong to the current task, save it with
`monolith idea add` and keep working. Ideas are Markdown files in
`{{MONOLITH_ROOT}}/memory/long-term/ideas/` (status `inbox`, `planned` or `archived`). They
change neither the active story nor any mission, and need never become a task.
An AI assistant saves an idea only when the user explicitly asks, and only through
`monolith idea add` (intent `CAPTURE_IDEA`, routing-map Table 8): it never chooses a
path and never writes or edits idea files directly.

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `{{MONOLITH_ROOT}}/protocols/governance/core-invariants.md` before starting any task.

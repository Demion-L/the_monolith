---
type: protocol
id: protocol-document-formats
category: governance
scope: system
enforcement: conditional
applies_to:
  - documentation-update
  - finalize-story
---

# Governance Document Formats

MONOLITH reads a few governance documents **structurally**. An agent that
rewrites these documents "in its own words" makes them unreadable to the
toolkit. This protocol lists the formats the toolkit actually parses. Do not
invent new statuses, headings or fields, and do not delete the format comments
in the templates.

Check your work at any time with `monolith governance check` (read-only; it
reports problems and changes nothing).

---

## Roadmap — `context/maps/roadmap-index.md`

```markdown
## Phases

### Phase 6 — Handover        <- `### Phase <id> — <title>`

**Status:** IN PROGRESS        <- one of the Phase statuses below
**Goal:** One line (optional)

## Current Focus

Active Phase: 6 — Handover     <- `<id> — <title>` or `—`
Active Story: —
```

- **Phase id** — the token right after `Phase`: letters, digits, `.`, `_`, `+`, `-`
  (`1`, `2b`, `2+`, `A.1`). It contains no spaces.
- **Phase statuses** (exactly these): `PLANNED`, `IN PROGRESS`, `COMPLETE` (or
  `COMPLETED`), `NOT DEFINED`. `READY FOR REVIEW`, `DONE`, `BLOCKED` and similar
  words are **not** Phase statuses. In particular `READY FOR REVIEW` belongs to
  the Story workflow, never to a Phase.
- **Active Phase** is read only inside `## Current Focus`, on one line, written
  `Active Phase: <id> — <title>` or `Active Phase: —` for none. The id is the bare
  token: `Active Phase: 6 — Handover`, **not** `Active Phase: Phase 6 — Handover`
  (the word `Phase` makes the pointer match no phase).
- **Active Story** in `Current Focus` is a pointer, not a status.
- A Story is linked to a Phase only by its position in `story-index.md`
  (see below), never by a line in the Roadmap.

## Story index — `memory/working/story-index.md`

```markdown
# Stories

## Phase 6 — Handover

### STORY 6.1 — Story title

**Date:** 2026-01-31
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-6/stories/story-6-1.md`
```

- The index lists **finalized** stories only. A project with no finalized story
  has an empty index; that is a valid state, not an error.
- `monolith finalize apply` writes these entries. Do not add them by hand.
- The `## Phase <id>` token must equal a Roadmap phase id exactly.

## Current Story — `memory/working/active.md`

One field line at the start of a line inside `## Current Story`:

```markdown
## Current Story

**Story:** 6.1 — Story title
```

or `No active story.` The first word after `**Story:**` is the story id. See
the finalize-story skill for details.

## Story capsule — `memory/working/phases/<phase>/stories/<slug>.md`

Created by `monolith finalize apply`, never by hand. Frontmatter fields are
`type: story-capsule`, `id`, `phase`, `title`, `date`, `status`; the body has an
H1 and these sections in order: `Objective`, `Implementation Summary`,
`Files Changed`, `Tests`, `Key Decisions`, `ADRs Written`, `Lessons Learned`.
Keep the meaning of each section:

| Section | What belongs there | What does not |
|---|---|---|
| Objective | What the story was meant to deliver | Plans, task lists |
| Implementation Summary | What was built | Verification results |
| Files Changed | List of files | Prose |
| Tests | Test counts, verification commands and their results (the evidence) | Acceptance wishes |
| Key Decisions | Choices made and why | Dependencies on other stories |
| ADRs Written | ADR ids or `None` | Decisions without an ADR |
| Lessons Learned | Carry-forward notes | Status words |

Capsule fields never carry a literal `\n` instead of a line break, and no
section keeps placeholder text such as `TODO`, `TBD` or `(Add ...)`.
`READY FOR REVIEW`, dependencies and acceptance criteria are working notes of a
story in progress; they are not capsule fields.

## ADR — `docs/adr/ADR-NNN-<slug>.md`

Must start with YAML frontmatter containing `id` and `status`. Template:
`context/templates/adr-template.md`. An ADR without frontmatter is reported by
the dashboard and by `monolith governance check`; the Markdown body is never
accepted as the status.

## Operational state

Missions and checkpoints live in **one** `state.json`. By default it is shared
by all Git worktrees and is stored in the Git common directory
(`<git-common-dir>/monolith/state.json`); only a project outside Git, or one that
chose isolated mode, keeps `<monolithRoot>/state.json`. Do not assume a path:
`monolith mission list` and `monolith brief` always read the right one, and
`monolith brief` reports where it is. Never edit it by hand.

---
type: skill
id: skill-finalize-story
trigger: finalize-story
enforcement: mandatory
protocols:
  - memory-governance
  - skills-governance
---

# Skill: Finalize Story

Workflow for closing a completed story and updating all memory artifacts.

---

## Activation

Triggered by: "finalize story", "finalize X.Y", "complete story", "mark story done", "финализируй"

---

## Pre-conditions

- Story implementation is complete
- User has confirmed the story is done (or the request itself implies it)
- No active blockers

Note: `active.md` may or may not have a registered story entry — proceed either way.

---

## Steps

### Step 1 — Verify build

Run both checks. Both must pass before continuing.

```
pnpm typecheck
pnpm test
```

Report: N tests passing, typecheck clean (or list failures if any).
Write summary to `memory/working/integrity-result.md`.

---

### Step 2 — Write story capsule

Create file: `memory/working/phases/<phase-id>/stories/<story-id>-<story-slug>.md`

Capsule must include:

```markdown
---
type: story-capsule
id: story-X.Y
phase: phase-N
title: <story title>
date: YYYY-MM-DD
status: COMPLETED
---

# STORY X.Y — <story title>

## Objective
<what this story was meant to deliver>

## Implementation Summary
<what was actually built, sub-story by sub-story if applicable>

## Files Changed
<list of new/modified files>

## Tests
<test counts, coverage notes>

## Key Decisions
<architectural choices made during this story>

## ADRs Written
<links to docs/adr/ entries created during this story, or "None">

## Lessons Learned
<what worked, what was surprising, what to carry forward>
```

---

### Step 2.5 — Extract and evaluate lessons (self-improvement sub-step)

Read the "Lessons Learned" section of the capsule just written.

For each item, apply the self-improvement write criteria (see `.monolith/skills/self-improvement/SKILL.md`).

Output a decision table — then write LESSON-*.md files only for WRITE verdicts.

This step is mandatory. If there are no lessons in the capsule, output: "No lesson candidates — skipping."

---

### Step 3 — Update active.md

Update `memory/working/active.md`:

- Set "Current Story" → "No active story."
- Set "Previous" → completed story name + date
- Update "Last Finalization" block

---

### Step 4 — Update story-index.md

Append story entry to `memory/working/story-index.md` under the correct phase heading.

Format:
```markdown
### STORY X.Y — <story title>

**Date:** YYYY-MM-DD
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/<phase>/stories/<capsule-file>.md`

**Summary:** One paragraph covering what was built and why it mattered.

**Key outputs:** <comma-separated list of notable files, ADRs, reports>
```

---

### Step 5 — Update long-term memory

**Always:** Append entry to `memory/long-term/execution-history.md` (append-only — never edit past entries):

```markdown
## STORY X.Y — <title> (YYYY-MM-DD)

**Phase:** N — <phase name>
**Decision:** <one-sentence summary of the architectural decision or outcome>
**Build:** PASS — N tests, typecheck clean.
**Capsule:** `.monolith/memory/working/phases/<phase>/stories/<capsule-file>.md`
```

**If story introduced an ADR:** Add pointer to `memory/long-term/decisions.md`:

```markdown
### ADR-XXX — <title>

**Date:** YYYY-MM-DD
**Status:** Accepted
**Full record:** `docs/adr/ADR-XXX-<slug>.md`

**Decision:** <one-sentence summary>
```

---

### Step 6 — Update HANDOFF.md

Rewrite `context/boot/HANDOFF.md` with current state:

- Active Story: None (+ what was just finalized)
- Completed This Session: bullet list of what was done
- Constraints: any active constraints the next session should know
- Next Step: next story if known, or "ask the user"

---

### Step 7 — Git commit

Stage all modified memory files and commit:

```
git add .monolith/memory/ .monolith/context/boot/HANDOFF.md
git commit -m "chore(story-X.Y): finalize — <story title>"
```

Do NOT push automatically. Ask the user if they want to push.

---

## Post-conditions

- [ ] Build verified: typecheck + tests pass
- [ ] Story capsule written
- [ ] `active.md` updated
- [ ] `story-index.md` updated
- [ ] `execution-history.md` appended
- [ ] `decisions.md` updated (if ADR was written)
- [ ] `HANDOFF.md` current
- [ ] Commit created

---
type: skill
id: skill-finalize-story
trigger: finalize-story
enforcement: mandatory
protocols:
  - memory-governance
  - integrity-verification
---

# Skill: Finalize Story

Workflow for completing a story and updating all memory artifacts.

---

## Activation

Triggered by: "finalize story", "complete story", "mark story done"

---

## Pre-conditions

- [ ] Active story exists in `memory/working/active.md`
- [ ] All story tasks are complete
- [ ] No blocking issues open

---

## Steps

### Step 1 — Verify integrity

Run integrity verification. All checks must pass before proceeding.

Expected output: `memory/working/integrity-result.md` updated with PASS.

### Step 2 — Run governance evaluation

Verify no governance rules are violated.

Expected output: `memory/working/governance-result.md` updated with PASS.

### Step 3 — Write story capsule

Create `memory/working/phases/<phase-id>/stories/<story-id>.md` with:

- Objective
- Implementation summary
- Files changed
- Key decisions
- Lessons learned

### Step 4 — Update working memory

Update `memory/working/active.md`:

- Mark current story as COMPLETED
- Clear "Current Story" section

### Step 5 — Update story index

Add story entry to `memory/working/story-index.md`.

### Step 6 — Update long-term memory

- Append entry to `memory/long-term/execution-history.md`
- Update `memory/long-term/decisions.md` if story introduced new decisions

### Step 7 — Update HANDOFF.md

Write session handoff with story completion status.

---

## Post-conditions

- [ ] Integrity result: PASS
- [ ] Governance result: PASS
- [ ] Story capsule written
- [ ] active.md updated
- [ ] story-index.md updated
- [ ] execution-history.md appended
- [ ] HANDOFF.md current

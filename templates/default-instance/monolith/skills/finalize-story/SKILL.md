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

- [ ] Active story exists in `memory/working/active.md`, identified by exactly one `**Story:** <id>` line in `## Current Story`
- [ ] All story tasks are complete
- [ ] No blocking issues open

---

## Deterministic Execution (`monolith finalize`)

Where the CLI provides `monolith finalize`, use it instead of editing the memory
files by hand (Steps 2-6 below describe what it writes; Step 1 and 5.5 stay yours).

0. **Structural story identity (required before `plan`).** `monolith finalize` knows
   which story is active only from one field line in the `## Current Story` section of
   `memory/working/active.md`, at the very start of the line (no indent, list marker or quote):

   ```markdown
   ## Current Story

   **Story:** S-1 — Example story
   ```

   The first word after `**Story:**` is the story id and must equal `proposal.story.id`
   exactly (case-sensitive; letters, digits, `.` `_` `-`, starting with a letter or digit).
   Text after the id is free. Never infer the id from a heading, a description, "Working on X",
   a `Previous:` line, a code fence or a comment: those carry no identity, and zero, duplicate
   or conflicting `**Story:**` lines make `plan` report `NOT_READY` (`expected-state` FAIL) and
   `apply` `REFUSED`. Keep the field above any `---` line or heading in that section.
   If `active.md` predates this field (e.g. `Working on STORY-123`), do not guess and do not
   rewrite it silently: tell the owner the one line that is missing, add it only with their
   consent, then run `plan` again. `expectedCurrentStory` is `{"contains": "<text naming the
   story id>"}` for an active story and `"none"` only when `## Current Story` says "No active
   story."; neither replaces the `**Story:**` field. Do not bypass this by hand-editing the memory
   files or the integrity/governance results to make a check pass.
1. Complete Step 1 and write `memory/working/integrity-result.md` and
   `memory/working/governance-result.md` for THIS story. Each file needs exactly one
   `**Status:** PASS` (or `FAIL`), exactly one `**Story:** <id> ...` whose first word is
   the story id, and exactly one `**Date:** YYYY-MM-DD` (not after the finalization date,
   at most 7 days before it). Repeated, contradictory or malformed fields, another story,
   or a stale date are never PASS. It is your own report, not an independent check.
2. Write a finalization proposal (JSON, schema version 1: story, expectedCurrentStory,
   work, summary, keyOutputs, history, optional handoff / docUpdates). Content is
   yours; targets and paths are MONOLITH's. `expectedCurrentStory` is `"none"` or
   `{"contains": "<text naming the story id>"}`; `"any"` does not exist. A story id is
   finalized once: a second proposal for the same id with other wording is a conflict.
3. `monolith finalize plan --proposal <file>` — read-only. Shows every precondition as
   PASS / FAIL / NOT_VERIFIED, every target, and a digest. Show it to the owner.
4. Only after the owner approves: `monolith finalize apply --proposal <file> --approve <digest>`.
   Never run `apply` on your own authority and never declare the story finalized
   unless it printed `FINALIZED` or `ALREADY_FINALIZED`. `INCOMPLETE` or `REFUSED`
   means it is NOT finalized: report the output, then re-plan.

Documents to keep in sync beyond the memory files go in `docUpdates`; they are written only
if `monolith.config.json` lists them in `finalization.requiredDocs` / `allowedDocs`.

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
- If the story introduced an ADR: add or update its row in the ADR Index, `docs/adr/README.md` — the only index of ADRs; add no pointer or summary to `decisions.md`
- If the story recorded a decision that is not an ADR: add a `DEC-` record to `memory/long-term/decisions.md`

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

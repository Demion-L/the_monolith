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

Note: `monolith finalize` requires the structural `**Story:** <id>` line in `active.md` (see Deterministic Execution, item 0). If it is missing, do not fall back to manual finalization: report it to the owner.

---

## Deterministic Execution (`monolith finalize`)

Finalization is deterministic and goes through the CLI, in this order:

```text
Proposal -> monolith finalize plan -> READY + digest -> Owner Approval
         -> monolith finalize apply -> Verification
```

**Do not finalize by hand.** Never edit `active.md`, `story-index.md`,
`execution-history.md`, a story capsule or any other finalization target yourself
in order to "finalize" a story, and never skip `plan`, the owner's approval or
`apply`. If `monolith finalize` fails or reports `NOT_READY` / `REFUSED` /
`INCOMPLETE`, stop, report the output and ask the owner; do not fall back to the
Steps below. This is an instruction to you, not a technical barrier: the CLI cannot
stop an assistant from editing Markdown directly, so following it is your responsibility.

Steps 2-6 below describe what `monolith finalize apply` writes (capsule, `active.md`,
story index, execution history, optional `HANDOFF.md` and `docUpdates`); they are reference, not a manual procedure. Yours remain: Step 1
(build and integrity/governance results), Step 2.5 (lessons), Step 5.5
(documentation synchronization, before `plan`) and Step 7 (commit, only when the owner asks).

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

> Reference for what `monolith finalize apply` writes. Do not perform Steps 2-6 by hand;
> see Deterministic Execution above. Steps 1, 2.5, 5.5 and 7 are yours.

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

**If story introduced an ADR:** add or update its row in the ADR Index of `docs/adr/README.md` — the only index of ADRs. Do not add a pointer or summary to `decisions.md`.

**If story recorded a decision that is not an ADR:** add a `DEC-` record to `memory/long-term/decisions.md` using the template in that file.

---

### Step 5.5 — Documentation Synchronization (mandatory)

Finalization is not complete while project documentation contradicts the
implementation it just closed out. Check each of the following against the
actual code/tests/ADRs (the source of truth — never copy a claim from one
doc into another without verifying it), and update only where it has
drifted:

- `README.md` — positioning, implemented-vs-not-yet-implemented lists, CLI
  examples, limitations
- `AGENTS.md` — current scope, Success Criteria status, component/CLI
  references, no contradictions with README.md
- `CLAUDE.md` — mission framing, instructions, no contradictions with
  AGENTS.md
- `package.json` — description, keywords, scripts match reality
- Architecture docs (`docs/architecture/`) — component contracts match
  implemented behavior; no planned feature described as implemented
- Governance docs (tech-debt, roadmap, ADR index) — statuses current,
  cross-references correct
- CLI docs/usage/help text — matches actual commands and flags

Do not invent unstable metrics (test/node/edge counts) not backed by an
actual check just run. Do not rewrite a document wholesale when a targeted
fix covers the drift. If a contradiction can't be resolved without a new
architectural decision, stop and flag it to the user instead of guessing.

Report per document: **UPDATED** (drift found and fixed) or **VERIFIED**
(checked, already current). This step blocks Step 7 (commit) and any
push — do not proceed while a known contradiction is unresolved.

---

### Step 6 — Update HANDOFF.md

Rewrite `context/boot/HANDOFF.md` with current state:

- Active Story: None (+ what was just finalized)
- Completed This Session: bullet list of what was done
- Constraints: any active constraints the next session should know
- Next Step: next story if known, or "ask the user"

---

### Step 7 — Git commit

After `apply` printed `FINALIZED` / `ALREADY_FINALIZED` and the owner asks for a commit, stage the modified memory files and commit:

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
- [ ] ADR Index (`docs/adr/README.md`) updated (if ADR was written); `decisions.md` updated (only for a non-ADR decision)
- [ ] Documentation Synchronization complete (Step 5.5) — no known contradiction between docs and implementation left unresolved
- [ ] `HANDOFF.md` current
- [ ] Commit created (only if the owner asked)

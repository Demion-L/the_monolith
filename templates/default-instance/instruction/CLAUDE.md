# {{PROJECT_NAME}} — Claude Code Instructions

This repository runs MONOLITH, a portable project knowledge and governance toolkit for AI-assisted development.
Before acting on any skill-triggering request, read the corresponding skill file.

---

## Session Start (every session)

Before starting any task, read in order:

1. `AGENTS.md` — project overview, architecture principles, current scope
2. `{{MONOLITH_ROOT}}/memory/working/active.md` — what story is active (or confirm none)
3. `{{MONOLITH_ROOT}}/context/maps/routing-map.md` — classify the task type
4. `{{MONOLITH_ROOT}}/learning/injection-map.md` — load lesson categories relevant to the task type
5. `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md` — declare the behavioral mode for this task

**Declare the cognitive mode before starting work.** State it explicitly: "Mode: implementation" or "Mode: exploration". This constrains what mutations are allowed.

---

{{MANAGED_BOOTSTRAP}}

---

## Skill Activation

When the user's request matches a trigger phrase, **read the skill file before taking any action**.

| Trigger phrases | Skill |
|---|---|
| "finalize story", "finalize X.Y", "complete story", "mark story done" | `{{MONOLITH_ROOT}}/skills/finalize-story/SKILL.md` |
| "status", "what are we working on", "current status" | `{{MONOLITH_ROOT}}/skills/current-status/SKILL.md` |
| "global overview", "project status", "global status" | `{{MONOLITH_ROOT}}/skills/global-status/SKILL.md` |
| "analyze mistake", "learn from error", "self-improvement" | `{{MONOLITH_ROOT}}/skills/self-improvement/SKILL.md` |

Full skill index: `{{MONOLITH_ROOT}}/skills/INDEX.md`
Routing map: `{{MONOLITH_ROOT}}/context/maps/routing-map.md`

---

## Autonomous Development: Reporting Discipline

When you finish a stretch of autonomous work, your final report is a claim, not evidence. Before writing it:

1. Run `monolith governance check`.
2. Run `monolith handover check` (add `--json` for the structured form).
3. Compare each statement in your report with the result: missions, checkpoints, story state, verification evidence.
4. State every discrepancy (a completed mission is not a finalized story; a result you only reported is not verified).
5. Never present as confirmed what the handover lists as REPORTED, STALE, UNKNOWN or unverified.

Record verification so it can be checked: `monolith evidence run [--story <ID>] -- <command>` runs the command itself and
records its exit status (OBSERVED); `monolith evidence report ...` records only a statement (REPORTED, not verification).
Record progress with `monolith mission checkpoint` at significant milestones, before context compaction, before handing
work to another agent, on a significant blocker, and before finishing a long mission — not after every file, and never
with invented content. Finalization stays an owner-approved step (`monolith finalize`).

---

## Key Protocols

- Memory governance: `{{MONOLITH_ROOT}}/protocols/governance/memory-governance.md`
- Command policy: `{{MONOLITH_ROOT}}/protocols/governance/command-policy.md`
- Core invariants: `{{MONOLITH_ROOT}}/protocols/governance/core-invariants.md`
- Skills governance: `{{MONOLITH_ROOT}}/protocols/governance/skills.md`

---

## Project Structure (quick reference)

| Layer | Path | Purpose |
|---|---|---|
| Working memory | `{{MONOLITH_ROOT}}/memory/working/` | Active story, story index |
| Long-term memory | `{{MONOLITH_ROOT}}/memory/long-term/` | Decisions, execution history |
| Skills | `{{MONOLITH_ROOT}}/skills/` | Workflow procedures |

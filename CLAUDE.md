# MONOLITH — Claude Code Instructions

This repository runs MONOLITH, a portable project knowledge and governance toolkit for AI-assisted development.
Before acting on any skill-triggering request, read the corresponding skill file.

---

## Session Start (every session)

Before starting any task, read in order:

1. `AGENTS.md` — project overview, architecture principles, current scope
2. `.monolith/memory/working/active.md` — what story is active (or confirm none)
3. `.monolith/context/maps/routing-map.md` — classify the task type
4. `.monolith/learning/injection-map.md` — load lesson categories relevant to the task type
5. `.monolith/protocols/cognition/cognitive-modes.md` — declare the behavioral mode for this task

**Declare the cognitive mode before starting work.** State it explicitly: "Mode: implementation" or "Mode: exploration". This constrains what mutations are allowed.

---

## Saving Long-Term Knowledge

When creating or saving long-term knowledge (a hypothesis, ADR, tech-debt item, error record, working state, research result), the agent must:

1. Determine the Knowledge Intent.
2. Read `Table 8 — Knowledge Intent → Canonical Destination` in `.monolith/context/maps/routing-map.md`.
3. Check the authoritative source for that domain in `.monolith/context/maps/semantic-map.md`.
4. Confirm the owner repository is the right one (Webway research is not saved in MONOLITH).
5. Save only into the existing canonical destination.

If the route is missing or ambiguous, ask the owner. Do not create a new directory, template or registry.

---

## Capturing Ideas

When the user explicitly asks to save an idea (`CAPTURE_IDEA`, Table 8 in `.monolith/context/maps/routing-map.md`), run
`monolith idea add --title "..." --description "..." [--context "..."]` and continue the current task.
Use only that command: do not pick a path, and do not create or edit idea files directly. It changes no story, mission or focus.

---

## Skill Activation

When the user's request matches a trigger phrase, **read the skill file before taking any action**.

| Trigger phrases | Skill |
|---|---|
| "finalize story", "finalize X.Y", "complete story", "mark story done", "финализируй" | `.monolith/skills/finalize-story/SKILL.md` |
| "status", "what are we working on", "current status", "текущий статус" | `.monolith/skills/current-status/SKILL.md` |
| "global overview", "project status", "global status", "глобальный статус" | `.monolith/skills/global-status/SKILL.md` |
| "analyze mistake", "learn from error", "self-improvement" | `.monolith/skills/self-improvement/SKILL.md` |

Full skill index: `.monolith/skills/INDEX.md`
Routing map: `.monolith/context/maps/routing-map.md`

---

## Project State Summary

`monolith brief [--max-chars N] [--strict]` prints a deterministic, read-only summary of
project state (missions, checkpoints, mandatory protocols, current story, accepted ADRs).
It supplements the Session Start reading list above; it does not replace it.
Details: `AGENTS.md` → Project Brief.

---

## Key Protocols

- Memory governance: `.monolith/protocols/governance/memory-governance.md`
- Command policy: `.monolith/protocols/governance/command-policy.md`
- Core invariants: `.monolith/protocols/governance/core-invariants.md`
- Skills governance: `.monolith/protocols/governance/skills.md`

---

## Project Structure (quick reference)

| Layer | Path | Purpose |
|---|---|---|
| Knowledge base | `docs/` | Research, ADRs, Architecture, Vision |
| Working memory | `.monolith/memory/working/` | Active story, story index |
| Long-term memory | `.monolith/memory/long-term/` | Decisions, execution history |
| Skills | `.monolith/skills/` | Workflow procedures |
| Source | `src/` | TypeScript implementation |

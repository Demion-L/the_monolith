# MONOLITH — Claude Code Instructions

This repository runs MONOLITH, a structured cognitive operating system.
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

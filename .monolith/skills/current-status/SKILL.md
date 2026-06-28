---
type: skill
id: skill-current-status
trigger: status-check
---

# Skill: Current Status

Report current active phase, story, objectives, and blockers.

---

## Activation

Triggered by: "status", "what are we working on", "current status", "where are we", "текущий статус"

---

## Steps

1. Read `memory/working/active.md`
2. Read `context/maps/roadmap-index.md`
3. Read `memory/working/story-index.md` (for phase progress)
4. Report using the output format below

---

## Output Format

```
## Current Status

**Phase:** Phase N — Phase Name
**Story:** STORY X.Y — Story Name  (or: No active story)

**Objective:** One-line description of what this story delivers.

**Progress:** ~N% — what has been done, what remains.

**Completed this phase:**
- STORY X.A — name
- STORY X.B — name

**Next story:** STORY X.Z — Next Story Name  (or: not yet defined)

**Blockers:** none | list of blockers
```

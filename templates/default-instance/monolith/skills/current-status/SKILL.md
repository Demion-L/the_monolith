---
type: skill
id: skill-current-status
trigger: status-check
---

# Skill: Current Status

Report current active phase, story, objectives, and blockers.

---

## Activation

Triggered by: "status", "what are we working on", "current status", "where are we"

---

## Steps

1. Read `memory/working/active.md`
2. Read `context/maps/roadmap-index.md`
3. Report:
   - Active phase and progress
   - Active story: name, objective, percent complete (estimated)
   - Completed stories this phase
   - Next story (from roadmap)
   - Current blockers (if any)

---

## Output Format

```
## Current Status

**Phase:** Phase N — Phase Name
**Story:** STORY X.Y — Story Name

**Objective:** One-line description of what this story delivers.

**Progress:** ~N% — what has been done, what remains.

**Next story:** STORY X.Z — Next Story Name

**Blockers:** none | list of blockers
```

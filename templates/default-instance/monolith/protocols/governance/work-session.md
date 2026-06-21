---
type: protocol
id: protocol-work-session
category: governance
scope: system
enforcement: mandatory
---

# Work Session Protocol

Rules for managing work sessions.

---

## Session Start

1. Read `AGENTS.md` and boot sequence
2. Verify `memory/working/active.md` — is there an active story?
3. If active story: continue it. If not: ask user what to work on.
4. Never start new work without knowing the active story.

---

## During Session

1. One story at a time — do not context-switch without explicit user request
2. Update `context/boot/HANDOFF.md` when pausing mid-story
3. Log significant decisions to `memory/long-term/decisions.md`
4. Create error records in `memory/errors/` when mistakes occur

---

## Session End

1. Update `context/boot/HANDOFF.md` with next step
2. Update `context/boot/WORK_SESSION.md` with session summary
3. If story is complete: run finalize-story skill
4. If story is paused: ensure active.md reflects current state

---

## Rules

- Never close a session with uncommitted work silently
- Always leave `HANDOFF.md` in a state that the next session can resume from
- Story completion requires finalize-story skill, not manual documentation only

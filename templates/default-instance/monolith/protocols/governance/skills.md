---
type: protocol
id: protocol-skills-governance
category: governance
scope: system
enforcement: mandatory
---

# Skills Governance

Rules for AI skills — what they can do and what they cannot.

---

## What a Skill Is

A skill is a declarative procedure file that defines:

- when it activates (trigger)
- what it does (steps)
- what it produces (outputs)
- what it must verify (checks)

A skill does NOT contain runtime code. It is a specification read by the AI.

---

## Skill Rules

1. **Atomic** — A skill runs to completion or not at all. No partial execution.
2. **Idempotent** — Running a skill twice must not corrupt state.
3. **Single story** — Skills operate on the active story only.
4. **Memory first** — Read `memory/working/active.md` before starting any skill.
5. **Verification required** — Skills that modify memory must verify their output.

---

## Skill Boundaries

| Allowed                        | Forbidden                                         |
| ------------------------------ | ------------------------------------------------- |
| Read any file                  | Delete files outside memory/                      |
| Write to memory/               | Modify source code (except implementation skills) |
| Create context/templates/      | Push to remote repositories                       |
| Call other skills as sub-steps | Call skills recursively                           |

---

## Adding a Skill

1. Create `skills/<name>/SKILL.md`
2. Add entry to `skills/INDEX.md`
3. Add routing entry in `context/maps/routing-map.md` Table 2

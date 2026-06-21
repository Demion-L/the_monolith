---
type: protocol
id: protocol-boot-sequence
category: governance
scope: system
enforcement: mandatory
applies_to:
  - all
topology_role: node
---

# AI Assistant Boot Sequence

Required context recovery order for any AI assistant entering this repository.

Follow this sequence STRICTLY.

---

# Fast Recovery Mode (Preferred)

For quick session recovery, read in order:

1. `AGENTS.md`
2. `{{MONOLITH_ROOT}}/context/maps/project-map.md`
3. `{{MONOLITH_ROOT}}/context/maps/routing-map.md` — classify task type
4. `{{MONOLITH_ROOT}}/memory/working/active.md`
5. `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md`
6. `{{MONOLITH_ROOT}}/protocols/governance/memory-governance.md`
7. Relevant skill from `{{MONOLITH_ROOT}}/skills/` (resolved via routing-map Table 2)
8. `{{MONOLITH_ROOT}}/learning/injection-map.md` — load relevant lesson categories
9. `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md` — apply behavioral constraints

---

# Full Recovery Mode

When context is lost or session is starting cold:

1. Read AGENTS.md
2. Read `{{MONOLITH_ROOT}}/context/maps/project-map.md`
3. Read `{{MONOLITH_ROOT}}/context/maps/routing-map.md`
4. Read `{{MONOLITH_ROOT}}/memory/working/active.md`
5. Read `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md`
6. Read `{{MONOLITH_ROOT}}/context/boot/HANDOFF.md` — session transfer
7. Read `{{MONOLITH_ROOT}}/context/execution/current-state.md`
8. Read `{{MONOLITH_ROOT}}/protocols/governance/memory-governance.md`
9. Read `{{MONOLITH_ROOT}}/protocols/governance/core-invariants.md`
10. Load skill from `{{MONOLITH_ROOT}}/skills/` per routing-map
11. Load learning lessons per `{{MONOLITH_ROOT}}/learning/injection-map.md`
12. Apply `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md`

---

# Rules

- Do NOT start any task before completing the boot sequence.
- Do NOT skip steps 3, 4, 8, 9 under any circumstances.
- One story at a time. Verify active.md before accepting new work.

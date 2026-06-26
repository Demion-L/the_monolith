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
2. `.monolith/context/maps/project-map.md`
3. `.monolith/context/maps/routing-map.md` — classify task type
4. `.monolith/memory/working/active.md`
5. `.monolith/context/maps/roadmap-index.md`
6. `.monolith/protocols/governance/memory-governance.md`
7. Relevant skill from `.monolith/skills/` (resolved via routing-map Table 2)
8. `.monolith/learning/injection-map.md` — load relevant lesson categories
9. `.monolith/protocols/cognition/cognitive-modes.md` — apply behavioral constraints

---

# Full Recovery Mode

When context is lost or session is starting cold:

1. Read AGENTS.md
2. Read `.monolith/context/maps/project-map.md`
3. Read `.monolith/context/maps/routing-map.md`
4. Read `.monolith/memory/working/active.md`
5. Read `.monolith/context/maps/roadmap-index.md`
6. Read `.monolith/context/boot/HANDOFF.md` — session transfer
7. Read `.monolith/context/execution/current-state.md`
8. Read `.monolith/protocols/governance/memory-governance.md`
9. Read `.monolith/protocols/governance/core-invariants.md`
10. Load skill from `.monolith/skills/` per routing-map
11. Load learning lessons per `.monolith/learning/injection-map.md`
12. Apply `.monolith/protocols/cognition/cognitive-modes.md`

---

# Rules

- Do NOT start any task before completing the boot sequence.
- Do NOT skip steps 3, 4, 8, 9 under any circumstances.
- One story at a time. Verify active.md before accepting new work.

---
type: context
id: routing-map
topology_role: root
---

# Routing Map

## Purpose

Declarative activation map. Given a task type, resolves:

- which cognitive mode to apply
- which skill to activate
- which protocols to enforce
- which memory regions to load
- which learning categories to inject
- what model tier to use
- where a new piece of long-term knowledge is stored (Table 8)

---

## Table 1 — Task Type → Cognitive Mode

| Task Type            | Cognitive Mode |
| -------------------- | -------------- |
| finalize-story       | finalization   |
| implementation-task  | implementation |
| new-feature          | implementation |
| bug-investigation    | debugging      |
| architecture-review  | review         |
| code-review          | review         |
| planning-request     | planning       |
| exploration-request  | exploration    |
| status-check         | exploration    |
| global-overview      | exploration    |
| learning-update      | reflection     |
| self-improvement     | reflection     |
| story-transition     | finalization   |
| documentation-update | implementation |

Reference: `.monolith/protocols/cognition/cognitive-modes.md`

---

## Table 2 — Task Type → Skills

| Task Type            | Primary Skill        |
| -------------------- | -------------------- |
| finalize-story       | finalize-story       |
| status-check         | current-status       |
| global-overview      | global-status        |
| self-improvement     | self-improvement     |
| implementation-task  | (no dedicated skill) |
| new-feature          | (no dedicated skill) |
| bug-investigation    | (no dedicated skill) |
| architecture-review  | (no dedicated skill) |
| code-review          | (no dedicated skill) |
| planning-request     | (no dedicated skill) |
| exploration-request  | (no dedicated skill) |
| learning-update      | self-improvement     |
| story-transition     | finalize-story       |
| documentation-update | (no dedicated skill) |

Skill files: `.monolith/skills/`

---

## Table 3 — Task Type → Protocols

| Task Type            | Protocols                                                 |
| -------------------- | --------------------------------------------------------- |
| finalize-story       | finalize-story, memory-governance, integrity-verification |
| implementation-task  | memory-governance, command-policy                         |
| new-feature          | memory-governance, command-policy                         |
| bug-investigation    | memory-governance, command-policy                         |
| architecture-review  | memory-governance, core-invariants                        |
| code-review          | memory-governance, command-policy                         |
| planning-request     | memory-governance, semantic-planning                      |
| exploration-request  | memory-governance                                         |
| status-check         | memory-governance                                         |
| global-overview      | memory-governance                                         |
| learning-update      | memory-governance, failure-memory-logging                 |
| self-improvement     | memory-governance, failure-memory-logging                 |
| story-transition     | memory-governance, finalize-story                         |
| documentation-update | memory-governance                                         |

---

## Table 4 — Task Type → Memory Regions

| Task Type           | Memory Regions                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| finalize-story      | working/active, working/story-index, long-term/execution-history       |
| implementation-task | working/active, long-term/architecture-principles                      |
| new-feature         | working/active, long-term/decisions, long-term/architecture-principles |
| bug-investigation   | working/active, long-term/tech-debt                                    |
| architecture-review | working/active, long-term/decisions, long-term/architecture-principles |
| planning-request    | working/active, context/maps/roadmap-index                             |
| status-check        | working/active, context/maps/roadmap-index                             |
| global-overview     | working/active, long-term/decisions, context/maps/roadmap-index        |
| self-improvement    | learning/mistakes, memory/errors                                       |

---

## Table 5 — Task Type → Learning Hooks

| Task Type           | Learning Categories                         |
| ------------------- | ------------------------------------------- |
| finalize-story      | workflow, architecture                      |
| implementation-task | architecture, typescript, dependencies      |
| new-feature         | architecture, dependencies                  |
| bug-investigation   | architecture, nonexistent-api, context-sync |
| code-review         | architecture, typescript                    |
| self-improvement    | all categories                              |

---

## Table 6 — Task Type → Model Tier

| Task Type            | Model Tier |
| -------------------- | ---------- |
| implementation-task  | default    |
| new-feature          | default    |
| architecture-review  | default    |
| planning-request     | default    |
| finalize-story       | default    |
| bug-investigation    | default    |
| code-review          | default    |
| exploration-request  | default    |
| status-check         | default    |
| global-overview      | default    |
| self-improvement     | default    |
| documentation-update | default    |

Model registry: `.monolith/context/models/model-registry.md`
Privacy rules: `.monolith/context/models/privacy-classification.md`

---

## Table 7 — Fallback Routing Rules

| Condition                      | Resolution                                    |
| ------------------------------ | --------------------------------------------- |
| Task type unclear              | Use exploration mode. Ask for clarification.  |
| Multiple task types applicable | Use the most restrictive cognitive mode.      |
| No matching skill              | Execute task inline without a skill template. |
| Sensitive data in context      | Override to local model tier.                 |
| Knowledge intent unclear       | Table 8 applies: ask, write nothing.          |

---

## Table 8 — Knowledge Intent → Canonical Destination

Declarative contract for saving long-term knowledge. It points at existing
stores only; it creates no directory, template or registry. Where truth lives
is defined by `semantic-map.md` — this table does not replace it.

| Knowledge Intent         | Canonical Destination                                                                                                         | Required Context                                                                                          | Index                                                                                             | Owner repo |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| `CREATE_HYPOTHESIS`      | Subject MONOLITH: `.monolith/memory/long-term/hypotheses.md` — new `## H<n>` section, n ≥ 9 (H1 … H8 are taken, including those now owned by Webway). Subject Webway: Webway repository `docs/hypotheses.md` — new `## <Title> {#HYP-NNN}` section, next number after the highest used (HYP-001 … 008 are used or reserved). Subject unclear: ask | Status Legend and existing numbers of the target file; memory-governance rule 3; **KQ-1** | none (the headings of the file) | MONOLITH; Webway when the subject is Webway's research program — https://github.com/Demion-L/webway |
| `CREATE_ADR`             | `docs/adr/ADR-NNN-<slug>.md` (ADR-007 … ADR-019 live there; ADR-001 … 003 stay in `.monolith/adr/`) | `docs/adr/README.md` (template, statuses, numbering — retired IDs are not reused) | `docs/adr/README.md` — ADR Index table, the only ADR index; no pointer or summary elsewhere | MONOLITH; an ADR about Webway's research program belongs to Webway (`webway:ADR-004` … 006) |
| `RECORD_TECH_DEBT`       | `.monolith/memory/long-term/tech-debt.md` — a row in "Open Debt" (Accepted/Resolved sections for later states)                  | `tech-debt.md` (existing IDs, to avoid a collision)                                                       | none (the registry is the list)                                                                   | MONOLITH   |
| `RECORD_ERROR`           | `.monolith/memory/errors/ERR-YYYY-XXXX.md` per `SCHEMA.md`. A lesson extracted from it is a separate step: `.monolith/learning/mistakes/<category>/LESSON-*.md` via the `self-improvement` skill | `memory/errors/SCHEMA.md`, `TAXONOMY.md`; `.monolith/skills/self-improvement/SKILL.md`                    | none per record (`memory/errors/README.md` and `learning/INDEX.md` describe structure only)       | MONOLITH   |
| `UPDATE_WORKING_STATE`   | `.monolith/memory/working/active.md`; session transfer: `.monolith/context/boot/HANDOFF.md`                                     | `active.md`; memory-governance rule 5 (reference the active story ID). Story completion is `FINALIZE_STORY`, not this intent | `memory/working/story-index.md` lists finalized stories only — not written by this intent | MONOLITH   |
| `FINALIZE_STORY`         | Defined by the skill: story capsule, `active.md`, `story-index.md`, `execution-history.md` (append-only), the ADR Index row (if an ADR was written), `HANDOFF.md` | `.monolith/skills/finalize-story/SKILL.md`; memory-governance; integrity-verification | `memory/working/story-index.md` | MONOLITH |
| `RECORD_RESEARCH_RESULT` | Subject Webway: **not stored in MONOLITH** — Webway repository `docs/research/R-NNNN-<slug>.md`, indexed by `docs/research/README.md` there. Subject MONOLITH's own toolkit: no route (**KQ-3**), ask | `docs/README.md` (note on the move); **KQ-3** | Webway: `docs/research/README.md` (its own) | Webway — https://github.com/Demion-L/webway |

**Rules**

1. An intent not listed here, or one that fits two rows, has no route: ask the owner, write nothing, create no directory.
2. Save only into the destination named above. If it does not exist or is not writable, ask — do not create a substitute.
3. Before writing, confirm the authoritative source for the domain in `semantic-map.md`. On a conflict, do not choose; ask.
4. Destinations in this table are repo-relative to the MONOLITH repository unless the owner column says Webway.

**Open routing questions** (not resolved here; no arbitrary choice made)

- **KQ-1 — Ownership of H2, H5, H6.** Their subject lies on the MONOLITH/Webway boundary; they stay in `hypotheses.md` until the owner decides. They keep their H-numbers and no `HYP-NNN` identity is assigned to them in either repository (a later move or marker must not need a second migration). A hypothesis whose subject is unclear is not routed — ask.
- **KQ-3 — Research about MONOLITH's own toolkit.** `docs/` has no research layer and no canonical path is defined for it. Not decided; no directory is created.

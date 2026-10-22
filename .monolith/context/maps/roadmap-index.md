---
type: context
id: roadmap-index
topology_role: root
authority: authoritative
---

# Roadmap Index

Navigable index of project phases and their status.

Keep in sync with `memory/working/active.md` and `memory/working/story-index.md`.

---

## Phases

### Phase 1 — Cognitive Core & First Evidence

**Status:** IN PROGRESS

**Goal:** Establish the core cognitive architecture (conceptual layers, governance, protocols) and validate the knowledge-ingestion pipeline on MONOLITH's own corpus.

| Story | Title | Status | Date |
| ----- | ----- | ------ | ---- |
| 1.1 | Cognitive Core Foundation + Webway Dogfood v0 | COMPLETED | 2026-06-26 |
| 1.3 | Scriptorium, ERG, and Canonical Identity Resolution | COMPLETED | 2026-06-28 |
| COORDINATORIUM-001 | Tactical Coordinatorium: Mission Lifecycle MVP | COMPLETED | 2026-10-21 |
| COORDINATORIUM-002 | Mission Checkpoints (incl. Schema v2 migration, Init Safety `.gitkeep` closure) | COMPLETED | 2026-10-21 |
| CONTEXT-001A | MONOLITH Context Gateway: `monolith brief` | COMPLETED | 2026-10-22 |
| 1.? | *(next story — not yet defined)* | PLANNED | — |

**Candidate next stories** (not decisions — require user definition):
- CONTEXT-001B — `monolith context <topic>` (Context Gateway, second deliverable) — not started; see HANDOFF.md
- SEC-001 — Project Root Trust Boundary (`monolithRoot` containment) — registered OPEN in tech-debt.md, not started
- Corpus relationship density — 32 edges on 481 nodes is too sparse for useful graph traversal
- Engineering Gate implementation — formalized in ADR-003, no runtime yet
- TD-007b — CLI usage text lists `status`/`dry-run` as implemented; both exit 1
- STATE-001 — State Retention & Compaction — **PROPOSED / BACKLOG, registration only**; first step is an inventory (AUDIT ONLY), no design before it. See `tech-debt.md` (STATE-001 detail); related to MEM-001
- MEM-001 — Memory Lifecycle — **PROPOSED / BACKLOG, registration only**; first step is an inventory of existing memory mechanisms (AUDIT ONLY). See `tech-debt.md` (MEM-001 detail); STATE-001 may become one of its foundations, the two are not merged
- Mission Control UI (read-only local web UI, stages UI-000…UI-005) — **architecture accepted (ADR-010), not implemented, unscheduled, no priority implied**; does not block or reorder any item above. See ADR-010 (`accepted`) and `.monolith/context/templates/plan-ui-mission-control.md`

Terra persistence (ADR-006) and Webway v1 improvements (frontmatter
stripping, semantic linking) are no longer MONOLITH candidate directions —
both belong to Webway's cognitive-architecture research program, developed
independently: https://github.com/Demion-L/webway

---

### Phase 2+

**Status:** NOT DEFINED

---

## Current Focus

Active Phase: 1 — Cognitive Core & First Evidence
Active Story: none

---

## Completion Summary

| Phase | Completed stories | Status |
| ----- | ----------------- | ------ |
| 1     | 4 / ? | IN PROGRESS |

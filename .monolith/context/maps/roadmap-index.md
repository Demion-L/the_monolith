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

#### Work merged to `main` after CONTEXT-001A — not recorded as stories

Reconstructed from `git log` on 2026-10-27 (SELF-AWARENESS-001). None of these
went through `finalize-story`: there are no capsules, no `story-index.md`
entries and no execution-history records for them. "Merged" below means only
that the commit is reachable from `main`; whether each item was formally
finalized, and whether its acceptance criteria were verified, is **UNKNOWN**
from the documents. Dates are commit dates of the cited commit. This is a known
gap in the story system, registered as `STATE-DRIFT-001` in `tech-debt.md`.

| Item | What git shows | Status | Date | Evidence |
| ---- | -------------- | ------ | ---- | -------- |
| SEC-001A | `monolithRoot` containment (ADR-009) | MERGED; finalization UNKNOWN | 2026-10-22 | `4a58dae` |
| SEC-002 | Static `validate`, no `import()` of project code (ADR-011) | MERGED; finalization UNKNOWN | 2026-10-22 | `4a58dae` |
| SEC-001B.1 | Bounded, safe file reads | MERGED; finalization UNKNOWN | 2026-10-23 | `d006562` |
| SEC-001B.2 | Safe writes, explicit write scope (ADR-012) | MERGED; finalization UNKNOWN | 2026-10-23 | `4bc7b9d` |
| SEC-001B.1-R | Unified safe read contract (ADR-014) | MERGED; finalization UNKNOWN | 2026-10-23 | `c3a428b` |
| SEC-001B.3 | TOCTOU threat model (ADR-013) | DOCUMENTED only (ADR-013 `proposed`); not implemented | 2026-10-23 | `8d67a4b` |
| UI-000 | Mission Control UI architecture (ADR-010) | ADR `accepted`; docs only | 2026-10-22 | `902f2ce` |
| UI-001A | Mission Control dashboard skeleton | MERGED; finalization UNKNOWN | 2026-10-23 | `da612a4` |
| UI-001B.1 | Typed read model | MERGED; finalization UNKNOWN | 2026-10-23 | `c99fa70` |
| UI-001B.2 | Read-only loopback HTTP API | MERGED; finalization UNKNOWN | 2026-10-23 | `34eb93d` |
| UI-001B.3 | Mission Control live data (`GET /api/dashboard`) | MERGED; finalization UNKNOWN | 2026-10-26 | `a7c81a5` |
| UI-002B | Skin infrastructure | MERGED; finalization UNKNOWN | 2026-10-27 | `56082ac` |
| UI-002C | Sidebar layout shell | MERGED; finalization UNKNOWN | 2026-10-27 | `4c3e041` |
| UI-002D | Cosmic Glass skin | MERGED; finalization UNKNOWN | 2026-10-27 | `7f3e718` |
| SELF-AWARENESS-001 | Project State Freshness in `monolith brief` | IN PROGRESS on branch `feat/monolith-self-awareness-001`; not merged | 2026-10-27 | — |

Durable Execution State (ADR-017/018/019) exists on `main` as design documents
only (`7204f22`); its implementation lives in a separate, unmerged worktree and
is outside this index. Its state is **UNKNOWN** here.

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
Active Story: none recorded — SELF-AWARENESS-001 is in progress on a branch but has not been registered as a story (see `active.md`)

---

## Completion Summary

| Phase | Completed stories | Status |
| ----- | ----------------- | ------ |
| 1     | 5 recorded as stories / ? (plus the unrecorded merged work listed above) | IN PROGRESS |

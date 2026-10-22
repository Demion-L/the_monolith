---
type: memory
id: memory-working-story-index
category: working
topology_role: root
authority: authoritative
related_protocols:
  - memory-governance
---

# Story Index

## Purpose

Fast navigation index for implementation history.

Use this when you need to know:

- where a feature was implemented
- which story changed a module
- why a decision was made

---

# Stories

<!-- Stories are added here as they are finalized via the finalize-story skill. -->
<!-- Format: ## Phase N — Phase Name / ### STORY X.Y — Story Name -->

## Phase 1 — Cognitive Core & First Evidence

### STORY 1.1 — Cognitive Core Foundation + Webway Dogfood v0

**Date:** 2026-06-26
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-1.1-cognitive-core-and-dogfood-v0.md`

**Summary:** Formalized Cognitive Core and Engineering Gate as conceptual layers. Refined H8 (prediction = inference over unknown information; Schliemann/Troy). Ran first WEBWAY corpus experiment (dogfood v0) against 72 markdown files. Derived Story Lifecycle model from dogfood findings — Story as unit of engineering evolution, Decision as terminal state.

**Key outputs:** ADR-002, ADR-003, cognitive-core.md, engineering-gate.md, story-lifecycle.md, webway-dogfood-v0 reports, src/scripts/dogfood.ts

---

### STORY 1.3 — Scriptorium, Explicit Relationship Graph, and Canonical Identity Resolution

**Date:** 2026-06-28
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-1.3-scriptorium-erg-canonical-identity.md`

**Summary:** Three-sub-story arc validating the Scriptorium + Explicit Relationship Graph pipeline on MONOLITH's own corpus. Sub-story 1.3.1 established baseline (4 edges, 0% real-to-real). Sub-story 1.3.2 added missing relationship fields and heading-noise filter (32 edges, 13% real-to-real). Sub-story 1.3.3 introduced canonical alias system grounded in explicit frontmatter metadata (0 synthesized nodes, 100% real-to-real). ADR-007 written.

**Key outputs:** src/scriptorium/, src/graph/, src/scripts/dogfood-graph.ts, docs/adr/ADR-007, .monolith/reports/graph-dogfood-v1*.md, 151 tests passing

---

### COORDINATORIUM-001 — Tactical Coordinatorium: Mission Lifecycle MVP

**Date:** 2026-10-21
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-coordinatorium-001-tactical-mission-lifecycle.md`

**Summary:** First vertical slice of Coordinatorium — a deterministic, file-based State Keeper (`.monolith/state.json`) and a `monolith mission start|list|show|finish` CLI for registering and closing development missions, independent of any single AI session's self-reported memory. Three same-day hardening passes closed, in turn: a live owner being preemptable purely by lock age, a non-atomic "re-read then delete" recovery race between two challengers, and a non-atomic lock-*creation* path that could leave an empty/partial canonical lock behind on a write failure. Strategic Coordinatorium remains schema-reserved only; mission registration is not runtime-enforced.

**Key outputs:** src/coordinatorium/{types,state-keeper,lock,mission,cli,errors}.ts, docs/adr/ADR-008, 186 tests passing (48 Coordinatorium-specific: 13 state-keeper, 17 mission + CLI, 15 lock — including real multi-process concurrency and TOCTOU/partial-write regression tests — 3 init regression)

---

### COORDINATORIUM-002 — Mission Checkpoints

**Date:** 2026-10-21
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-coordinatorium-002-mission-checkpoints.md`

**Summary:** Durable, append-only progress checkpoints for an `in_progress` mission (`tactical.checkpoints` sibling map, `createCheckpoint`/`listCheckpoints`/`getCheckpoint`, `monolith mission checkpoint|checkpoints` CLI), gated on mission activity and serialized through the existing State Keeper lock. A same-day compatibility review found that leaving `schemaVersion` at 1 would let a pre-002 binary silently drop checkpoints on write; fixed by bumping to schemaVersion 2 with an explicit, verified v1→v2 migration and loud old-binary rejection. This finalization pass additionally closed an Init Safety gap found during review: `createEmptyDirs()` could silently truncate a pre-existing `.gitkeep`, now covered by the same preflight-conflict contract as every other tracked file. Documentation (README/AGENTS/CLAUDE/package.json/architecture docs/instruction templates) was synchronized, removing a stale "Cognitive Operating System" framing superseded by the toolkit mission.

**Key outputs:** src/coordinatorium/checkpoint.ts, src/init/scaffold.ts (GITKEEP_DIRS fix), docs/adr/ADR-008 (two addenda), 252 tests passing (checkpoint 40, state-keeper 21, init-safety 12, mission 17, init 3, init-args 6, lock 15, scriptorium 75, graph 63), LESSON-2026-0007

---

### CONTEXT-001A — MONOLITH Context Gateway: `monolith brief`

**Date:** 2026-10-22
**Status:** COMPLETED
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-context-001a-monolith-brief.md`

**Summary:** A deterministic, read-only `monolith brief [--max-chars N] [--strict]` command that gives an AI session a compact, bounded, provenance-carrying summary of project state (State Keeper status, active missions and latest checkpoints, mandatory protocols, current story, accepted ADRs) in place of reading many governance files. Explicit `Completeness: COMPLETE|INCOMPLETE`, explicit truncation markers, exit codes 0/1/2, all project-controlled strings sanitized. Two review remediation rounds (F-1…F-7, N-1/N-3) were folded in before integration. `monolith context <topic>` (CONTEXT-001B) is not implemented; SEC-001 (`monolithRoot` containment) is registered and OPEN.

**Key outputs:** src/brief/, monolith.config.json (`contextGateway.adrDirs`), tech-debt SEC-001 + TD-009, LESSON-2026-0008, 374 tests passing (brief 122)

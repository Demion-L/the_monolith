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

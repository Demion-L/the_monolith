---
type: memory
id: memory-long-term-execution-history
category: long-term
authority: authoritative
append_only: true
---

# Execution History

Append-only log of completed story finalizations.

Each entry is written by the finalize-story skill at story completion.

---

## History

<!-- Entries are appended here. Do not edit or delete existing entries. -->
<!-- Format: ## STORY X.Y — Story Name (YYYY-MM-DD) -->

## STORY 1.1 — Cognitive Core Foundation + Webway Dogfood v0 (2026-06-26)

**Phase:** 1 — Cognitive Core & First Evidence
**Decision:** Cognitive Core and Engineering Gate established as conceptual layers (ADR-002, ADR-003). H8 refined. Story Lifecycle formalized from dogfood finding. v0 officially closed.
**Build:** PASS — 13/13 tests, tsc clean.
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-1.1-cognitive-core-and-dogfood-v0.md`

---

## STORY 1.3 — Scriptorium, Explicit Relationship Graph, and Canonical Identity Resolution (2026-06-28)

**Phase:** 1 — Cognitive Core & First Evidence
**Decision:** Explicit-only identity resolution in the ERG — aliases registered from frontmatter `id:` and `title:` only, no fuzzy matching (ADR-007). Graph pipeline validated on MONOLITH corpus: 481 real nodes, 0 synthesized, 32 edges, 100% real-to-real.
**Build:** PASS — 151/151 tests (webway: 13, scriptorium: 75, graph: 63), typecheck clean.
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-1.3-scriptorium-erg-canonical-identity.md`

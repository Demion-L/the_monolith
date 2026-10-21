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

---

## COORDINATORIUM-001 — Tactical Coordinatorium: Mission Lifecycle MVP (2026-10-21)

**Phase:** 1 — Cognitive Core & First Evidence
**Decision:** First vertical slice of Coordinatorium — deterministic, file-based State Keeper (`.monolith/state.json`, cross-process lock + atomic temp-file+rename write, no lost updates) and `monolith mission start|list|show|finish` CLI (ADR-008). Three same-day hardening passes: (1) stale-lock recovery made liveness-only, no age fallback, after a live owner was found preemptable purely by elapsed time; (2) recovery of a specific stale lock serialized by a dedicated `<lockPath>.recovery` mutex, after "re-read then delete" was found non-atomic across two forked processes; (3) lock *creation* itself made safe via a staging file + atomic hard-link publish (`createAndPublish`, `LockCreationError`), after a write failure/short write was found able to leave an empty/partial canonical lock behind. Strategic Coordinatorium remains schema-reserved only; mission registration is not runtime-enforced.
**Build:** PASS — 186/186 tests (scriptorium 75, graph 63, coordinatorium 48 — state-keeper 13, mission+CLI 17, lock 15, init regression 3 — unchanged modules unaffected), typecheck clean, build clean.
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-coordinatorium-001-tactical-mission-lifecycle.md`

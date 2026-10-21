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

---

## COORDINATORIUM-002 — Mission Checkpoints (2026-10-21)

**Phase:** 1 — Cognitive Core & First Evidence
**Decision:** Durable, append-only Mission Checkpoints added as a sibling `tactical.checkpoints` map (not nested in `Mission`), gated on the target mission being `in_progress`, serialized through the existing `mutateState()` lock — no new lock/mutex/daemon. `state.json` schemaVersion bumped to 2 (same-day compatibility fix) with an explicit, verified v1→v2 in-memory migration on read and loud rejection by a pre-002 binary against a v2 file, after an independent review found the original cut (schemaVersion left at 1) would let an old binary silently drop checkpoints. ADR-008 amended with two dated addenda rather than a new ADR. This same finalization pass closed an Init Safety gap: `createEmptyDirs()` could silently truncate a pre-existing `.gitkeep` — the 10 affected paths are now covered by the shared `planScaffoldConflicts()` preflight (`GITKEEP_DIRS` single source of truth), same no-overwrite contract as every other tracked file, `--yes` included. Documentation (README.md, AGENTS.md, CLAUDE.md, package.json, docs/architecture/toolkit-pipeline.md, the three scaffold instruction templates) was synchronized, removing a stale "Cognitive Operating System" framing superseded 2026-10-21 by the toolkit mission (MANIFESTO.md). `finalize-story` skill amended with a mandatory Documentation Synchronization step (5.5).
**Build:** PASS — 252/252 tests (scriptorium 75, graph 63, coordinatorium/checkpoint 40, coordinatorium/state-keeper 21, init/init-safety 12, coordinatorium/mission 17, init/init 3, cli/init-args 6, coordinatorium/lock 15 — `lock.test.ts` run 5× consecutively, no flakes), typecheck clean, build clean.
**Capsule:** `.monolith/memory/working/phases/phase-1/stories/story-coordinatorium-002-mission-checkpoints.md`

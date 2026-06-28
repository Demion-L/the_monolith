---
type: story-capsule
id: story-1.3
phase: phase-1
title: Scriptorium, Explicit Relationship Graph, and Canonical Identity Resolution
date: 2026-06-28
status: COMPLETED
sub-stories:
  - story-1.3.1: Dogfood Experiment
  - story-1.3.2: Corpus Relationship Alignment
  - story-1.3.3: Canonical Identity Aliases
---

# STORY 1.3 — Scriptorium, Explicit Relationship Graph, and Canonical Identity Resolution

## Objective

Validate the Scriptorium + Explicit Relationship Graph pipeline on MONOLITH's own markdown corpus via a dogfood experiment. Fix all issues discovered by the experiment. Produce a graph where all relationship edges connect real nodes.

---

## Implementation Summary

### Story 1.3.1 — Dogfood Experiment

Ported Scriptorium and Explicit Relationship Graph modules from the parallel webway branch. Created `src/scripts/dogfood-graph.ts` — a runner that discovers all MONOLITH markdown files, compiles each with `compileMarkdownArtifact()`, builds a graph with `buildGraph()`, and produces a quality report.

First report (graph-dogfood-v1.md): 4 edges, all synthesized, 0% real-to-real. Three findings:
- MONOLITH relationship fields (`follow_up_adrs`, `related_adrs`, `related_research`) not recognized by Scriptorium
- Heading concepts too noisy (structural section titles creating meaningless high-degree nodes)
- `fromLabel` falling back to artifact path ID instead of document title

### Story 1.3.2 — Corpus Relationship Alignment

Fixed all three findings:
- Added `follow_up_adrs`, `related_adrs`, `related_research` to `MONOLITH_RELATIONSHIP_FIELDS`
- Added `isStructuralHeadingNoise()` with a conservative 11-term exact-match filter
- Added `extractH1()` in dogfood script to pass H1 heading as `input.title` to Scriptorium

Second report (graph-dogfood-v1-1.md): 32 edges (8× increase), 13% real-to-real, 12 synthesized nodes on the FROM side. Root cause identified: short-form IDs (`ADR-004`, `R-0001`) in relationship fields don't match H1-based node slugs.

### Story 1.3.3 — Canonical Identity Aliases

Added a deterministic alias system (Pass 2.5 in `buildGraph()`):
- Scriptorium extracts `documentId` (from frontmatter `id:`) and `documentTitle` (resolved label) on each `ScriptoriumResult`
- Pass 2.5 registers `normalizeLabel(documentId)` and `normalizeLabel(documentTitle)` → primary node ID before relationship resolution
- Aliases originate only from explicit frontmatter metadata — no fuzzy matching, no embeddings

Third report (graph-dogfood-v1-2.md): 32 edges, 0 synthesized nodes, 100% real-to-real.

ADR-007 written documenting the explicit-only identity resolution decision.

---

## Files Changed

**New source modules:**
- `src/scriptorium/` — types, compile, frontmatter, markdown, index (5 files)
- `src/graph/` — types, builder, normalize, index (4 files)
- `src/scripts/dogfood-graph.ts`

**Updated source:**
- `src/index.ts` — added Scriptorium and Graph exports alongside Webway

**New documentation:**
- `docs/adr/ADR-007-explicit-identity-resolution.md`
- `docs/` entire knowledge base (ADRs 004–007, research, architecture, vision)

**Reports:**
- `.monolith/reports/graph-dogfood-v1.md` — v1 (1.3.1)
- `.monolith/reports/graph-dogfood-v1-1.md` — v1.1 (1.3.2)
- `.monolith/reports/graph-dogfood-v1-2.md` — v1.2 (1.3.3)

**Config:**
- `package.json` — added `test`, `dogfood-graph` scripts, `vitest` devDependency
- `tsconfig.json` — added test file exclusion
- `CLAUDE.md` — created (skill activation)

---

## Tests

- 151 tests total: webway (13), scriptorium (75), graph (63)
- typecheck: 0 errors
- All tests added incrementally per sub-story: +103 ported, +16 in 1.3.2, +22 in 1.3.3

---

## Key Decisions

1. **Explicit-only alias resolution** — aliases in the graph come only from frontmatter `id:` and `title:` fields. No fuzzy matching, no embeddings, no probabilistic inference. See ADR-007.

2. **H1 heading as primary node concept** — each document's first H1 heading becomes the primary node in the graph. `documentTitle` is derived from frontmatter `title:` → H1 → artifact ID (in that priority).

3. **Conservative heading noise filter** — 11 structural section titles (Overview, Summary, Background, etc.) are filtered before concept extraction. Exact case-insensitive match only.

4. **First-document-wins on alias collision** — if two documents claim the same alias, the first processed wins. A diagnostic is emitted. No exception thrown.

---

## ADRs Written

- `docs/adr/ADR-007-explicit-identity-resolution.md` — Explicit-Only Identity Resolution in the Explicit Relationship Graph

---

## Lessons Learned

1. **Dogfood-first works.** The three-story arc (experiment → fix → fix) with a quality report at each step produced clear, evidence-based improvements. The report format drove the next story specification.

2. **100% on a small corpus is a weak signal.** 32 edges on 481 nodes (0.07 edges/node) means the graph is mostly disconnected. The alias system is correct but the corpus is sparse. Terra persistence will need a denser graph to be useful.

3. **The alias system is brittle to renaming.** If a document's `id:` field changes, all references from other documents using the old ID will silently synthesize placeholder nodes. No referential integrity check exists.

4. **`documentTitle` alias creates future risk.** Registering the full title as an alias could cause shadowing if a future document creates a heading with the same normalized text. Monitor in dogfood reports.

---
type: context
id: agents-root
topology_role: root
authority: authoritative
---

# MONOLITH — AI Assistant Guide

This is the primary entry point for AI assistants working in this project.  
Read this file first on every session start. Do not start any task before completing the Boot Sequence.

---

## Project

**Package:** `@monolith/core`  
**Version:** `0.1.0-alpha.0`  
**Language:** TypeScript (strict, ESM)  
**Runtime:** Node.js >= 20  
**Package Manager:** pnpm  
**MONOLITH Root:** `.monolith/`

---

## Mission

Transform raw information into structured knowledge by building semantic connections between concepts — not by keyword matching, but by meaning.

MONOLITH is a cognitive operating system. Its cognitive kernel consists of three subsystems now active: **Scriptorium** (deterministic ingestion), **ERG** (explicit relationship graph), and **Webway** (semantic connection layer).

---

## Vision

```
Artifact
  → Scriptorium (structural extraction)
    → ERG (explicit relationship graph)
      → Webway (semantic linking)
        → Knowledge Clusters
          → Knowledge Regions
            → Mental Models
              → Emergent Insights
```

The long-term objective: a **Meaning Linker** capable of discovering non-obvious relationships across domains — without being told what to look for.

Traditional RAG stores chunks and retrieves by similarity.  
MONOLITH grows knowledge regions and reasons over structure.

---

## Boot Sequence

On every session start, read in this order:

1. This file (`AGENTS.md`)
2. `.monolith/context/maps/project-map.md`
3. `.monolith/context/maps/routing-map.md` — classify task type
4. `.monolith/memory/working/active.md` — current phase and story
5. `.monolith/context/maps/roadmap-index.md`
6. `.monolith/protocols/governance/memory-governance.md`
7. Relevant skill from `.monolith/skills/` (resolved via routing-map Table 2)
8. `.monolith/learning/injection-map.md` — load relevant lessons
9. `.monolith/protocols/cognition/cognitive-modes.md` — apply behavioral constraints

Full sequence: `.monolith/protocols/boot/boot-sequence.md`

---

## Navigation

| What                | Where                                                    |
| ------------------- | -------------------------------------------------------- |
| Active story        | `.monolith/memory/working/active.md`                     |
| Project map         | `.monolith/context/maps/project-map.md`                  |
| Routing decisions   | `.monolith/context/maps/routing-map.md`                  |
| Roadmap             | `.monolith/context/maps/roadmap-index.md`                |
| Skills              | `.monolith/skills/INDEX.md`                              |
| Protocols           | `.monolith/protocols/boot/boot-sequence.md`              |
| Lessons             | `.monolith/learning/INDEX.md`                            |
| Governance rules    | `.monolith/governance/`                                  |
| Architecture principles | `.monolith/memory/long-term/architecture-principles.md` |
| Architectural decisions | `.monolith/memory/long-term/decisions.md`           |

---

## Source Structure

| Path                              | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `src/webway/types.ts`             | Core type contracts (Artifact → WebwayAnalysisResult)                |
| `src/webway/analyze.ts`           | `analyzeArtifact()` — deterministic prototype                        |
| `src/webway/index.ts`             | Module barrel export                                                 |
| `src/webway/webway.test.ts`       | Vitest test suite (13 tests)                                         |
| `src/scriptorium/types.ts`        | ScriptoriumInput, ScriptoriumResult, ConceptCandidate, Evidence, ... |
| `src/scriptorium/compile.ts`      | `compileMarkdownArtifact()` — structural extraction pipeline         |
| `src/scriptorium/frontmatter.ts`  | YAML frontmatter parser                                              |
| `src/scriptorium/markdown.ts`     | Heading/content extraction                                           |
| `src/scriptorium/index.ts`        | Module barrel export                                                 |
| `src/scriptorium/scriptorium.test.ts` | Vitest test suite (138 tests)                                    |
| `src/graph/types.ts`              | GraphNode, GraphEdge, ExplicitRelationshipGraph, ...                 |
| `src/graph/builder.ts`            | `buildGraph()` — Pass 1 (nodes) + Pass 2 (edges) + Pass 2.5 (aliases) |
| `src/graph/normalize.ts`          | `normalizeLabel()`, `selectCanonicalLabel()`                         |
| `src/graph/index.ts`              | Module barrel export                                                 |
| `src/graph/graph.test.ts`         | Vitest test suite (see integrity-result.md for count)                |
| `src/index.ts`                    | Package entrypoint — re-exports all three modules                    |

---

## Current Scope

What MONOLITH does today (151 tests passing, typecheck clean):

**Scriptorium** (`compileMarkdownArtifact`):
- Parses YAML frontmatter → extracts `id`, `title`, `type` fields
- Extracts structural headings, content sections, concept candidates, relationship candidates
- Produces `ScriptoriumResult` with `documentId` (from `id:`), `documentTitle` (from `title:`)
- Full determinism — same input always produces identical output

**ERG** (`buildGraph`):
- Pass 1: builds `GraphNode` per compiled document (explicit `id:` required)
- Pass 2: resolves relationship candidates to real node edges (explicit-only, no fuzzy matching)
- Pass 2.5: registers aliases — `id:` → documentId, `title:` → documentTitle; first-document-wins on collision
- Validation: 481 real nodes, 0 synthesized nodes, 32 explicit edges from MONOLITH corpus
- ADR-007: explicit-only identity resolution (no fuzzy matching, no inferred aliases)

**Webway** (`analyzeArtifact`):
- Concept extraction, semantic linking, region assignment, mental model generation
- Deterministic v0 prototype

---

## Out of Scope (current)

The following are explicitly deferred. Do not implement without a finalized story:

- LLM or embedding API calls
- Vector database integration
- Graph database (Neo4j, etc.)
- Terra persistence layer (ADR-006 defines strategy, no implementation)
- Corpus-level pattern learning
- Real semantic similarity (cosine, dot product, etc.)
- UI or API layer
- Engineering Gate runtime (ADR-003 formalized, not implemented)

---

## Architecture Principles

1. **Determinism first** — every capability must be testable before probabilistic layers are added. Frequency extraction before embeddings.
2. **Typed contracts** — TypeScript interfaces are the API. Shape matters more than implementation.
3. **No premature persistence** — in-memory structures first. Storage is a future story.
4. **Module isolation** — each subsystem (`scriptorium`, `graph`, `webway`) is self-contained. Cross-module imports only through `src/index.ts`.
5. **Additive evolution** — existing outputs remain structurally valid when later stories enrich them. No breaking shape changes without a Decision record.
6. **Vertical slice first** — a working end-to-end flow is more valuable than a partially built abstraction.
7. **Explicit-only identity** — ADR-007: aliases only from frontmatter `id:` and `title:`; no fuzzy matching; no inferred aliases. Provenance must be traceable.
8. **TypeScript strict + ESM** — `"type": "module"` in package.json; `strict: true`; no `any`; all imports use `.js` extensions.

---

## Development Philosophy

- One story at a time. No parallel active work.
- Tests before integration. `vitest` is the contract.
- No feature added without a story. No story without a task in `active.md`.
- If the type is wrong, fix the type. Don't work around it.
- Meaning over performance at this stage. Optimize only when the semantics are correct.

---

## Glossary

| Term | Definition |
| ---- | ---------- |
| **Artifact** | A unit of raw information input. The atomic input to WEBWAY. |
| **Concept** | A named semantic unit extracted from an Artifact, with a weight. |
| **SemanticLink** | A directed, typed relationship between two Concepts. |
| **Knowledge Cluster** | A dense local subgraph of strongly related Concepts. (future) |
| **Knowledge Region** | A named domain cluster grouping related Concepts. (4 predefined in v0) |
| **Mental Model** | A higher-order pattern abstraction over a Knowledge Region. |
| **Emergent Insight** | A non-obvious relationship discovered across domains. (future) |
| **Meaning Linker** | The role WEBWAY plays — connecting information by meaning, not keywords. |
| **WebwayAnalysisResult** | The complete output of `analyzeArtifact()`. |
| **MONOLITH** | The cognitive operating system kernel. WEBWAY is its first capability module. |

---

## Success Criteria

### Phase 1 — Cognitive Core & First Evidence (IN PROGRESS)

**Story 1.1 — Cognitive Core Foundation + Webway Dogfood v0** ✅ 2026-06-26
- [x] Webway types + `analyzeArtifact()` implemented and deterministic
- [x] 13 Webway tests passing
- [x] MONOLITH corpus ingested as dogfood

**Story 1.3 — Scriptorium, ERG, and Canonical Identity Resolution** ✅ 2026-06-28
- [x] `compileMarkdownArtifact()` — structural extraction pipeline, 138 tests
- [x] `buildGraph()` — Pass 1 + 2 + 2.5 alias system, explicit-only
- [x] ADR-007: explicit-only identity resolution
- [x] 481 real nodes, 0 synthesized nodes on MONOLITH corpus
- [x] 151 total tests passing, typecheck clean

**Candidate next stories (not decisions):**
- Terra persistence layer (ADR-006 defined, no implementation)
- Corpus relationship density (32 edges / 481 nodes — too sparse)
- Engineering Gate runtime (ADR-003 formalized, not implemented)
- Webway v1 (embedding-based concept extraction, semantic similarity)

### Phase 2+ — NOT DEFINED

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `.monolith/protocols/governance/core-invariants.md` before starting any task.

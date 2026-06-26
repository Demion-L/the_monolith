---
type: context
id: agents-root
topology_role: root
authority: authoritative
---

# WEBWAY — AI Assistant Guide

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

WEBWAY is the cognitive layer of MONOLITH. It is the difference between a document store and a knowledge architecture.

---

## Vision

```
Artifact
  → Concepts
    → Semantic Links
      → Knowledge Clusters
        → Knowledge Regions
          → Mental Models
            → Emergent Insights
```

The long-term objective: a **Meaning Linker** capable of discovering non-obvious relationships across domains — without being told what to look for.

Traditional RAG stores chunks and retrieves by similarity.  
WEBWAY grows knowledge regions and reasons over structure.

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

| Path                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `src/webway/types.ts` | Core type contracts (Artifact → WebwayAnalysisResult) |
| `src/webway/analyze.ts` | `analyzeArtifact()` — deterministic prototype      |
| `src/webway/index.ts` | Module barrel export                                 |
| `src/webway/webway.test.ts` | Vitest test suite (13 tests)                   |
| `src/index.ts`        | Package entrypoint — re-exports everything           |
| `docs/webway-v0.md`   | Webway v0 design document                            |

---

## Current Scope (v0)

What WEBWAY does today:

- **Concept extraction** — tokenizes artifact content, filters stopwords, extracts top-N words by frequency, assigns normalized weights
- **Semantic linking** — creates directed typed links between adjacent top concepts (`relates-to`, `extends`, `depends-on`, rotating)
- **Region assignment** — scores content against 4 predefined knowledge regions and selects the best match
- **Mental model generation** — produces a single pattern description over the assigned region
- **Full determinism** — same input always produces identical output; every behavior is testable

Entry point: `analyzeArtifact(artifact: Artifact): WebwayAnalysisResult`

---

## Out of Scope (v0)

The following are explicitly deferred. Do not implement without a finalized story:

- LLM or embedding API calls
- Vector database integration
- Graph database (Neo4j, etc.)
- Cross-artifact linking (multi-artifact graph)
- Corpus-level pattern learning
- Real semantic similarity (cosine, dot product, etc.)
- Persistent storage of any kind
- UI or API layer

---

## Architecture Principles

1. **Determinism first** — every capability must be testable before probabilistic layers are added. Frequency extraction before embeddings.
2. **Typed contracts** — TypeScript interfaces are the API. Shape matters more than implementation.
3. **No premature persistence** — in-memory structures first. Storage is a future story.
4. **Module isolation** — `webway` is self-contained. It must not import from `init`, `validate`, or `cli`.
5. **Additive evolution** — v0 outputs remain structurally valid when v1 enriches them. No breaking shape changes without a Decision record.
6. **Vertical slice first** — a working end-to-end flow is more valuable than a partially built abstraction.

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

### v0 — Deterministic Foundation (current)
- [x] Core types defined (`Artifact`, `Concept`, `SemanticLink`, `KnowledgeRegion`, `MentalModel`, `WebwayAnalysisResult`)
- [x] `analyzeArtifact()` implemented and deterministic
- [x] 4 knowledge regions with keyword scoring
- [x] 13 passing tests covering all behaviors including edge cases
- [x] Module importable from package entrypoint
- [x] Build clean, zero TypeScript errors

### v1 — Semantic Understanding
- [ ] Embedding-based concept extraction replaces frequency counting
- [ ] Semantic similarity scores replace keyword overlap
- [ ] Concept labels carry embedding vectors
- [ ] Backward-compatible with v0 `WebwayAnalysisResult` shape

### v2 — Connected Knowledge Graph
- [ ] `analyzeCorpus(artifacts[])` builds cross-artifact edges
- [ ] Shared concepts create links between artifacts
- [ ] Knowledge Clusters emerge from graph topology

### v3 — Region Intelligence
- [ ] Knowledge Regions inferred from corpus, not predefined
- [ ] Regions evolve as new artifacts arrive

### v4 — Emergent Insights
- [ ] Cross-domain pattern recognition
- [ ] Non-obvious relationships surface across regions
- [ ] WEBWAY can answer: "How does X relate to Y?"

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `.monolith/protocols/governance/core-invariants.md` before starting any task.

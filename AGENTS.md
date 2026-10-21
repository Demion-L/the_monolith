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

**Portable Project Knowledge & Governance Toolkit for AI-Assisted Development.**

MONOLITH helps a human and an AI assistant preserve a shared understanding of a
project — its knowledge, architectural decisions, and progress — across
sessions, by structurally extracting and linking the project's own markdown
artifacts rather than relying on an AI's unaided memory.

Its core consists of two subsystems now active in this repository:
**Scriptorium** (deterministic structural extraction) and **ERG**
(explicit relationship graph). **Webway** (frequency-based semantic
concept-linking) was an earlier, orthogonal research track with no runtime
coupling to Scriptorium/ERG; it was extracted into its own repository — see
`Current Scope`.

> **Note on framing (resolved 2026-10-21):** `MANIFESTO.md` previously
> described MONOLITH as a *research platform* studying cognitive
> architecture, with Scriptorium/ERG framed as an emerging "Cognitive
> Kernel" product alongside Terra, Graph Memex, and WEBWAY. That framing
> and this toolkit-oriented mission statement were in tension. `MANIFESTO.md`
> was rewritten to the toolkit mission above; the cognitive-architecture
> research program (Terra, Graph Memex, the Cognitive Kernel vision, and
> `docs/architecture/cognitive-infrastructure.md`) moved to
> [Webway](https://github.com/Demion-L/webway) — see `docs/adr/README.md`.

---

## Vision

```
Markdown artifact
  → Scriptorium (structural extraction)
    → ERG (explicit relationship graph)
      → governed project memory (working/long-term, ADRs, roadmap)
```

The objective is not similarity-based retrieval. It is an explicit,
inspectable graph of what a project decided and why — every edge traceable
to a declared frontmatter field, never inferred (ADR-007).

Webway, developed separately ([github.com/Demion-L/webway](https://github.com/Demion-L/webway)),
pursues a related but distinct goal: discovering non-obvious semantic
relationships across knowledge domains via a frequency/embedding-based
"Meaning Linker." It is not part of MONOLITH's own roadmap.

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
| `src/coordinatorium/types.ts`     | `CoordinatoriumState`, `Mission`, schema version                     |
| `src/coordinatorium/state-keeper.ts` | `readState()`, `mutateState()` — lock + atomic write + validation |
| `src/coordinatorium/lock.ts`      | Cross-process file lock with stale-lock recovery                     |
| `src/coordinatorium/mission.ts`   | `startMission()`, `listMissions()`, `getMission()`, `finishMission()` |
| `src/coordinatorium/cli.ts`       | `monolith mission` command handlers                                  |
| `src/coordinatorium/*.test.ts`    | Vitest test suite (31 tests, incl. real multi-process concurrency)   |
| `src/index.ts`                    | Package entrypoint — re-exports Scriptorium, Graph, Coordinatorium   |

---

## Current Scope

What MONOLITH does today (138 tests passing, typecheck clean):

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

**Webway** (`analyzeArtifact`) — extracted to its own repository:
- Originally Story 1.1's deterministic frequency-based concept extraction / semantic linking prototype
- Had zero runtime coupling to Scriptorium/ERG; now developed independently at https://github.com/Demion-L/webway
- Historical record: `docs/webway-v0.md`

**Coordinatorium — Tactical Mission Lifecycle** (first vertical slice, ADR-008):
- `.monolith/state.json` — canonical, schema-versioned project state (`schemaVersion`, `revision`, `strategic.systems` reserved, `tactical.missions`)
- `monolith mission start|list|show|finish` — register and close out missions; see Mission Lifecycle section below
- Deterministic State Keeper: cross-process file lock + atomic write, no lost updates, no LLM/database/background service involved
- Strategic Coordinatorium (product/subsystem state) is **not implemented** — schema-reserved only

---

## Mission Lifecycle (Coordinatorium v0.1)

```
monolith mission start --title "..." --system "..."
monolith mission list
monolith mission show <id>
monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
```

This records development missions in `.monolith/state.json`, independent of
any single AI session's memory. **This is not runtime-enforced in v0.1:**
nothing prevents an AI session from editing code without ever calling
`mission start`/`finish`. It is a recommended discipline, not a gate. Full
rationale: ADR-008 (`docs/adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md`).

---

## Out of Scope (current)

The following are explicitly deferred. Do not implement without a finalized story:

- LLM or embedding API calls
- Vector database integration
- Graph database (Neo4j, etc.)
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
| **MONOLITH** | Portable project knowledge and governance toolkit for AI-assisted development. |
| **Scriptorium** | Deterministic structural extraction from a markdown artifact: `ScriptoriumInput` → `ScriptoriumResult` (`ConceptCandidate`, `RelationshipCandidate`, `Evidence`, `SourceReference`). |
| **Explicit Relationship Graph (ERG)** | The typed graph (`GraphNode`, `GraphEdge`) built from compiled documents; edges resolve only from explicit frontmatter fields — no fuzzy matching (ADR-007). |
| **Coordinatorium** | Tactical mission lifecycle: `Mission`, `CoordinatoriumState`, backed by `.monolith/state.json` (ADR-008). |
| **Instance** | A project-specific MONOLITH deployment with its own `project.definition.mjs`. |
| **Webway** | A separate, independently developed project (not part of MONOLITH) pursuing semantic/associative knowledge linking. See `docs/webway-v0.md` and [github.com/Demion-L/webway](https://github.com/Demion-L/webway). |

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

**COORDINATORIUM-001 — Tactical Mission Lifecycle (First Vertical Slice)** — implemented 2026-10-21, pending review/finalization
- [x] Deterministic State Keeper (`.monolith/state.json`) — lock + atomic write, no lost updates
- [x] `monolith mission start|list|show|finish` CLI
- [x] ADR-008: Coordinatorium — Tactical Mission Lifecycle
- [x] 31 tests (incl. real multi-process concurrency), 169 total passing
- [ ] Strategic Coordinatorium — not in scope for this slice
- [x] 481 real nodes, 0 synthesized nodes on MONOLITH corpus
- [x] 151 total tests passing, typecheck clean

**Candidate next stories (not decisions):**
- Corpus relationship density (32 edges / 481 nodes — too sparse)
- Engineering Gate runtime (ADR-003 formalized, not implemented)
- Webway v1 (embedding-based concept extraction, semantic similarity)

### Phase 2+ — NOT DEFINED

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `.monolith/protocols/governance/core-invariants.md` before starting any task.

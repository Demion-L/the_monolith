---
type: architecture
id: toolkit-pipeline
authority: authoritative
stability: stable
last_updated: 2026-10-28
related_adrs:
  - ADR-020
  - ADR-008
---

# Toolkit Pipeline

How a project's own markdown artifacts become structured, governed memory
in a MONOLITH instance today. Describes only what is implemented in `src/`
and `.monolith/` — no future vision, no research narrative.

This document replaces `knowledge-pipeline.md`, which described a much
larger, mostly unimplemented "Cognitive Kernel" pipeline (Terra, Learning
Layer automation, a sleep pipeline) and has moved, together with the rest
of that research program, to
[Webway](https://github.com/Demion-L/webway) — see
`docs/adr/README.md` for why.

---

## Pipeline Overview

```
Markdown artifact (frontmatter + headings + links)
     │
     ↓
  Scriptorium — compileMarkdownArtifact()
     │   structural extraction: object declarations (documentId, {#ID} sections),
     │   concept candidates, relationship candidates (from frontmatter fields)
     ↓
  Explicit Relationship Graph — buildGraph()
     │   Pass 1: declarations (document id:, section {#ID}) → KnowledgeObjects, ref = namespace:localId
     │   Pass 2: a ref declared more than once is an identity conflict, not a node
     │   Pass 3: relationship candidates → edges, only when the target RESOLVES
     ↓
  Working memory (.monolith/memory/working/) — read and updated during a story
     │
     ↓  on story finalization
  finalize-story skill (manual, skill-driven)
     │
     ├──→  Long-term memory (.monolith/memory/long-term/execution-history.md)
     └──→  Session handoff (.monolith/context/boot/HANDOFF.md)
```

Separately, `monolith mission start|list|show|finish|checkpoint|checkpoints`
(Coordinatorium, ADR-008) records tactical mission lifecycle and progress
checkpoints in `.monolith/state.json`, independent of this document
pipeline — see `AGENTS.md` → Mission Lifecycle.

Also separate from the Scriptorium/ERG pipeline: `monolith brief` (CONTEXT-001A)
is a read-only summary command over `state.json`, `active.md`, and
frontmatter-discovered protocols/ADRs. It does not use Scriptorium's
`compileMarkdownArtifact()` or the ERG; it reuses only Scriptorium's
frontmatter parser. See `AGENTS.md` → Project Brief.

---

## Stage 1 — Scriptorium (ingestion)

**What enters:** A project's own markdown artifacts — ADRs, memory files,
protocols, any file with YAML frontmatter.

**What it does:** `compileMarkdownArtifact()` parses frontmatter (`id:`,
`title:`, `type:`), extracts headings and content sections, and produces
concept candidates and relationship candidates from frontmatter fields
(`related_adrs`, `related_research`, `follow_up_adrs`, etc.) and inline
links.

**What it does NOT do:** No LLM inference. No external database. No
modification of the source document. Determinism is the design goal —
`src/scriptorium/compile.ts`.

---

## Stage 2 — Explicit Relationship Graph (ERG)

**What it does:** `buildGraph()` turns compiled documents into a typed
graph. A node is a `KnowledgeObject` with identity `namespace:localId`: a
document (frontmatter `id:`) or a section (heading marker `{#ID}`). The
namespace is supplied by the caller. An edge exists only when a relationship's
target resolves to exactly one object; everything else is kept as an
unresolved reference (`MISSING`, `AMBIGUOUS`, `EXTERNAL_UNAVAILABLE`,
`INVALID_REF`) and a duplicate declaration is reported as an identity
conflict (`src/graph/identity.ts`, `resolver.ts`, `builder.ts`).

**Explicit-only identity (ADR-020, which supersedes ADR-007):** no fuzzy
matching, no aliases, no synthetic nodes, no first-wins — every node and
every edge traces to a declaration in the source.

**Corpus statistics:** not recorded in this document. `pnpm dogfood-graph`
prints them for any directory and namespace; it is read-only and writes no
file. Resolving this repository's own corpus (namespace configuration,
unresolved references, mirrored-corpus conflicts, the YAML parser, missing
`{#ID}` markers) is separate technical work.

---

## Stage 3 — Working Memory

During a story, the AI assistant reads and writes `.monolith/memory/working/`
to track current state: active story (`active.md`), story index, and (where
applicable) governance/integrity results. All reads are routed through
`context/maps/routing-map.md` (which memory regions to load for a task
type) and `context/maps/semantic-map.md` (which file is authoritative for a
given question).

---

## Stage 4 — Consolidation (finalize-story)

**What triggers it:** Explicit story finalization via the `finalize-story`
skill — manual, not automated.

**What it does:** writes a story capsule, updates the active story pointer,
appends to `execution-history.md`, records ADRs in the ADR Index (`docs/adr/README.md`), updates `story-index.md`, and writes the session handoff.

**What it does NOT do:** no automated promotion by access count or
staleness, no automated pruning, no background consolidation pass. A
formal sleep-pipeline / Terra-style consolidation was researched and
proposed (`webway:ADR-006`) but is not part of this toolkit — that research now
continues under Webway.

---

## Stage 5 — Long-Term Memory

**What is stored:** decisions, architecture principles, tech debt,
execution history — the artifacts that survive story finalization.

**Governance:** authoritative; written only by `finalize-story`;
`execution-history.md` is append-only.

---

## Cross-Pipeline Invariants

1. **Determinism** — every stage produces the same output given the same input. No LLM inference in Scriptorium, ERG, or routing.
2. **Inspectability** — every artifact at every stage is a human-readable file.
3. **Single Source of Truth** — each fact has exactly one authoritative location (`context/maps/semantic-map.md`).
4. **Append-Only History** — `execution-history.md` grows; it is never rewritten.
5. **Explicit-only identity** — graph nodes and edges come only from declared identities and references; unresolved stays unresolved (ADR-020).

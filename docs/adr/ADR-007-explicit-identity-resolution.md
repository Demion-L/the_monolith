---
type: adr
id: ADR-007
title: Explicit-Only Identity Resolution in the Explicit Relationship Graph
status: accepted
date: 2026-06-28
related_adrs:
  - ADR-004
  - ADR-005
---

# ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph

---

## Context

The Explicit Relationship Graph (ERG) resolves typed edges between documents by matching `fromLabel` and `toLabel` strings to node IDs in the graph. Node IDs are derived by normalizing concept labels extracted from document headings and list items via Scriptorium.

During the Story 1.3 dogfood experiment, a systematic identity mismatch was discovered:

- MONOLITH documents reference each other using short-form IDs: `ADR-004`, `R-0001`, `ADR-006`.
- The same documents produce nodes identified by their H1 heading text: `terra-vs-graph-memex`, `lessons-learned-from-iai-personal-memory-engine`, `terra-persistence-strategy`.
- These two identifier namespaces do not overlap. All 12 relationship edges in the initial corpus failed to resolve to real nodes — 100% synthesized placeholders.

The resolution strategy for this mismatch is the core decision.

---

## Decision

**Identity resolution in the ERG uses only explicit frontmatter metadata. No fuzzy matching, no embeddings, no probabilistic resolution.**

Concretely:

1. Scriptorium extracts two fields from each document's frontmatter: `id:` (e.g. `ADR-004`) and `title:` (e.g. `Terra vs Graph Memex`). These are returned as `documentId` and `documentTitle` on the `ScriptoriumResult`.

2. `buildGraph()` runs a Pass 2.5 after concept nodes are built: for each result, it locates the document's primary node (the H1 heading concept), then registers `normalizeLabel(documentId)` and `normalizeLabel(documentTitle)` as aliases pointing to that node.

3. Aliases are stored on the `GraphNode.aliases` array. The canonical label remains the H1 heading text. Aliases are display-level metadata only.

4. Pass 3 (relationship resolution) resolves `fromLabel` and `toLabel` through the alias map before synthesizing new nodes.

5. **Collision rule:** if two documents claim the same alias, the first document processed wins. A diagnostic is emitted. No exception is thrown.

6. **No alias is registered without an explicit frontmatter source.** There is no fallback to filename similarity, edit distance, substring matching, or any probabilistic signal.

---

## Rationale

### Why explicit-only

The Explicit Relationship Graph is named for its provenance model: relationships are explicit when they are declared in document frontmatter. The identity resolution system must maintain the same provenance guarantee. If aliases were inferred by fuzzy matching, a relationship edge that appears explicit (declared in frontmatter) would depend on a non-transparent heuristic to find its target. This would violate the auditable-provenance invariant established in ADR-004.

### Why not embeddings

Embedding-based similarity would find `ADR-004` → `Terra vs Graph Memex` with high confidence. It would also find false positives: documents with similar titles that are not the same document. More importantly, the query "is this the same document?" has a deterministic answer available in the frontmatter (`id:` field). Using embeddings where a deterministic answer is available adds cost, non-determinism, and a dependency on a model that can change over time.

### Why not filename-based matching

`ADR-004` could be matched to `ADR-004-terra-vs-graph-memex.md` by filename prefix. This would work for the current corpus but would break for any document whose short ID does not appear in its filename. It also creates coupling between the resolution logic and file naming conventions — coupling that is not declared anywhere in the document schema.

### Why first-document-wins on collision

A collision (two documents claiming the same alias) is a documentation error, not a resolution ambiguity the system should silently resolve. The first-wins rule produces deterministic output and emits a diagnostic. It does not attempt to guess which document is "more correct."

---

## Alternatives Considered

### Fuzzy / edit-distance matching

**Rejected.** Non-deterministic. Returns different results as corpus grows. Cannot be audited without re-running the matcher. Violates ERG's explicit-provenance invariant.

### Embedding cosine similarity

**Rejected.** Requires model dependency at build time. Non-deterministic across model versions. Overkill when a deterministic answer is available in frontmatter.

### Filename-prefix matching (`ADR-004` → `ADR-004-*.md`)

**Rejected.** Couples resolution to a file naming convention not declared in schema. Breaks if file is renamed without updating references.

### Bidirectional alias lookup (register both directions)

**Considered and deferred.** Registering `ADR-004 → terra-vs-graph-memex` and `terra-vs-graph-memex → ADR-004` would allow references from either direction. The current corpus only uses short IDs in relationship fields, so the reverse direction is not needed. Can be added if the pattern emerges.

---

## Consequences

**Becomes easier:**
- All relationship edges with explicit `id:` + `title:` in frontmatter resolve to real nodes deterministically.
- Alias provenance is auditable: every alias traces to a specific frontmatter field in a specific document.
- Resolution behavior does not change as the corpus grows.

**Becomes harder:**
- Documents without `id:` or `title:` frontmatter fields produce no aliases. References to them using short IDs will synthesize placeholder nodes.
- Renaming a document's `id:` field silently breaks existing references from other documents (no referential integrity check).

**Mitigated by:**
- Scriptorium emits diagnostics for all synthesized nodes, making missing aliases visible in the dogfood report.
- ADR-005 (Lexicon Mechanicus) establishes naming conventions that reduce ID drift.

---

## Validation

Story 1.3 dogfood results before and after this decision:

| Metric                 | Before (v1.1) | After (v1.2) |
| ---------------------- | ------------- | ------------ |
| Graph edges            | 32            | 32           |
| Synthesized nodes      | 12            | 0            |
| Real-to-real edges     | 13%           | 100%         |
| Test coverage          | 119 tests     | 138 tests    |

Report: `.monolith/reports/graph-dogfood-v1-2.md`

---

## References

- ADR-004 — Terra vs Graph Memex (ERG as complementary layer, explicit-provenance model)
- ADR-005 — Lexicon Mechanicus (canonical terminology, ID conventions)
- `src/graph/builder.ts` — Pass 2.5 implementation
- `src/scriptorium/compile.ts` — `documentId` / `documentTitle` extraction
- `src/scriptorium/types.ts` — `ScriptoriumResult.documentId`, `ScriptoriumResult.documentTitle`

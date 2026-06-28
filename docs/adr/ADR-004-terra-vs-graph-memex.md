---
type: adr
id: ADR-004
title: Terra vs Graph Memex
status: accepted
date: 2026-06-28
research:
  - R-0001
  - R-0002
related_adrs:
  - ADR-006
---

# ADR-004 — Terra vs Graph Memex

---

## Context

MONOLITH's memory is currently stored as flat markdown files with frontmatter, organized by stability tier (working / long-term / errors). As the system matures, two competing architectural directions emerged for the memory persistence substrate:

1. **Terra** — a structured persistence layer with schema-enforced storage, lifecycle management, and consolidation primitives
2. **Graph Memex** — a graph-based associative memory system where all memories are nodes connected by typed edges, with navigation driven by traversal

The choice between these two directions has significant consequences for the memory architecture, the sleep pipeline (R-0001), the oracle retrieval model (R-0002), and the long-term vision for cognitive infrastructure.

---

## Decision

**Terra is the chosen persistence strategy.**

Graph Memex is not adopted as the primary substrate. Graph-based relationships remain as a complementary layer (the Explicit Relationship Graph) but do not replace the structured document store.

---

## Rationale

### Terra advantages

1. **Deterministic retrieval** — Terra's schema-based model allows the routing-map's memory region declarations to remain exact: load file X to get fact Y. This preserves MONOLITH's deterministic retrieval invariant.

2. **Lifecycle management** — Terra can enforce the IAI-inspired memory lifecycle (active → consolidating → long-term → archived) through schema constraints and transition rules. A graph substrate makes lifecycle management harder because lifecycle state is a property of a node, not a property of an edge, and graph traversal does not naturally express lifecycle transitions.

3. **Oracle compatibility** — R-0002 established that the oracle pattern requires a clean read/write separation and an authority-ranked retrieval interface. Terra provides a structured write layer below the oracle. A graph substrate blurs the read/write boundary (graph mutations and graph queries use the same edge traversal primitives).

4. **Inspectability** — Terra artifacts remain human-readable documents with frontmatter. This preserves the ability for developers to inspect, edit, and debug memory directly without tooling. A graph database would require a query interface to inspect state.

5. **Incrementality** — Terra can be introduced incrementally without replacing the existing file-based memory system. Files become Terra artifacts by adding schema-enforced frontmatter. Graph Memex would require a more disruptive migration.

### Graph Memex limitations

1. **Non-deterministic traversal** — Graph traversal paths are not uniquely determined by schema. Two traversals from the same starting node may return different results depending on edge weights, traversal strategy, and graph state at query time.

2. **Authority resolution complexity** — In a graph, authority is a property of nodes and edges that must be computed from the graph structure. In Terra, authority is declared in frontmatter and resolved by the semantic-map. Terra's approach is simpler and more auditable.

3. **Premature complexity** — The graph structure is most valuable when the corpus of memories is large enough that traversal provides retrieval advantages over direct lookup. MONOLITH's current memory corpus is small. Graph Memex introduces infrastructure complexity before the need is established.

---

## Alternatives Considered

### Full Graph Memex adoption

**Rejected.** Non-deterministic retrieval contradicts MONOLITH's enforcement model. Authority resolution through graph traversal is more complex than frontmatter declaration. Premature for current corpus size.

### Hybrid (Terra + Graph Memex as co-equal stores)

**Rejected.** Two co-equal stores create authority conflicts: which store wins when the two disagree? The complexity of conflict resolution outweighs the benefits of having both.

### Flat file system only (no Terra)

**Rejected.** The current flat file system has no lifecycle enforcement, no consolidation primitives, and no schema validation. As MONOLITH scales, the absence of a structured persistence layer creates drift and stale memory. Terra is necessary for long-term viability.

---

## Consequences

**Becomes easier:**
- Memory lifecycle management (Terra enforces state transitions)
- Schema validation at memory write time
- Authority declaration (frontmatter, not graph traversal)
- Incremental adoption (existing files become Terra artifacts)

**Becomes harder:**
- Associative discovery (graph traversal is better for "what's related to X?" queries)
- Dynamic linking (explicit relationships require manual declaration, not automatic edge creation)

**Mitigated by:**
The Explicit Relationship Graph (a Phase 1 deliverable) provides associative navigation on top of Terra's structured store. The graph is a complementary layer, not a competing substrate.

---

## References

- Research: `docs/research/R-0001-iai-personal-memory-engine.md` — sleep pipeline and lifecycle motivation
- Research: `docs/research/R-0002-oracle-memory-systems.md` — read/write separation and oracle pattern
- Architecture: `docs/architecture/memory-architecture.md`
- Related ADR: `docs/adr/ADR-006-terra-persistence-strategy.md` — Terra implementation details

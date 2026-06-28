---
type: research
id: R-0002
title: Oracle Memory Systems
status: complete
date: 2026-06-28
follow_up_adrs:
  - ADR-004
  - ADR-006
related_research:
  - R-0001
  - R-0003
---

# R-0002 — Oracle Memory Systems

---

## Executive Summary

Oracle Memory Systems represent a class of AI memory architectures where a single authoritative retrieval layer — the "oracle" — answers queries about past knowledge with high confidence and minimal latency. Analysis of oracle-style systems revealed a fundamental tension between retrieval authority and memory freshness. The key insight for MONOLITH is the distinction between the oracle layer (authoritative retrieval) and the write layer (where new knowledge enters the system). These must be decoupled. MONOLITH's semantic-map and routing-map already embody an oracle-like pattern at the context level; extending this to the memory persistence layer is the primary outcome of this research.

---

## Background

**Concept analyzed:** Oracle Memory Systems — memory architectures designed around the principle of a single authoritative retrieval point. The "oracle" pattern is drawn from database theory (oracle databases) and cognitive architecture (the idea of an authoritative ground-truth memory store distinct from working memory).

**Why analyzed:** MONOLITH's memory is currently segmented by stability (working, long-term, errors) but has no unified retrieval interface. An AI assistant reading MONOLITH memory must navigate multiple files and resolve authority conflicts manually. An oracle-style retrieval layer would eliminate this cognitive overhead and reduce context-loading errors.

---

## Key Ideas

1. **Single Retrieval Point** — A unified query interface that resolves which memory artifact contains the authoritative answer to a given question, regardless of where that artifact physically lives.
2. **Read Path / Write Path Separation** — The retrieval layer is entirely separate from the ingestion layer. This prevents write-path latency from affecting read-path performance, and allows the read path to be optimized independently.
3. **Authority Ranking** — When multiple memory artifacts could answer a query, the oracle ranks them by authority and returns the highest-authority response. Lower-authority responses are returned only if no higher-authority source exists.
4. **Freshness Decay** — Memory authority degrades over time unless explicitly refreshed. The oracle tracks when each memory was last verified and adjusts its authority ranking accordingly.
5. **Provenance Chain** — The oracle records which source artifact answered each query. This creates an audit trail for memory usage and enables debugging when a query returns a stale answer.
6. **Closed-World Assumption** — If the oracle has no answer, it returns a structured "unknown" signal rather than inferring from context. This prevents hallucination at the retrieval layer.
7. **Open-World Extension** — A variant where the oracle can signal that an answer exists outside the current memory corpus and should be sought from an external source (web, document store, etc.).
8. **Memory Shards** — Partitioning memory by domain so the oracle can route queries to domain-specific shards without scanning the full corpus.
9. **Query Expansion** — Automatically broadening a narrow query to include semantically related terms, increasing recall at the cost of precision.
10. **Retrieval Confidence** — The oracle returns a confidence score alongside each answer, allowing the caller to decide whether to proceed or request clarification.

---

## Confirmed Ideas

### Read Path / Write Path Separation

MONOLITH's routing-map already embodies this separation at the context level: reading and writing have different cognitive modes (`exploration` vs `implementation`). Extending this principle to the memory substrate means the retrieval interface (semantic-map) and the write interface (finalize-story skill) should never be the same operation.

**Status:** Separation exists at the cognitive mode level. Not yet formalized at the storage layer.

### Authority Ranking

MONOLITH's frontmatter `authority: authoritative` field is a binary authority marker. The oracle model suggests a more nuanced ranking. MONOLITH's semantic-map already implements authority routing (each domain has a single authoritative source). The principle is confirmed.

**Status:** Binary authority implemented. Ranking between multiple sources is not yet formalized.

### Closed-World Assumption

MONOLITH's memory governance rule 3 (Single Source of Truth) is a closed-world assumption at the document level: each fact has exactly one authoritative location. If the system cannot find a fact in the declared authoritative location, it should not infer from other sources.

**Status:** Enforced as a governance rule. Not yet enforced at the retrieval protocol level.

### Memory Shards (as Knowledge Regions)

Oracle sharding maps directly onto MONOLITH's Knowledge Regions concept. Each region is a shard with its own authority source and lifecycle. The routing-map's memory region table is the first implementation of domain-based sharding.

**Status:** Knowledge Regions implemented via routing-map Table 4.

---

## New Ideas Worth Exploring

### Retrieval Confidence on Memory Artifacts

Returning a confidence score alongside a memory retrieval would allow AI sessions to know when a memory is likely stale or unverified. This is complementary to R-0001's Honest Degradation concept.

**Potential implementation:** A `confidence:` field in memory frontmatter, degraded by a staleness heuristic based on `last_verified` date.

### Provenance Chain for Query Audit

MONOLITH currently has an execution history log (`memory/long-term/execution-history.md`) but no query-level audit trail. Recording which memory artifact answered which query during a session would enable post-session analysis of memory access patterns.

**Potential implementation:** A session query log written during boot and cleared on finalization.

### Structured "Unknown" Signal

When MONOLITH cannot find an authoritative memory for a query, the current behavior is undefined — the AI assistant may infer or guess. Formalizing a structured "unknown" response (e.g., a governance signal that forces clarification before proceeding) would reduce hallucination risk.

**Potential ADR:** An unknown-memory governance rule.

### Open-World Extension for External Sources

For queries that cannot be answered from internal memory, MONOLITH could signal that the answer should be sought from an external source (web search, documentation, etc.) rather than refusing or guessing. This would integrate with the hybrid-execution protocol.

---

## Ideas Rejected

### Query Expansion

Automatic semantic expansion of queries increases recall at the cost of precision and adds non-determinism. MONOLITH's protocol system is explicitly deterministic. Query expansion is incompatible with the deterministic routing model.

**Reason rejected:** Non-deterministic. Contradicts enforcement determinism.

### Retrieval as a Service

Some oracle architectures expose memory retrieval as a network service (HTTP or gRPC endpoint). For MONOLITH, which operates inside an AI assistant session without network infrastructure, this is not applicable. Memory retrieval must be file-based and local.

**Reason rejected:** Infrastructure requirement incompatible with MONOLITH's deployment model (file-based, no server).

---

## Research Outcomes

### Semantic Map as Oracle Interface

The analysis confirmed that MONOLITH's `context/maps/semantic-map.md` already functions as a lightweight oracle: it declares where authoritative truth lives for each semantic domain. This is the read-path interface. The research validated that this design is sound and should be extended as memory complexity grows, not replaced.

### Knowledge Region Formalization

The oracle sharding concept provided a formal vocabulary for what MONOLITH's routing-map Table 4 describes informally. The research outcome was a clearer definition of Knowledge Regions as domain-scoped memory shards with declared authority sources.

### Terra as Oracle Backend

The oracle model's read/write separation clarified Terra's role: Terra is the write-path persistence layer. The read-path oracle (semantic-map + routing-map) sits above Terra and is independent of how Terra stores data. This separation was incorporated into ADR-006.

See `ADR-006` for Terra persistence strategy.

---

## Follow-up ADRs

| ADR       | Title                        | Relationship                                              |
| --------- | ---------------------------- | --------------------------------------------------------- |
| ADR-004   | Terra vs Graph Memex         | Storage substrate for oracle backend                      |
| ADR-006   | Terra Persistence Strategy   | Read/write separation design                              |

---

## Open Questions

1. Should the semantic-map be machine-readable (YAML/JSON) to enable programmatic oracle queries, or remain human-readable markdown?
2. What is the correct staleness threshold for memory freshness decay — session count, calendar days, or story count?
3. Should the "unknown" signal be a governance rule or a protocol?
4. Can the query audit trail be implemented without adding overhead to the boot sequence?

---
type: research
id: R-0001
title: Lessons Learned from IAI Personal Memory Engine
status: complete
date: 2026-06-28
follow_up_adrs:
  - ADR-004
  - ADR-005
related_research:
  - R-0002
  - R-0003
---

# R-0001 — Lessons Learned from IAI Personal Memory Engine

---

## Executive Summary

The IAI Personal Memory Engine is a long-term AI memory system designed around biologically-inspired memory lifecycle management. Analysis revealed a set of structural ideas directly applicable to MONOLITH's memory layer, particularly the concept of a sleep pipeline for memory consolidation, explicit lifecycle states for memory entries, and community detection for grouping related memories. Several ideas were adopted into MONOLITH's architecture. A smaller set was rejected as over-engineered or misaligned with MONOLITH's deterministic governance model.

---

## Background

**System analyzed:** IAI Personal Memory Engine — a persistent memory system for AI assistants that manages memory over time using biologically-inspired consolidation mechanics.

**Why analyzed:** MONOLITH's memory layer (working, long-term, errors) was designed without a formal lifecycle or consolidation strategy. As the system scales across sessions and projects, the absence of lifecycle mechanics creates drift, stale memory, and unbounded memory growth. This analysis was undertaken to identify whether IAI's approach offered applicable patterns.

---

## Key Ideas

The following ideas were encountered during analysis:

1. **Sleep Pipeline** — A background process that consolidates, promotes, and prunes memories outside of active session time. Analogous to biological sleep-phase memory consolidation.
2. **Memory Lifecycle** — Explicit states: `active → consolidating → long-term → archived → forgotten`. Each state has defined transition criteria.
3. **Forgetting as Feature** — Deliberate, policy-driven pruning of low-relevance memories. Forgetting is not a failure; it is how the system stays coherent.
4. **Community Detection** — Graph-based clustering of related memories. Memories in the same community share context and can be promoted or pruned together.
5. **Pattern Separation** — When two memories are too similar, one is generalized and the other pruned to prevent interference.
6. **Provenance Tracking** — Every memory records its origin: which session created it, which document sourced it, and which agent wrote it.
7. **Contradiction Layer** — A dedicated sub-system that detects when a new memory conflicts with an existing one, and resolves the conflict explicitly rather than silently overwriting.
8. **Reconsolidation** — When a memory is retrieved and used, it re-enters a plastic state and can be modified. This is a mechanism for correction over time.
9. **Essential Variables** — A small set of memories classified as invariant — they are never pruned regardless of relevance scores.
10. **Honest Degradation** — The system signals when its confidence in a memory is low, rather than presenting uncertain memories as authoritative.
11. **Memory Palace** — A spatial metaphor for organizing memory. Memory is laid out in a virtual "place" with navigational affordances.
12. **Profile Knobs** — User-facing settings to tune memory retention aggressiveness (e.g., "aggressive pruning", "conservative retention").
13. **LLM Tier-1 Schema** — Using a large language model to classify and structure all incoming memories at ingestion time.

---

## Confirmed Ideas

Ideas adopted because they align with MONOLITH's direction:

### Sleep Pipeline

MONOLITH's memory system currently operates only during active sessions. A sleep pipeline — a consolidation pass that runs after story finalization — would promote important decisions from working memory to long-term memory and prune stale working state. This is directly analogous to MONOLITH's existing working/long-term memory separation but adds an explicit consolidation trigger.

**Status:** Partially implemented via the `finalize-story` skill (which promotes decisions to `memory/long-term/`). A formal consolidation pipeline is a future evolution.

### Memory Lifecycle

Explicit lifecycle states per memory artifact are well-aligned with MONOLITH's existing stability classifications (`volatile`, `stable`, `authoritative`). The IAI model extends this with transition criteria, which MONOLITH currently lacks.

**Status:** The stability field exists. Transition criteria are not yet formalized.

### Forgetting as Feature

MONOLITH's memory governance currently has no pruning mechanism. The principle that forgetting is intentional — not a failure — validates the direction of adding memory deprecation to the governance protocol.

**Status:** Adopted as a principle. Not yet implemented as a protocol.

### Community Detection

The concept of grouping related memories into communities directly motivated MONOLITH's Knowledge Regions concept — semantic groupings of memory that can be loaded, promoted, or archived together.

**Status:** Knowledge Regions are defined in the architecture. Community detection as an automated clustering mechanism is future work.

### Pattern Separation

The idea that similar memories should be generalized rather than duplicated aligns with MONOLITH's Single Source of Truth invariant. When two memory entries encode the same fact, one should be canonical and the other removed.

**Status:** Enforced as a governance rule (Rule 3: Single Source of Truth). Automated detection is future work.

---

## New Ideas Worth Exploring

Ideas not yet implemented but worth future investigation:

### Provenance Tracking

Every memory artifact in MONOLITH should carry a `provenance` field: which story created it, which session date, and which agent wrote it. Currently, this is captured partially via story IDs in memory frontmatter but not systematically enforced.

**Potential ADR:** A future ADR on Memory Provenance Schema.

### Contradiction Layer

MONOLITH currently has no mechanism for detecting when a new memory contradicts an existing one. The `integrity-result.md` checks for structural integrity but not semantic contradiction. A contradiction detection layer would prevent silent semantic drift.

**Potential ADR:** Could evolve from ADR-006 (Terra Persistence Strategy) if Terra includes contradiction detection.

### Reconsolidation

The idea that retrieved and used memories become plastic again is relevant to MONOLITH's error learning cycle. When a lesson from `learning/mistakes/` is activated and fails to prevent a repeat mistake, that lesson should re-enter a reviewable state.

**Potential integration:** Self-improvement skill reconsolidation pass.

### Essential Variables

MONOLITH already has the concept of invariants (`protocols/governance/core-invariants.md`), but at the protocol level. Applying the same concept to memory artifacts — a set of memories classified as never-prunable — would be a useful extension.

**Potential implementation:** A `protected: true` frontmatter flag.

### Honest Degradation

MONOLITH currently presents all memory as equally authoritative within its stability classification. A confidence or freshness indicator on memory entries would allow the system to signal when a memory is old, unverified, or potentially stale.

**Potential implementation:** A `confidence:` frontmatter field with values `high | medium | low | stale`.

---

## Ideas Rejected

Ideas explicitly not carried forward:

### Memory Palace

The spatial metaphor for memory navigation is aesthetically compelling but adds cognitive load without corresponding benefit for a text-based AI operating system. MONOLITH's map-based navigation (`context/maps/`) achieves navigability without spatial metaphor.

**Reason rejected:** Adds complexity. No evidence of improved recall or navigation in text-based AI systems.

### Profile Knobs

User-facing tuning of memory retention creates inconsistent behavior between users and sessions. MONOLITH's governance model is deterministic — the same rules apply in every instance. Per-user tuning undermines this invariant.

**Reason rejected:** Contradicts MONOLITH's deterministic governance model.

### LLM Tier-1 Schema

Using an LLM to classify all incoming memories at ingestion time introduces latency, non-determinism, and cost at the memory write path. MONOLITH's governance requires deterministic protocol enforcement; an LLM classification step would be a non-deterministic gate.

**Reason rejected:** Non-deterministic. Contradicts enforcement determinism. Adds cost at every memory write.

---

## Research Outcomes

What actually changed inside MONOLITH because of this research:

### Scriptorium

The analysis of IAI's ingestion pipeline directly motivated the Scriptorium — MONOLITH's structured document ingestion system. Where IAI uses LLM classification at ingestion, MONOLITH uses schema-validated frontmatter and deterministic routing. The Scriptorium is the MONOLITH-native answer to IAI's ingestion layer.

### Knowledge Regions

Community detection in IAI directly motivated the concept of Knowledge Regions in MONOLITH's memory architecture — semantic groupings of memory that share activation and lifecycle. The routing-map's memory region table (`Table 4`) is the first implementation of this concept.

### Lifecycle Improvements to Memory Governance

IAI's lifecycle model motivated adding stability classifications (`volatile`, `stable`, `authoritative`) to MONOLITH's memory frontmatter schema. The memory governance protocol now explicitly separates volatile working memory from authoritative long-term memory.

### Terra Evolution Direction

IAI's sleep pipeline — consolidating memories after active use — provided the conceptual frame for Terra's future role as a persistence and consolidation substrate. Terra is not just a database; it is the layer where memory transitions from active to consolidated.

See `ADR-006` for Terra persistence strategy.

### Future Attention System

IAI's community detection and pattern separation motivated thinking about an attention mechanism — a system that determines which memory regions are relevant to the current task. This is not yet implemented but is captured in the vision documents.

See `docs/vision/long-term-vision.md`.

---

## Follow-up ADRs

| ADR       | Title                        | Relationship                                            |
| --------- | ---------------------------- | ------------------------------------------------------- |
| ADR-004   | Terra vs Graph Memex         | Memory substrate decision, informed by sleep pipeline   |
| ADR-005   | Lexicon Mechanicus           | Terminology system, motivated by pattern separation     |
| ADR-006   | Terra Persistence Strategy   | Consolidation pipeline design                           |

---

## Open Questions

1. Should consolidation (sleep pipeline) be triggered by story finalization only, or also on a time-based schedule?
2. At what memory age should the `confidence:` field degrade automatically?
3. Can contradiction detection be implemented without an LLM inference step?
4. Should Knowledge Regions have explicit membership declarations, or should membership be inferred from tags?
5. What is the correct granularity for Essential Variables in MONOLITH — protocol-level only, or also individual memory artifacts?

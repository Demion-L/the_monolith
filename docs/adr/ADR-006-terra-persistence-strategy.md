---
type: adr
id: ADR-006
title: Terra Persistence Strategy
status: proposed
date: 2026-06-28
research:
  - R-0001
  - R-0002
related_adrs:
  - ADR-004
---

# ADR-006 — Terra Persistence Strategy

---

> **Status: PROPOSED**
> This ADR documents the proposed design for Terra. It is not yet accepted.
> Acceptance requires: implementation design review, prototype, and integration plan.

---

## Context

ADR-004 chose Terra as the persistence substrate for MONOLITH's memory layer. This ADR defines what Terra must do and how it should be structured.

Current state:
- Memory lives in markdown files with YAML frontmatter
- No schema validation at write time
- No lifecycle enforcement
- No consolidation pipeline
- The `finalize-story` skill manually promotes working memory to long-term memory
- No automatic pruning or forgetting

This is adequate for a single-project prototype. It is not adequate for a long-running cognitive operating system that accumulates memory across hundreds of stories and multiple years of use.

Terra must provide the structural foundation that makes memory reliable at scale.

---

## Proposed Decision

Terra is implemented as a **schema-enforced, file-based document store** with the following properties:

1. **Schema validation at write time** — Every memory artifact written to Terra must conform to its declared schema. Invalid artifacts are rejected at the gate.

2. **Lifecycle state machine** — Each artifact carries a lifecycle state (`active | consolidating | long-term | archived | forgotten`). State transitions are governed by explicit rules, not manual updates.

3. **Consolidation pipeline** — A consolidation pass runs on story finalization. The pass:
   - Promotes candidate working memory artifacts to long-term state
   - Archives long-term artifacts that have not been accessed in N sessions
   - Marks archived artifacts as `forgotten` if they pass a forgetting threshold

4. **Read/Write separation** — Terra is the write layer only. The read layer remains the semantic-map + routing-map oracle interface defined in R-0002. Terra does not expose a query interface; callers read Terra through the oracle.

5. **Provenance fields** — Every artifact carries: `created_in_story`, `created_date`, `last_accessed_story`, `last_accessed_date`, `access_count`.

6. **Essential artifacts** — A set of artifacts classified as `essential: true` are exempt from pruning and archiving. They are never forgotten.

---

## Rationale

### Schema validation at write time

Without schema enforcement, memory drift is inevitable. A file written by one skill in one format becomes unreadable by another skill expecting a different format. Schema validation at write time catches errors at their origin, not at query time.

### Lifecycle state machine

The IAI research (R-0001) confirmed that treating forgetting as a feature — rather than a failure — is essential for long-term cognitive systems. A lifecycle state machine makes forgetting explicit, policy-driven, and auditable.

### Consolidation pipeline

Manual consolidation via the finalize-story skill is brittle. If a session ends abnormally, consolidation may be skipped. A pipeline triggered by story finalization (and recoverable if skipped) makes consolidation reliable.

### Read/Write separation

R-0002 established that oracle-style retrieval requires a clean read/write separation. Terra is the write layer; the semantic-map is the read layer. Mixing these responsibilities creates authority conflicts.

### Provenance fields

R-0001 identified provenance tracking as a high-value, low-cost extension. Provenance enables debugging ("where did this memory come from?"), access pattern analysis, and informed forgetting decisions (artifacts never accessed can be pruned sooner).

---

## Alternatives Considered

### External database (SQLite, SQLite JSON, embedded graph DB)

**Not decided.** An external database would provide stronger schema enforcement and query capabilities but breaks the file-based, human-readable memory model. This trade-off requires further investigation before a final decision.

### No Terra (maintain current flat file system)

**Rejected.** As documented in ADR-004, the flat file system lacks lifecycle enforcement, schema validation, and consolidation. These are required for long-term viability.

### Terra as a runtime service (daemon process)

**Deferred.** A daemon would provide richer capabilities (background consolidation, incremental indexing) but introduces deployment complexity and process management. This may be appropriate in a later phase.

---

## Open Design Questions

Before this ADR can be accepted, the following questions must be resolved:

1. **Storage format** — Should Terra artifacts remain as plain markdown files, or should they use a structured format (YAML, JSON) that is machine-readable without frontmatter parsing?

2. **Consolidation trigger** — Should consolidation run only on story finalization, or also on a time-based schedule (e.g., once per calendar day if a session ran that day)?

3. **Forgetting threshold** — What criteria determine when a `long-term` artifact becomes `archived`, and when an `archived` artifact becomes `forgotten`? Options: access count, session age, both.

4. **Essential artifact classification** — Which artifacts should be `essential: true`? Candidates: core-invariants, memory-governance protocol, semantic-map, all accepted ADRs.

5. **Backward compatibility** — How should existing memory artifacts without Terra lifecycle fields be handled? Options: silent upgrade on first read, explicit migration pass, leave as-is (treated as `active`).

---

## Consequences (Anticipated)

**Will become easier:**
- Memory auditing (structured provenance, lifecycle state)
- Forgetting (explicit policy, not manual deletion)
- Integration testing (schema validation catches format errors early)
- Long-term memory reliability (no silent drift)

**Will become harder:**
- Manual memory inspection (schema constraints mean invalid edits fail)
- Migration of existing artifacts

**Risks:**
- Schema evolution: if the Terra schema changes, all existing artifacts must be migrated
- Consolidation failure: if the consolidation pipeline has a bug, it could archive or forget important memories

---

## References

- ADR: `docs/adr/ADR-004-terra-vs-graph-memex.md` — substrate decision
- Research: `docs/research/R-0001-iai-personal-memory-engine.md` — sleep pipeline and lifecycle motivation
- Research: `docs/research/R-0002-oracle-memory-systems.md` — read/write separation model
- Architecture: `docs/architecture/memory-architecture.md` — current memory structure
